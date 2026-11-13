import { z } from "zod";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { logDecision } from "../lib/log";
import { actorOf, adminProc, memberProc, publicProc } from "../middleware/auth";
import { db } from "../database/client";
import * as schema from "../database/schema";
import { audit, audited } from "../lib/services/audit";
import { isUniqueViolation } from "../lib/services/idempotency";
import { addLedger } from "../lib/services/ledger";
import { addNotice } from "../lib/services/notices";
import { runTx, type Db } from "../lib/services/tx";
import { grantPoints } from "../lib/services/wallet";
import { heldEscrowCents } from "./house";

/** Task board: the non-cash path to level up. Marketing a project you back pays most. */
export const TASK_TYPES = [
  {
    kind: "marketing",
    title: "Market a project you back",
    detail: "Post a truthful piece about a project to a real audience and log the link. Claims must match the project room — inflated claims are rejected and cost clout.",
    points: 60,
    clout: 25,
  },
  {
    kind: "diligence",
    title: "Write a diligence note",
    detail: "300+ words on a live pitch: what would have to be true, what would kill it, what evidence would settle it. Published in the project room under your handle.",
    points: 45,
    clout: 30,
  },
  {
    kind: "referral",
    title: "Bring a creator or backer",
    detail: "Your handle is credited when they complete a passport and their first decision.",
    points: 80,
    clout: 20,
  },
  {
    kind: "moderation",
    title: "Flag a rule break with evidence",
    detail: "Illegal content, unverifiable claims, or an unlicensed securities pitch. Confirmed flags pay; bad-faith flags cost clout.",
    points: 35,
    clout: 40,
  },
  {
    kind: "translation",
    title: "Translate a project room",
    detail: "Full translation of a pitch and its milestones into another language, reviewed by one other member.",
    points: 70,
    clout: 15,
  },
] as const;

const MAX_OPEN_CLAIMS = 5;
const PASS_QUORUM = 3;
const kindEnum = z.enum(["marketing", "diligence", "referral", "moderation", "translation"]);
const specFor = (kind: string) => {
  const spec = TASK_TYPES.find((t) => t.kind === kind);
  if (!spec) throw new ORPCError("BAD_REQUEST", { message: "Unknown task type" });
  return spec;
};

