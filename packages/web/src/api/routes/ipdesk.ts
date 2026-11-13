import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { ORPCError } from "@orpc/server";
import { logDecision } from "../lib/log";
import { actorOf, memberProc, publicProc } from "../middleware/auth";
import { db } from "../database/client";
import * as schema from "../database/schema";
import { TEMPLATES, renderDocument, templateFor } from "../lib/ip-templates";
import { audit, audited } from "../lib/services/audit";
import { idempotencyKey, once } from "../lib/services/idempotency";
import { chargeService } from "../lib/services/ledger";

const kindEnum = z.enum([
  "provisional_patent",
  "copyright_registration",
  "trademark_intent",
  "nda",
  "work_for_hire",
  "ip_assignment",
]);

/** Desk fee for document preparation. Government filing fees are never ours. */
const DESK_FEE_CENTS: Record<string, number> = {
  provisional_patent: 4900,
  copyright_registration: 2900,
  trademark_intent: 3900,
  nda: 0,
  work_for_hire: 900,
  ip_assignment: 1900,
};

export const ipdesk = {
  templates: publicProc.handler(() =>
    TEMPLATES.map((t) => ({ ...t, deskFeeCents: DESK_FEE_CENTS[t.kind] ?? 0 })),
  ),

  template: publicProc.input(z.object({ kind: kindEnum })).handler(({ input }) => {
    const t = templateFor(input.kind);
    if (!t) throw new ORPCError("NOT_FOUND", { message: "No such template" });
    return { ...t, deskFeeCents: DESK_FEE_CENTS[t.kind] ?? 0 };
  }),

  /** Renders the document without charging — the member reads it before paying. */
  preview: publicProc
    .input(z.object({ kind: kindEnum, formData: z.record(z.string(), z.string()) }))
    .handler(({ input }) => ({
      documentText: renderDocument(input.kind, input.formData),
      deskFeeCents: DESK_FEE_CENTS[input.kind] ?? 0,
    })),

  generate: memberProc
    .input(
      z.object({
        projectId: z.number().int().positive().optional(),
        kind: kindEnum,
        title: z.string().trim().min(2).max(140),
        formData: z.record(z.string(), z.string().max(4000)),
        idempotencyKey,
      }),
    )
    .handler(({ input, context }) =>
      audited(actorOf(context), "ipdesk.generate", undefined, async () => {
        const spec = templateFor(input.kind);
        if (!spec) throw new ORPCError("NOT_FOUND", { message: "No such template" });
        const missing = spec.fields.filter((f) => f.required && !input.formData[f.name]?.trim()).map((f) => f.label);
        if (missing.length) throw new ORPCError("BAD_REQUEST", { message: `Still needed: ${missing.join(", ")}` });
        const fee = DESK_FEE_CENTS[input.kind] ?? 0;
        const member = context.member;
        const { idempotencyKey: key, ...payload } = input;
        return once({ memberId: member.id, scope: "ipdesk.generate", key, payload }, async (tx) => {
          if (input.projectId) {
            const [project] = await tx.select({ creatorId: schema.projects.creatorId }).from(schema.projects).where(eq(schema.projects.id, input.projectId));
            if (!project) throw new ORPCError("NOT_FOUND", { message: "Project not found" });
            if (project.creatorId !== member.id) throw new ORPCError("FORBIDDEN", { message: "Only the project's creator can attach IP paperwork to it" });
          }
          if (fee > 0) {
            await chargeService(tx, { kind: "ip_desk", amountCents: fee, memberId: member.id, projectId: input.projectId ?? null, note: `IP Desk: ${spec.title}` });
          }
          // Form contents are never logged — only the template kind and fee.
          logDecision("ipdesk", "Draft preparation, no government filing", { memberId: member.id, kind: input.kind, deskCents: fee });
          const documentText = renderDocument(input.kind, input.formData);
          const [filing] = await tx
            .insert(schema.ipFilings)
            .values({
              memberId: member.id,
              projectId: input.projectId ?? null,
              kind: input.kind,
              title: input.title,
              formData: JSON.stringify(input.formData),
              documentText,
              status: "generated",
            })
            .returning();
          await tx.update(schema.members).set({ clout: sql`${schema.members.clout} + 5` }).where(eq(schema.members.id, member.id));
          await audit(tx, actorOf(context), { action: "ipdesk.generate", outcome: "accepted", targetType: "ip_filing", targetId: filing.id, summary: `${input.kind} draft, desk fee ${fee}c` });
          return filing;
        });
      }),
    ),

  mine: memberProc.handler(({ context }) =>
    db
      .select({
        id: schema.ipFilings.id,
        projectId: schema.ipFilings.projectId,
        kind: schema.ipFilings.kind,
        title: schema.ipFilings.title,
        status: schema.ipFilings.status,
        createdAt: schema.ipFilings.createdAt,
      })
      .from(schema.ipFilings)
      .where(eq(schema.ipFilings.memberId, context.member.id))
      .orderBy(desc(schema.ipFilings.createdAt)),
  ),

  get: memberProc.input(z.object({ filingId: z.number().int().positive() })).handler(async ({ input, context }) => {
    const [filing] = await db.select().from(schema.ipFilings).where(eq(schema.ipFilings.id, input.filingId));
    if (!filing || filing.memberId !== context.member.id) throw new ORPCError("NOT_FOUND", { message: "Filing not found" });
    return filing;
  }),

  requestAttorneyReview: memberProc.input(z.object({ filingId: z.number().int().positive() })).handler(({ input, context }) =>
    audited(actorOf(context), "ipdesk.attorneyReview", { type: "ip_filing", id: input.filingId }, async () => {
      const [row] = await db
        .update(schema.ipFilings)
        .set({ status: "attorney_review" })
        .where(and(eq(schema.ipFilings.id, input.filingId), eq(schema.ipFilings.memberId, context.member.id), eq(schema.ipFilings.status, "generated")))
        .returning({ id: schema.ipFilings.id });
      if (!row) {
        const [filing] = await db.select({ memberId: schema.ipFilings.memberId, status: schema.ipFilings.status }).from(schema.ipFilings).where(eq(schema.ipFilings.id, input.filingId));
        if (!filing || filing.memberId !== context.member.id) throw new ORPCError("NOT_FOUND", { message: "Filing not found" });
        throw new ORPCError("CONFLICT", { message: "This draft is already queued for attorney review" });
      }
      await audit(db, actorOf(context), { action: "ipdesk.attorneyReview", outcome: "accepted", targetType: "ip_filing", targetId: row.id, summary: "Queued for attorney review" });
      return {
        ok: true,
        message:
          "Queued for the reviewing attorney panel. In production this routes to a licensed practitioner in the relevant jurisdiction at a flat fee; the Desk never files on your behalf without that sign-off.",
      };
    }),
  ),
};
