import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { logDecision } from "../lib/log";
import { actorOf, adminProc, memberProc, publicProc } from "../middleware/auth";
import { db } from "../database/client";
import * as schema from "../database/schema";
import { GRACE_DAYS, HOUSE_RATE, RESERVE_RATE, daysFromNow } from "../lib/economy";
import { audit, audited } from "../lib/services/audit";
import { committedBp, positionOf } from "../lib/services/equity";
import { settleForeclosure } from "../lib/services/escrow";
import { idempotencyKey, isUniqueViolation, once } from "../lib/services/idempotency";
import { addNotice } from "../lib/services/notices";
import { lockProject } from "../lib/services/tickets";
import { runTx, type Db } from "../lib/services/tx";
import { usd } from "../lib/services/wallet";

const reason = z.string().trim().min(5).max(600);

/** Escrow actually still held — the sum of investments.held_cents, not the ledger bucket. */
export async function heldEscrowCents(tx: Db) {
  const [row] = await tx.select({ cents: sql<number>`coalesce(sum(${schema.investments.heldCents}), 0)` }).from(schema.investments);
  return Number(row?.cents ?? 0);
}

export const house = {
  /** The books, open to admins: take, reserve, redistribution pool, exposure. */
  ledger: adminProc.handler(async () => {
    const [byBucket, byKind, recent, memberAgg, projectRows, held] = await Promise.all([
      db
        .select({ bucket: schema.ledger.bucket, total: sql<number>`sum(${schema.ledger.amountCents})`, count: sql<number>`count(*)` })
        .from(schema.ledger)
        .groupBy(schema.ledger.bucket),
      db
        .select({ kind: schema.ledger.kind, total: sql<number>`sum(${schema.ledger.amountCents})`, count: sql<number>`count(*)` })
        .from(schema.ledger)
        .groupBy(schema.ledger.kind),
      db.select().from(schema.ledger).orderBy(desc(schema.ledger.id)).limit(40),
      db
        .select({ members: sql<number>`count(*)`, points: sql<number>`sum(${schema.members.points})`, wallet: sql<number>`sum(${schema.members.walletCents})` })
        .from(schema.members)
        .then((r) => r[0]),
      db.select().from(schema.projects),
      heldEscrowCents(db),
    ]);
    const bucket = (name: string) => Number(byBucket.find((b) => b.bucket === name)?.total ?? 0);
    return {
      rates: { houseRate: HOUSE_RATE, reserveRate: RESERVE_RATE },
      houseCents: bucket("house"),
      reserveCents: bucket("reserve"),
      featureFundCents: bucket("feature_fund"),
      vendorRetainersCents: bucket("vendor"),
      escrowHeldCents: held,
      escrowBucketNetCents: bucket("escrow"),
      byBucket: byBucket.map((b) => ({ ...b, total: Number(b.total ?? 0), count: Number(b.count) })),
      byKind: byKind.map((b) => ({ ...b, total: Number(b.total ?? 0), count: Number(b.count) })),
      recent,
      network: {
        memberCount: Number(memberAgg?.members ?? 0),
        pointsOutstanding: Number(memberAgg?.points ?? 0),
        walletFloatCents: Number(memberAgg?.wallet ?? 0),
        projects: projectRows.length,
        live: projectRows.filter((p) => p.status === "live").length,
        defaulting: projectRows.filter((p) => p.status === "default_notice").length,
        foreclosed: projectRows.filter((p) => ["foreclosed", "redistributed"].includes(p.status)).length,
      },
    };
  }),

  /** Projects gone quiet, with the accommodation ladder before any enforcement. */
  watchlist: adminProc.handler(async () => {
    const rows = await db
      .select({ project: schema.projects, creator: { handle: schema.members.handle, trustScore: schema.members.trustScore } })
      .from(schema.projects)
      .innerJoin(schema.members, eq(schema.projects.creatorId, schema.members.id))
      .orderBy(schema.projects.lastActivityAt);
    const now = Date.now();
    return rows
      .filter((r) => ["live", "funded", "default_notice"].includes(r.project.status))
      .map((r) => {
        const idleDays = Math.round((now - new Date(r.project.lastActivityAt).getTime()) / 86400000);
        const graceOpen = !!r.project.graceUntil && new Date(r.project.graceUntil).getTime() > now;
        const graceExpired = !!r.project.graceUntil && !graceOpen;
        const escalation =
          r.project.status === "default_notice"
            ? graceOpen
              ? "default_notice"
              : "foreclosure_available"
            : graceOpen
              ? "in_grace"
              : graceExpired
                ? "notice_due"
                : idleDays >= 21
                  ? "grace_due"
                  : "healthy";
        const recommendation: Record<string, string> = {
          healthy: "Leave alone.",
          grace_due: "Send a grace notice with a written cure plan. No penalty attaches yet.",
          in_grace: "Grace window running — wait it out or cure it.",
          notice_due: `Grace expired. Issue a default notice: ${GRACE_DAYS} days to cure, steps spelled out.`,
          default_notice: "Cure window running. Foreclosure unlocks only when it expires.",
          foreclosure_available: "Cure window expired — foreclosure is available. Backers keep their equity.",
        };
        return {
          ...r.project,
          creatorHandle: r.creator.handle,
          creatorTrust: r.creator.trustScore,
          idleDays,
          escalation,
          recommendation: recommendation[escalation],
          actions: {
            grace: ["live", "funded"].includes(r.project.status) && !graceOpen,
            defaultNotice: ["live", "funded"].includes(r.project.status) && graceExpired,
            foreclose: escalation === "foreclosure_available",
          },
        };
      });
  }),

  /** Grace first, always. A notice is a help document with a deadline on it. */
  issueGrace: adminProc.input(z.object({ projectId: z.number().int(), reason })).handler(({ input, context }) =>
    audited(actorOf(context), "house.issueGrace", { type: "project", id: input.projectId }, () =>
      runTx("house.issueGrace", async (tx) => {
        const project = await lockProject(tx, input.projectId);
        if (!["live", "funded"].includes(project.status)) throw new ORPCError("BAD_REQUEST", { message: `Grace applies to live or funded projects, not ${project.status}` });
        if (project.graceUntil && new Date(project.graceUntil).getTime() > Date.now()) throw new ORPCError("CONFLICT", { message: "A grace window is already running" });
        const until = daysFromNow(GRACE_DAYS);
        await tx.update(schema.projects).set({ graceUntil: until }).where(eq(schema.projects.id, project.id));
        await addNotice(tx, {
          memberId: project.creatorId,
          projectId: project.id,
          kind: "grace",
          title: `Grace period opened — ${GRACE_DAYS} days, no penalty`,
          body: `${input.reason}\n\nNothing is held against you during a grace period. Backer funds stay in escrow and your score is untouched.`,
          recoveryPath: "Any one of these closes it: post milestone evidence, post a revised timeline your backers can vote on, or request a stage reset.",
          dueAt: until,
        });
        await audit(tx, actorOf(context), { action: "house.issueGrace", outcome: "accepted", targetType: "project", targetId: project.id, summary: `Grace until ${until.toISOString().slice(0, 10)}` });
        return { ok: true, graceUntil: until };
      }),
    ),
  ),

  issueDefaultNotice: adminProc.input(z.object({ projectId: z.number().int(), reason })).handler(({ input, context }) =>
    audited(actorOf(context), "house.issueDefaultNotice", { type: "project", id: input.projectId }, () =>
      runTx("house.issueDefaultNotice", async (tx) => {
        const project = await lockProject(tx, input.projectId);
        if (!["live", "funded"].includes(project.status)) throw new ORPCError("BAD_REQUEST", { message: `A default notice needs a live or funded project, not ${project.status}` });
        if (!project.graceUntil || new Date(project.graceUntil).getTime() > Date.now()) {
          throw new ORPCError("BAD_REQUEST", { message: "Open grace first and let its accommodation window expire before a default notice." });
        }
        const until = daysFromNow(GRACE_DAYS);
        const [moved] = await tx
          .update(schema.projects)
          .set({ status: "default_notice", defaultReason: input.reason, graceUntil: until })
          .where(and(eq(schema.projects.id, project.id), eq(schema.projects.status, project.status)))
          .returning();
        if (!moved) throw new ORPCError("CONFLICT", { message: "Project status changed; refresh" });
        await addNotice(tx, {
          memberId: project.creatorId,
          projectId: project.id,
          kind: "default_notice",
          title: `Notice of default — ${GRACE_DAYS} days to cure`,
          body: `Reason: ${input.reason}\n\nThis is a notice, not a judgment. Escrowed funds are frozen, not seized. Curing within the window clears it.`,
          recoveryPath:
            "Cure options, any one sufficient: (1) post the outstanding milestone evidence, (2) agree a revised schedule with backers, (3) hand the project to a member operator, (4) voluntary wind-down returning held escrow minus the 25% clawback.",
          dueAt: until,
        });
        await audit(tx, actorOf(context), { action: "house.issueDefaultNotice", outcome: "accepted", targetType: "project", targetId: project.id, summary: "Default notice issued" });
        return { ok: true };
      }),
    ),
  ),

  /** Clear an open grace/default notice. Only unresolved notices; a project is reinstated only from default_notice. */
  cureNotice: adminProc.input(z.object({ noticeId: z.number().int(), resolution: reason })).handler(({ input, context }) =>
    audited(actorOf(context), "house.cureNotice", { type: "notice", id: input.noticeId }, () =>
      runTx("house.cureNotice", async (tx) => {
        const [notice] = await tx.select().from(schema.notices).where(eq(schema.notices.id, input.noticeId));
        if (!notice) throw new ORPCError("NOT_FOUND", { message: "Notice not found" });
        if (!["grace", "default_notice", "cure_plan"].includes(notice.kind)) {
          throw new ORPCError("BAD_REQUEST", { message: `A ${notice.kind} notice is informational and cannot be cured` });
        }
        const [claimed] = await tx
          .update(schema.notices)
          .set({ resolved: true })
          .where(and(eq(schema.notices.id, notice.id), eq(schema.notices.resolved, false)))
          .returning();
        if (!claimed) throw new ORPCError("CONFLICT", { message: "That notice is already resolved" });
        let reinstated = false;
        if (notice.projectId) {
          const project = await lockProject(tx, notice.projectId);
          if (project.status === "default_notice") {
            await tx
              .update(schema.projects)
              .set({ status: "live", defaultReason: null, graceUntil: null, lastActivityAt: new Date() })
              .where(and(eq(schema.projects.id, project.id), eq(schema.projects.status, "default_notice")));
            reinstated = true;
          } else if (notice.kind === "grace" && ["live", "funded"].includes(project.status)) {
            await tx.update(schema.projects).set({ graceUntil: null, lastActivityAt: new Date() }).where(eq(schema.projects.id, project.id));
          }
          await tx
            .update(schema.notices)
            .set({ resolved: true })
            .where(and(eq(schema.notices.projectId, project.id), eq(schema.notices.resolved, false), sql`${schema.notices.kind} in ('grace','default_notice')`));
        }
        await addNotice(tx, {
          memberId: notice.memberId,
          projectId: notice.projectId,
          kind: "reinstatement",
          title: "Cured — record cleared",
          body: input.resolution,
          recoveryPath: "No residual penalty. The default does not appear in your standing history.",
        });
        await audit(tx, actorOf(context), { action: "house.cureNotice", outcome: "accepted", targetType: "notice", targetId: notice.id, summary: reinstated ? "Cured and reinstated" : "Cured" });
        return { ok: true, reinstated };
      }),
    ),
  ),

  /**
   * Foreclosure: only under a default notice with an expired cure window. Only escrow still held is
   * settled. Backer equity survives; 60% of the creator's uncommitted position is listed as a
   * foreclosure lot whose proceeds fund member features.
   */
  foreclose: adminProc.input(z.object({ projectId: z.number().int(), reason, idempotencyKey })).handler(({ input, context }) => {
    const { idempotencyKey: key, ...payload } = input;
    return audited(actorOf(context), "house.foreclose", { type: "project", id: input.projectId }, () =>
      once({ memberId: context.member.id, scope: "house.foreclose", key, payload }, async (tx) => {
        const project = await lockProject(tx, input.projectId);
        if (project.status !== "default_notice" || !project.graceUntil || new Date(project.graceUntil).getTime() > Date.now()) {
          throw new ORPCError("BAD_REQUEST", { message: "A project must sit under a default notice with an expired cure window first." });
        }
        if (project.creatorId === context.member.id) throw new ORPCError("FORBIDDEN", { message: "You cannot foreclose your own project" });
        const [moved] = await tx
          .update(schema.projects)
          .set({ status: "foreclosed", defaultReason: input.reason, escrowStatus: "settled" })
          .where(and(eq(schema.projects.id, project.id), eq(schema.projects.status, "default_notice")))
          .returning();
        if (!moved) throw new ORPCError("CONFLICT", { message: "Project was already settled" });

        const settled = await settleForeclosure(tx, project);
        // Creator's own open member listings on this project are withdrawn before the lot is sized.
        await tx
          .update(schema.equityListings)
          .set({ status: "cancelled" })
          .where(and(eq(schema.equityListings.projectId, project.id), eq(schema.equityListings.sellerId, project.creatorId), eq(schema.equityListings.status, "open"), eq(schema.equityListings.lotKind, "member")));
        const creatorBp = await positionOf(tx, project.id, project.creatorId);
        const free = creatorBp - (await committedBp(tx, project.id, project.creatorId));
        const lotBp = Math.max(0, Math.round(free * 0.6));
        let lotId: number | null = null;
        if (lotBp > 0) {
          const [lot] = await tx
            .insert(schema.equityListings)
            .values({
              projectId: project.id,
              sellerId: project.creatorId,
              equityBp: lotBp,
              askCents: Math.max(500, Math.round(project.raisedCents * 0.2)),
              status: "open",
              lotKind: "foreclosure",
            })
            .returning();
          lotId = lot.id;
        }
        await tx.update(schema.milestones).set({ status: "failed" }).where(and(eq(schema.milestones.projectId, project.id), sql`${schema.milestones.status} in ('open','locked','submitted')`));
        await addNotice(tx, {
          memberId: project.creatorId,
          projectId: project.id,
          kind: "foreclosure",
          title: "Project foreclosed — here is the way back",
          body: `Reason: ${input.reason}\n\n${usd(settled.heldCents)} of still-held escrow was settled. ${(lotBp / 100).toFixed(2)}% of your position is listed as a foreclosure lot whose proceeds fund member features; you keep ${((creatorBp - lotBp) / 100).toFixed(2)}%.`,
          recoveryPath: "Standing is restorable: two approved clout tasks or one verified milestone on any project lifts the flag.",
        });
        await audit(tx, actorOf(context), { action: "house.foreclose", outcome: "accepted", targetType: "project", targetId: project.id, summary: `Held ${settled.heldCents} settled, lot ${lotBp} bp` });
        logDecision("foreclosure", "Settled", { projectId: project.id, lotBp, ...settled });
        return { lotBp, lotId, ...settled };
      }),
    );
  }),

  /** Where failed-asset money goes — features members voted for. */
  features: publicProc.handler(async ({ context }) => {
    const rows = await db.select().from(schema.features).orderBy(desc(schema.features.votes));
    const [fund] = await db.select({ total: sql<number>`sum(${schema.ledger.amountCents})` }).from(schema.ledger).where(eq(schema.ledger.bucket, "feature_fund"));
    const voted = context.member
      ? (await db.select({ featureId: schema.featureVotes.featureId }).from(schema.featureVotes).where(eq(schema.featureVotes.memberId, context.member.id))).map((v) => v.featureId)
      : [];
    return { features: rows.map((f) => ({ ...f, votedByMe: voted.includes(f.id) })), fundCents: Number(fund?.total ?? 0) };
  }),

  voteFeature: memberProc.input(z.object({ featureId: z.number().int() })).handler(({ input, context }) =>
    audited(actorOf(context), "house.voteFeature", { type: "feature", id: input.featureId }, async () => {
      try {
        return await runTx("house.voteFeature", async (tx) => {
          const [f] = await tx.select().from(schema.features).where(eq(schema.features.id, input.featureId));
          if (!f) throw new ORPCError("NOT_FOUND", { message: "Feature not found" });
          if (f.status === "shipped") throw new ORPCError("BAD_REQUEST", { message: "That feature already shipped" });
          await tx.insert(schema.featureVotes).values({ featureId: f.id, memberId: context.member.id });
          const [row] = await tx
            .update(schema.features)
            .set({ votes: sql`${schema.features.votes} + 1` })
            .where(eq(schema.features.id, f.id))
            .returning({ votes: schema.features.votes });
          return { votes: row.votes };
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw new ORPCError("CONFLICT", { message: "One vote per member per feature" });
        throw error;
      }
    }),
  ),

  /** Admin: move feature-fund money into a feature the members voted for. */
  fundFeature: adminProc
    .input(z.object({ featureId: z.number().int(), amountCents: z.number().int().min(100).max(10_000_000), idempotencyKey }))
    .handler(({ input, context }) => {
      const { idempotencyKey: key, ...payload } = input;
      return audited(actorOf(context), "house.fundFeature", { type: "feature", id: input.featureId }, () =>
        once({ memberId: context.member.id, scope: "house.fundFeature", key, payload }, async (tx) => {
          const [f] = await tx.select().from(schema.features).where(eq(schema.features.id, input.featureId));
          if (!f) throw new ORPCError("NOT_FOUND", { message: "Feature not found" });
          const [fund] = await tx.select({ total: sql<number>`coalesce(sum(${schema.ledger.amountCents}), 0)` }).from(schema.ledger).where(eq(schema.ledger.bucket, "feature_fund"));
          const available = Number(fund?.total ?? 0);
          if (available < input.amountCents) throw new ORPCError("BAD_REQUEST", { message: `The feature fund holds ${usd(available)}` });
          const funded = f.fundedCents + input.amountCents;
          await tx
            .update(schema.features)
            .set({ fundedCents: sql`${schema.features.fundedCents} + ${input.amountCents}`, status: funded >= f.targetCents ? "building" : f.status })
            .where(eq(schema.features.id, f.id));
          await tx.insert(schema.ledger).values({ kind: "feature_spend", amountCents: -input.amountCents, bucket: "feature_fund", note: `Allocated to "${f.title}"` });
          await audit(tx, actorOf(context), { action: "house.fundFeature", outcome: "accepted", targetType: "feature", targetId: f.id, summary: `Allocated ${input.amountCents} cents` });
          return { featureId: f.id, fundedCents: funded, status: funded >= f.targetCents ? "building" : f.status };
        }),
      );
    }),

  notices: adminProc.handler(async () => {
    const rows = await db
      .select({ notice: schema.notices, member: { handle: schema.members.handle } })
      .from(schema.notices)
      .innerJoin(schema.members, eq(schema.notices.memberId, schema.members.id))
      .where(eq(schema.notices.resolved, false))
      .orderBy(desc(schema.notices.createdAt))
      .limit(60);
    return rows.map((r) => ({ ...r.notice, handle: r.member.handle }));
  }),

  myNotices: memberProc.handler(({ context }) =>
    db
      .select()
      .from(schema.notices)
      .where(and(eq(schema.notices.memberId, context.member.id), eq(schema.notices.resolved, false)))
      .orderBy(desc(schema.notices.createdAt)),
  ),

  /** Members may dismiss their own informational notices (not default or foreclosure records). */
  dismissNotice: memberProc.input(z.object({ noticeId: z.number().int() })).handler(async ({ input, context }) => {
    const [row] = await db
      .update(schema.notices)
      .set({ resolved: true })
      .where(
        and(
          eq(schema.notices.id, input.noticeId),
          eq(schema.notices.memberId, context.member.id),
          eq(schema.notices.resolved, false),
          sql`${schema.notices.kind} not in ('default_notice','foreclosure','grace')`,
        ),
      )
      .returning({ id: schema.notices.id });
    if (!row) throw new ORPCError("BAD_REQUEST", { message: "That notice cannot be dismissed — it is resolved, not yours, or an enforcement record" });
    logDecision("notices", "Dismissed by owner", { memberId: context.member.id, noticeId: row.id });
    return { ok: true };
  }),
};