export const clout = {
  board: publicProc.handler(() => TASK_TYPES),

  claim: memberProc
    .input(z.object({ kind: kindEnum, projectId: z.number().int().positive().optional(), title: z.string().trim().min(3).max(140) }))
    .handler(({ input, context }) =>
      audited(actorOf(context), "task.claim", undefined, async () => {
        const spec = specFor(input.kind);
        return runTx("task.claim", async (tx) => {
          if (input.projectId) {
            const [project] = await tx.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, input.projectId));
            if (!project) throw new ORPCError("NOT_FOUND", { message: "That project does not exist" });
          }
          const [open] = await tx
            .select({ n: sql<number>`count(*)` })
            .from(schema.tasks)
            .where(and(eq(schema.tasks.memberId, context.member.id), inArray(schema.tasks.status, ["claimed", "rejected", "submitted"])));
          if (Number(open?.n ?? 0) >= MAX_OPEN_CLAIMS) {
            logDecision("tasks", "Claim refused: open-claim cap", { memberId: context.member.id });
            throw new ORPCError("CONFLICT", { message: `You already have ${MAX_OPEN_CLAIMS} open tasks. Finish or wait on review before claiming more.` });
          }
          const [task] = await tx
            .insert(schema.tasks)
            .values({ memberId: context.member.id, projectId: input.projectId ?? null, kind: input.kind, title: input.title || spec.title, status: "claimed" })
            .returning();
          await audit(tx, actorOf(context), { action: "task.claim", outcome: "accepted", targetType: "task", targetId: task.id, summary: `Claimed ${input.kind}` });
          return task;
        });
      }),
    ),

  /** Submits proof for review. A rejected task can be revised and resubmitted; rewards land only on approval. */
  submit: memberProc
    .input(z.object({ taskId: z.number().int().positive(), proof: z.string().trim().min(10).max(2000) }))
    .handler(({ input, context }) =>
      audited(actorOf(context), "task.submit", { type: "task", id: input.taskId }, () =>
        runTx("task.submit", async (tx) => {
          const [task] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, input.taskId));
          if (!task || task.memberId !== context.member.id) throw new ORPCError("NOT_FOUND", { message: "Task not found" });
          const revising = task.status === "rejected";
          const [row] = await tx
            .update(schema.tasks)
            .set({
              proof: input.proof,
              status: "submitted",
              submittedAt: new Date(),
              ...(revising ? { revisionCount: sql`${schema.tasks.revisionCount} + 1` } : {}),
            })
            .where(and(eq(schema.tasks.id, task.id), inArray(schema.tasks.status, ["claimed", "rejected"])))
            .returning();
          if (!row) {
            throw new ORPCError("CONFLICT", {
              message: task.status === "approved" ? "This task was already approved. Rewards are issued once." : "This task is already waiting on review.",
            });
          }
          await audit(tx, actorOf(context), { action: "task.submit", outcome: "accepted", targetType: "task", targetId: task.id, summary: revising ? `Revision ${row.revisionCount}` : "First submission" });
          logDecision("tasks", "Submitted for review", { taskId: task.id, revising });
          return { task: row, note: "Queued for House review. Points and clout land only when a reviewer approves." };
        }),
      ),
    ),

  mine: memberProc.handler(({ context }) =>
    db.select().from(schema.tasks).where(eq(schema.tasks.memberId, context.member.id)).orderBy(desc(schema.tasks.createdAt)),
  ),

  queue: adminProc.handler(async ({ context }) => {
    const rows = await db
      .select({ task: schema.tasks, handle: schema.members.handle })
      .from(schema.tasks)
      .innerJoin(schema.members, eq(schema.members.id, schema.tasks.memberId))
      .where(eq(schema.tasks.status, "submitted"))
      .orderBy(schema.tasks.submittedAt);
    return rows.map((r) => ({ ...r.task, handle: r.handle, ownTask: r.task.memberId === context.member.id, reward: specFor(r.task.kind) }));
  }),

  reviewTask: adminProc
    .input(z.object({ taskId: z.number().int().positive(), approve: z.boolean(), note: z.string().trim().min(3).max(600) }))
    .handler(({ input, context }) =>
      audited(actorOf(context), "task.review", { type: "task", id: input.taskId }, () =>
        runTx("task.review", async (tx) => {
          const [task] = await tx.select().from(schema.tasks).where(eq(schema.tasks.id, input.taskId));
          if (!task) throw new ORPCError("NOT_FOUND", { message: "Task not found" });
          if (task.memberId === context.member.id) {
            logDecision("tasks", "Self-review blocked", { taskId: task.id });
            throw new ORPCError("FORBIDDEN", { message: "You cannot review your own task" });
          }
          const spec = specFor(task.kind);
          const [row] = await tx
            .update(schema.tasks)
            .set({
              status: input.approve ? "approved" : "rejected",
              reviewerId: context.member.id,
              reviewedAt: new Date(),
              reviewNote: input.note,
              pointsAwarded: input.approve ? spec.points : 0,
              cloutAwarded: input.approve ? spec.clout : 0,
            })
            .where(and(eq(schema.tasks.id, task.id), eq(schema.tasks.status, "submitted")))
            .returning();
          if (!row) throw new ORPCError("CONFLICT", { message: "This task is not waiting on review (already decided?)" });
          if (input.approve) {
            await grantPoints(tx, task.memberId, spec.points, spec.clout);
            await tx
              .update(schema.members)
              .set({ socialScore: sql`min(1000, ${schema.members.socialScore} + 8)` })
              .where(eq(schema.members.id, task.memberId));
            await addLedger(tx, {
              kind: "task_reward",
              amountCents: 0,
              memberId: task.memberId,
              projectId: task.projectId,
              bucket: "member",
              note: `Task #${task.id} ${spec.title}: +${spec.points} points, +${spec.clout} clout`,
            });
          }
          await addNotice(tx, {
            memberId: task.memberId,
            projectId: task.projectId,
            kind: input.approve ? "task_approved" : "task_rejected",
            title: input.approve ? `Task approved: +${spec.points} points` : "Task needs revision",
            body: input.approve ? `"${task.title}" was approved. ${input.note}` : `"${task.title}" was sent back: ${input.note}`,
            recoveryPath: input.approve ? undefined : "Revise the proof on the Hub and resubmit.",
          });
          await audit(tx, actorOf(context), { action: "task.review", outcome: "accepted", targetType: "task", targetId: task.id, summary: input.approve ? "Approved" : "Rejected for revision" });
          return { task: row, approved: input.approve };
        }),
      ),
    ),
};

