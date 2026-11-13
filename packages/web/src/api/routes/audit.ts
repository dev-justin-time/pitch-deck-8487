import { z } from "zod";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { logDecision } from "../lib/log";
import { adminProc } from "../middleware/auth";
import { db } from "../database/client";
import * as schema from "../database/schema";
import { TOTAL_BP } from "../lib/services/equity";

/**
 * Read-only admin views over the append-only audit trail and the books.
 * Reconciliation surfaces anomalies — it never rewrites a row. Legacy rows written before the
 * auth backend migration are reported separately so they are not confused with live faults.
 */

type Anomaly = { check: string; severity: "error" | "warn" | "info"; subject: string; detail: string };

export const audit = {
  recent: adminProc
    .input(
      z
        .object({
          action: z.string().trim().max(60).optional(),
          outcome: z.enum(["accepted", "rejected"]).optional(),
          limit: z.number().int().min(1).max(200).default(80),
        })
        .default({ limit: 80 }),
    )
    .handler(async ({ input }) => {
      const filters = [
        input.action ? sql`${schema.auditEvents.action} like ${`${input.action}%`}` : undefined,
        input.outcome ? eq(schema.auditEvents.outcome, input.outcome) : undefined,
      ].filter(Boolean);
      const rows = await db
        .select({ event: schema.auditEvents, handle: schema.members.handle })
        .from(schema.auditEvents)
        .leftJoin(schema.members, eq(schema.members.id, schema.auditEvents.actorMemberId))
        .where(filters.length ? and(...(filters as ReturnType<typeof eq>[])) : undefined)
        .orderBy(desc(schema.auditEvents.id))
        .limit(input.limit);
      const [counts] = await db
        .select({
          total: sql<number>`count(*)`,
          rejected: sql<number>`sum(case when ${schema.auditEvents.outcome} = 'rejected' then 1 else 0 end)`,
        })
        .from(schema.auditEvents);
      return {
        total: Number(counts?.total ?? 0),
        rejected: Number(counts?.rejected ?? 0),
        events: rows.map((r) => ({ ...r.event, actorHandle: r.handle })),
      };
    }),

  reconciliation: adminProc.handler(async () => {
    const anomalies: Anomaly[] = [];

    // 1. Wallet balance vs the latest wallet_entries row (members with entries only).
    const walletDrift = await db.all<{ id: number; handle: string; wallet: number; last: number }>(sql`
      select m.id as id, m.handle as handle, m.wallet_cents as wallet, we.balance_after_cents as last
      from members m
      join wallet_entries we on we.id = (select max(id) from wallet_entries w2 where w2.member_id = m.id)
      where m.wallet_cents != we.balance_after_cents`);
    for (const r of walletDrift) {
      anomalies.push({ check: "wallet_vs_entries", severity: "error", subject: `@${r.handle}`, detail: `Wallet ${r.wallet}c but last entry says ${r.last}c` });
    }
    const [legacyWallets] = await db.all<{ n: number }>(sql`
      select count(*) as n from members m where not exists (select 1 from wallet_entries w where w.member_id = m.id)`);

    // 2. Negative balances (should be impossible through the API).
    const negatives = await db
      .select({ handle: schema.members.handle, wallet: schema.members.walletCents, points: schema.members.points })
      .from(schema.members)
      .where(sql`${schema.members.walletCents} < 0 or ${schema.members.points} < 0`);
    for (const r of negatives) anomalies.push({ check: "negative_balance", severity: "error", subject: `@${r.handle}`, detail: `wallet ${r.wallet}c, points ${r.points}` });

    // 3. Open equity listings promising more than the seller holds.
    const overListed = await db.all<{ projectId: number; sellerId: number; listed: number; held: number }>(sql`
      select l.project_id as projectId, l.seller_id as sellerId, sum(l.equity_bp) as listed, coalesce(p.equity_bp, 0) as held
      from equity_listings l
      left join equity_positions p on p.project_id = l.project_id and p.member_id = l.seller_id
      where l.status = 'open'
      group by l.project_id, l.seller_id
      having sum(l.equity_bp) > coalesce(p.equity_bp, 0)`);
    for (const r of overListed) {
      anomalies.push({ check: "overlisted_equity", severity: "error", subject: `project ${r.projectId} / member ${r.sellerId}`, detail: `${r.listed} bp listed, ${r.held} bp held` });
    }

    // 4. Equity conservation per project.
    const equitySums = await db.all<{ projectId: number; total: number; holders: number }>(sql`
      select project_id as projectId, sum(equity_bp) as total, count(*) as holders from equity_positions group by project_id`);
    for (const r of equitySums) {
      if (Number(r.total) !== TOTAL_BP) anomalies.push({ check: "equity_conservation", severity: "error", subject: `project ${r.projectId}`, detail: `Positions sum to ${r.total} bp, expected ${TOTAL_BP}` });
    }
    const [unpositioned] = await db.all<{ n: number }>(sql`
      select count(*) as n from projects p where not exists (select 1 from equity_positions e where e.project_id = p.id)`);

    // 5. Held escrow: negative holds, holds on cancelled/foreclosed projects, ledger bucket drift.
    const badHolds = await db
      .select({ id: schema.investments.id, projectId: schema.investments.projectId, held: schema.investments.heldCents, amount: schema.investments.amountCents })
      .from(schema.investments)
      .where(sql`${schema.investments.heldCents} < 0 or ${schema.investments.heldCents} > ${schema.investments.amountCents}`);
    for (const r of badHolds) anomalies.push({ check: "held_escrow_bounds", severity: "error", subject: `ticket ${r.id}`, detail: `held ${r.held}c of ${r.amount}c` });
    const stranded = await db.all<{ projectId: number; status: string; held: number }>(sql`
      select i.project_id as projectId, p.status as status, sum(i.held_cents) as held
      from investments i join projects p on p.id = i.project_id
      where p.status in ('cancelled', 'foreclosed') group by i.project_id having sum(i.held_cents) > 0`);
    for (const r of stranded) anomalies.push({ check: "stranded_escrow", severity: "warn", subject: `project ${r.projectId}`, detail: `${r.held}c still held on a ${r.status} project` });
    const [held] = await db.select({ cents: sql<number>`coalesce(sum(${schema.investments.heldCents}), 0)` }).from(schema.investments);
    const [bucket] = await db.select({ cents: sql<number>`coalesce(sum(${schema.ledger.amountCents}), 0)` }).from(schema.ledger).where(eq(schema.ledger.bucket, "escrow"));
    const heldCents = Number(held?.cents ?? 0);
    const bucketCents = Number(bucket?.cents ?? 0);
    if (heldCents !== bucketCents) {
      anomalies.push({ check: "escrow_bucket_drift", severity: "info", subject: "escrow", detail: `Held tickets ${heldCents}c vs escrow ledger net ${bucketCents}c (legacy releases were not booked as outflows)` });
    }

    // 6. Duplicates: distributions per period, task rewards per task.
    const dupDist = await db.all<{ projectId: number; period: string; n: number }>(sql`
      select project_id as projectId, period, count(*) as n from distributions group by project_id, period having count(*) > 1`);
    for (const r of dupDist) anomalies.push({ check: "duplicate_distribution", severity: "error", subject: `project ${r.projectId}`, detail: `${r.n} runs for ${r.period}` });
    const dupRewards = await db.all<{ note: string; n: number }>(sql`
      select note, count(*) as n from ledger where kind = 'task_reward' and note like 'Task #%' group by note having count(*) > 1`);
    for (const r of dupRewards) anomalies.push({ check: "duplicate_task_reward", severity: "error", subject: r.note.split(":")[0], detail: `${r.n} reward rows` });

    // 7. Legacy shape: projects whose milestones advanced without a reviewer, auto-approved tasks.
    const [legacyMilestones] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.milestones)
      .where(and(eq(schema.milestones.status, "verified"), sql`${schema.milestones.reviewerId} is null`));
    const [legacyTasks] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.status, "approved"), sql`${schema.tasks.reviewerId} is null`));
    const [staleOpen] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.proposals)
      .where(and(eq(schema.proposals.status, "open"), lt(schema.proposals.closesAt, new Date())));

    const legacy = {
      membersWithoutWalletHistory: Number(legacyWallets?.n ?? 0),
      projectsWithoutPositions: Number(unpositioned?.n ?? 0),
      milestonesVerifiedWithoutReviewer: Number(legacyMilestones?.n ?? 0),
      tasksApprovedWithoutReviewer: Number(legacyTasks?.n ?? 0),
      expiredProposalsAwaitingFinalize: Number(staleOpen?.n ?? 0),
    };
    for (const [k, v] of Object.entries(legacy)) {
      if (v > 0) anomalies.push({ check: `legacy:${k}`, severity: "info", subject: "pre-migration data", detail: `${v} row(s)` });
    }

    const errors = anomalies.filter((a) => a.severity === "error").length;
    logDecision("reconciliation", "Run complete", { errors, total: anomalies.length });
    return {
      ranAt: new Date().toISOString(),
      healthy: errors === 0,
      errors,
      heldEscrowCents: heldCents,
      escrowBucketNetCents: bucketCents,
      legacy,
      anomalies,
    };
  }),
};