/** Closes one proposal if its window has elapsed (or `force` from an admin). Idempotent: a closed proposal is left alone. */
async function finalizeProposal(tx: Db, proposalId: number, force: boolean) {
  const [p] = await tx.select().from(schema.proposals).where(eq(schema.proposals.id, proposalId));
  if (!p) throw new ORPCError("NOT_FOUND", { message: "Proposal not found" });
  if (p.status !== "open") return p;
  const expired = p.closesAt ? new Date(p.closesAt).getTime() <= Date.now() : false;
  if (!expired && !force) return p;
  const passed = p.voterCount >= PASS_QUORUM && p.yesWeight > p.noWeight;
  const outcomeNote = passed
    ? `Passed: ${p.voterCount} voters, weighted ${p.yesWeight} yes vs ${p.noWeight} no. Nothing is disbursed automatically; the House acts on it publicly.`
    : p.voterCount < PASS_QUORUM
      ? `Rejected: quorum not met (${p.voterCount} of ${PASS_QUORUM} distinct voters).`
      : `Rejected: weighted ${p.yesWeight} yes did not beat ${p.noWeight} no.`;
  const [row] = await tx
    .update(schema.proposals)
    .set({ status: passed ? "passed" : "rejected", outcomeNote, finalizedAt: new Date() })
    .where(and(eq(schema.proposals.id, p.id), eq(schema.proposals.status, "open")))
    .returning();
  if (row) {
    await audit(tx, { memberId: null }, { action: "governance.finalize", outcome: "accepted", targetType: "proposal", targetId: p.id, summary: outcomeNote });
    logDecision("governance", "Proposal finalized", { proposalId: p.id, passed, forced: force && !expired });
  }
  return row ?? p;
}

/** Hub governance: one member one vote at the base, weighted by clout above it. */
export const governance = {
  proposals: publicProc.handler(async ({ context }) => {
    const expired = await db
      .select({ id: schema.proposals.id })
      .from(schema.proposals)
      .where(and(eq(schema.proposals.status, "open"), lt(schema.proposals.closesAt, new Date())));
    for (const p of expired) await runTx("governance.autoFinalize", (tx) => finalizeProposal(tx, p.id, false));
    const rows = await db.select().from(schema.proposals).orderBy(desc(schema.proposals.createdAt));
    const mine = context.member
      ? await db.select({ proposalId: schema.votes.proposalId, choice: schema.votes.choice, weight: schema.votes.weight }).from(schema.votes).where(eq(schema.votes.memberId, context.member.id))
      : [];
    return rows.map((p) => ({ ...p, myVote: mine.find((v) => v.proposalId === p.id) ?? null, quorum: PASS_QUORUM }));
  }),

  propose: memberProc
    .input(z.object({ title: z.string().trim().min(6).max(140), body: z.string().trim().min(40).max(4000) }))
    .handler(({ input, context }) =>
      audited(actorOf(context), "governance.propose", undefined, async () => {
        if (context.member.level < 1) {
          throw new ORPCError("FORBIDDEN", { message: "Proposals open at Associate. Two approved tasks gets you there without paying." });
        }
        return runTx("governance.propose", async (tx) => {
          const [p] = await tx
            .insert(schema.proposals)
            .values({ title: input.title, body: input.body, authorId: context.member.id, closesAt: new Date(Date.now() + 14 * 86400000) })
            .returning();
          await audit(tx, actorOf(context), { action: "governance.propose", outcome: "accepted", targetType: "proposal", targetId: p.id, summary: input.title.slice(0, 120) });
          return p;
        });
      }),
    ),

  vote: memberProc
    .input(z.object({ proposalId: z.number().int().positive(), choice: z.enum(["yes", "no"]) }))
    .handler(({ input, context }) =>
      audited(actorOf(context), "governance.vote", { type: "proposal", id: input.proposalId }, async () => {
        // Weight: 1 base + floor(sqrt(clout)) — quadratic dampening so clout tilts, never dictates.
        const weight = 1 + Math.floor(Math.sqrt(Math.max(0, context.member.clout)));
        try {
          return await runTx("governance.vote", async (tx) => {
            const [proposal] = await tx.select().from(schema.proposals).where(eq(schema.proposals.id, input.proposalId));
            if (!proposal) throw new ORPCError("NOT_FOUND", { message: "Proposal not found" });
            if (proposal.status !== "open" || (proposal.closesAt ? new Date(proposal.closesAt).getTime() : 0) <= Date.now()) {
              throw new ORPCError("CONFLICT", { message: "Voting is closed for this proposal." });
            }
            await tx.insert(schema.votes).values({ proposalId: proposal.id, memberId: context.member.id, choice: input.choice, weight });
            const [row] = await tx
              .update(schema.proposals)
              .set({
                yesWeight: sql`${schema.proposals.yesWeight} + ${input.choice === "yes" ? weight : 0}`,
                noWeight: sql`${schema.proposals.noWeight} + ${input.choice === "no" ? weight : 0}`,
                voterCount: sql`${schema.proposals.voterCount} + 1`,
              })
              .where(and(eq(schema.proposals.id, proposal.id), eq(schema.proposals.status, "open")))
              .returning();
            if (!row) throw new ORPCError("CONFLICT", { message: "Voting closed while your vote was in flight." });
            await audit(tx, actorOf(context), { action: "governance.vote", outcome: "accepted", targetType: "proposal", targetId: proposal.id, summary: `${input.choice} x${weight}` });
            return { weight, method: "1 vote + floor(sqrt(clout)). Quadratic dampening keeps whales from owning outcomes." };
          });
        } catch (error) {
          if (isUniqueViolation(error)) throw new ORPCError("CONFLICT", { message: "You already voted on this one" });
          throw error;
        }
      }),
    ),

  finalize: adminProc.input(z.object({ proposalId: z.number().int().positive() })).handler(({ input, context }) =>
    audited(actorOf(context), "governance.finalize", { type: "proposal", id: input.proposalId }, () =>
      runTx("governance.finalize", (tx) => finalizeProposal(tx, input.proposalId, true)),
    ),
  ),

  /** Mutual Cover Reserve: what actually backs the "one brand falls, members are covered" claim. */
  reserve: publicProc.handler(async () => {
    const [reserve] = await db
      .select({ total: sql<number>`coalesce(sum(${schema.ledger.amountCents}), 0)` })
      .from(schema.ledger)
      .where(eq(schema.ledger.bucket, "reserve"));
    const reserveCents = Number(reserve?.total ?? 0);
    const exposureCents = await heldEscrowCents(db);
    const coverage = exposureCents > 0 ? reserveCents / exposureCents : 0;
    return {
      reserveCents,
      exposureCents,
      coverageRatio: coverage,
      target: 0.25,
      honest:
        coverage >= 0.25
          ? "Reserve currently covers a quarter of escrowed member capital. That is the target, not a guarantee — a total loss across every brand at once exceeds it."
          : "Reserve is below the 25% target. Until it clears the target, treat cover as partial and size tickets accordingly.",
      mechanics: [
        "A slice of every house fee is parked in the Reserve before the house takes anything.",
        "Each brand is a separate legal entity; the Reserve sits at the Hub and is not an asset of any operating brand.",
        "If a brand is halted, Reserve funds can be released by a passed member vote and a public House action — never automatically.",
        "The Reserve never funds projects and never pays the house.",
      ],
    };
  }),
};
