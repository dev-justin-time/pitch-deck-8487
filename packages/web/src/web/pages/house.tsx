import { useRef, useState } from "react";
import { Link } from "wouter";
import { Btn, Card, Empty, ErrorLine, Field, Loading, NeedAdmin, OkLine, PageHead, Pill, Stat, newKey } from "../components/bits";
import { useSession } from "../components/session";
import { useCureNotice, useFeatures, useForeclose, useFundFeature, useHouseLedger, useHouseNotices, useIssueDefault, useIssueGrace, useWatchlist } from "../queries/house";
import { useEscrowQueue, useEscrowReview } from "../queries/payouts";
import { useGrantCredit, useIdentityQueue, useReviewIdentity } from "../queries/identity";
import { useReviewTask, useTaskQueue } from "../queries/clout";
import { useAuditTrail, useReconciliation } from "../queries/audit";
import { useSeedRun } from "../queries/network";
import { date, money } from "../lib/format";
import { log } from "../lib/log";

/**
 * House desk. Every read and write here is adminProc on the server; NeedAdmin only avoids
 * pointless 403s. The acting admin is taken from the session server-side — no ids are sent.
 */
export default function HousePage() {
  return (
    <NeedAdmin>
      <House />
    </NeedAdmin>
  );
}

const SECTIONS = [
  ["escrow", "Escrow"],
  ["identity", "Identity"],
  ["tasks", "Tasks"],
  ["ladder", "Accommodation"],
  ["notices", "Notices"],
  ["treasury", "Credit & features"],
  ["recon", "Reconciliation"],
  ["audit", "Audit trail"],
  ["ledger", "Ledger"],
] as const;

/** Shared note box state: one free-text note per queue row, keyed by row. */
function useNotes() {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const get = (k: string) => notes[k] ?? "";
  const ok = (k: string, min: number) => get(k).trim().length >= min;
  const box = (k: string, placeholder: string, max = 600) => (
    <textarea
      className="k-input mt-3"
      aria-label={placeholder}
      placeholder={placeholder}
      maxLength={max}
      value={get(k)}
      onChange={(e) => setNotes((n) => ({ ...n, [k]: e.target.value }))}
    />
  );
  const clear = (k: string) => setNotes((n) => ({ ...n, [k]: "" }));
  return { get, ok, box, clear };
}

function H2({ id, children, aside }: { id: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div id={id} className="mt-12 flex scroll-mt-24 flex-wrap items-end justify-between gap-3 border-b border-border pb-2">
      <h2 className="k-display text-3xl">{children}</h2>
      {aside}
    </div>
  );
}

function House() {
  const { isAdmin } = useSession();
  const ledger = useHouseLedger(isAdmin);
  const seed = useSeedRun();

  return (
    <div>
      <PageHead kicker="House · Simulated operations" title="The open books">
        10% house take. A quarter of that fee to the Reserve. Accommodation before enforcement. Every action here is written to an append-only audit trail. These are simulated operations, not licensed custody.
      </PageHead>

      {ledger.isLoading ? (
        <Loading />
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <Stat label="House (sim)" value={money(ledger.data?.houseCents)} sub={`${(ledger.data?.rates.houseRate ?? 0) * 100}% of each transaction`} />
          <Stat label="Reserve" value={money(ledger.data?.reserveCents)} sub={`${(ledger.data?.rates.reserveRate ?? 0) * 100}% of the house fee`} />
          <Stat label="Feature fund" value={money(ledger.data?.featureFundCents)} sub="From foreclosure residuals" />
          <Stat label="Escrow held" value={money(ledger.data?.escrowHeldCents)} sub={`Ledger net ${money(ledger.data?.escrowBucketNetCents)}`} />
        </div>
      )}
      {ledger.data && (
        <p className="mt-3 font-mono text-xs text-muted-foreground">
          {ledger.data.network.memberCount} members · {ledger.data.network.projects} rounds ({ledger.data.network.live} live, {ledger.data.network.defaulting} in default notice, {ledger.data.network.foreclosed} foreclosed) ·
          wallet float {money(ledger.data.network.walletFloatCents)} · {ledger.data.network.pointsOutstanding.toLocaleString()} points outstanding
        </p>
      )}
      <ErrorLine error={ledger.error} />

      {ledger.data?.network.projects === 0 && (
        <Card className="mt-6">
          <div className="k-label">Empty network</div>
          <p className="mt-2 text-sm">No rounds exist yet. You can load the demo network (sample creators, rounds and tickets). The loader refuses to run once any project exists.</p>
          <Btn
            className="mt-3"
            loading={seed.isPending}
            onClick={() => {
              log.decide("house", "Demo network load requested");
              seed.mutate(undefined);
            }}
          >
            Load demo network
          </Btn>
          <OkLine>{seed.data && (seed.data.skipped ? seed.data.message : `Loaded ${seed.data.projects} demo projects.`)}</OkLine>
          <ErrorLine error={seed.error} />
        </Card>
      )}

      <nav className="mt-8 flex flex-wrap gap-2" aria-label="House desk sections">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="k-chip hover:border-primary">
            {label}
          </a>
        ))}
      </nav>

      <EscrowDesk />
      <IdentityDesk />
      <TaskDesk />
      <Ladder />
      <NoticesDesk />
      <Treasury />
      <Reconciliation />
      <AuditTrail />

      <H2 id="ledger" aside={<Link to="/hub" className="k-link text-sm">Feature tallies →</Link>}>Recent ledger</H2>
      <Card className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr>
                <th className="p-2">Date</th>
                <th>Bucket</th>
                <th>Kind</th>
                <th>Amount</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {ledger.data?.recent.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="whitespace-nowrap p-2">{date(r.createdAt)}</td>
                  <td>{r.bucket}</td>
                  <td>{r.kind}</td>
                  <td className="whitespace-nowrap">{money(r.amountCents)}</td>
                  <td className="min-w-56 p-2">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function EscrowDesk() {
  const { isAdmin } = useSession();
  const queue = useEscrowQueue(isAdmin);
  const review = useEscrowReview();
  const n = useNotes();
  const [ok, setOk] = useState<string>();

  return (
    <>
      <H2 id="escrow" aside={<Pill>{queue.data?.length ?? 0} waiting</Pill>}>Escrow review</H2>
      {queue.isLoading ? (
        <Loading />
      ) : (
        <div className="mt-4 space-y-4">
          {!queue.data?.length && <Empty>No milestone evidence awaiting review.</Empty>}
          {queue.data?.map((m) => {
            const k = `m${m.id}`;
            const send = (approve: boolean) => {
              log.decide("house.escrow", "Evidence decision submitted", { milestoneId: m.id, approve });
              review.mutate(
                { milestoneId: m.id, approve, note: n.get(k) },
                {
                  onSuccess: (r) => {
                    n.clear(k);
                    setOk(r.approved ? `Approved "${m.title}". ${money(r.releasedCents)} released; now stage ${r.stage}.` : `Returned "${m.title}" with a cure path. No penalty.`);
                  },
                },
              );
            };
            return (
              <Card key={m.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="k-label">
                    {m.projectTitle} · Stage {m.stage} · @{m.creatorHandle}
                  </div>
                  {m.ownProject && <Pill tone="warn">Your project — another admin must review</Pill>}
                </div>
                <h3 className="mt-2 font-semibold">{m.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm">{m.evidence}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {m.escrowVendor ?? "Escrow agent unassigned"} · {money(m.stageHeldCents)} held across {m.stageHeldTickets} stage-{m.stage} tickets · {money(m.raisedCents)} raised overall
                </p>
                {!m.ownProject && (
                  <>
                    {n.box(k, "Written review note (5+ characters)", 800)}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Btn disabled={!n.ok(k, 5)} loading={review.isPending && review.variables?.milestoneId === m.id && review.variables.approve} onClick={() => send(true)}>
                        Approve & release {money(m.stageHeldCents)}
                      </Btn>
                      <Btn variant="outline" disabled={!n.ok(k, 5)} loading={review.isPending && review.variables?.milestoneId === m.id && !review.variables.approve} onClick={() => send(false)}>
                        Return for revision
                      </Btn>
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <OkLine>{ok}</OkLine>
      <ErrorLine error={queue.error ?? review.error} />
    </>
  );
}

function IdentityDesk() {
  const { isAdmin, member } = useSession();
  const queue = useIdentityQueue(isAdmin);
  const review = useReviewIdentity();
  const n = useNotes();
  const [ok, setOk] = useState<string>();

  return (
    <>
      <H2 id="identity" aside={<Pill>{queue.data?.length ?? 0} pending</Pill>}>Identity requests</H2>
      <p className="mt-2 text-sm text-muted-foreground">
        Simulated tier review. "Accredited" unlocks Orbital backing and score lookups — there is no level or admin bypass, so this queue is the only path. No documents are collected.
      </p>
      {queue.isLoading ? (
        <Loading />
      ) : (
        <div className="mt-4 space-y-4">
          {!queue.data?.length && <Empty>No identity requests waiting.</Empty>}
          {queue.data?.map((r) => {
            const k = `i${r.id}`;
            const own = r.memberId === member?.id;
            const send = (decision: "approve" | "reject") => {
              log.decide("house.identity", "Identity decision submitted", { requestId: r.id, decision, tier: r.tier });
              review.mutate(
                { requestId: r.id, decision, note: n.get(k) },
                {
                  onSuccess: () => {
                    n.clear(k);
                    setOk(`@${r.handle}: ${decision === "approve" ? `set to ${r.tier}` : "not approved"}.`);
                  },
                },
              );
            };
            return (
              <Card key={r.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="k-label">
                    @{r.handle} · L{r.level} · now {r.currentStatus} → requests {r.tier}
                  </div>
                  <span className="text-xs text-muted-foreground">{date(r.createdAt)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{r.statement}</p>
                {own ? (
                  <p className="mt-3 text-sm text-warn">Your own request — another administrator has to review it.</p>
                ) : (
                  <>
                    {n.box(k, "Reviewer note (3+ characters)", 400)}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Btn disabled={!n.ok(k, 3)} loading={review.isPending && review.variables?.requestId === r.id} onClick={() => send("approve")}>
                        Approve {r.tier}
                      </Btn>
                      <Btn variant="outline" disabled={!n.ok(k, 3)} loading={review.isPending && review.variables?.requestId === r.id} onClick={() => send("reject")}>
                        Decline
                      </Btn>
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <OkLine>{ok}</OkLine>
      <ErrorLine error={queue.error ?? review.error} />
    </>
  );
}

function TaskDesk() {
  const { isAdmin } = useSession();
  const queue = useTaskQueue(isAdmin);
  const review = useReviewTask();
  const n = useNotes();
  const [ok, setOk] = useState<string>();

  return (
    <>
      <H2 id="tasks" aside={<Pill>{queue.data?.length ?? 0} submitted</Pill>}>Task review</H2>
      <p className="mt-2 text-sm text-muted-foreground">Rewards are paid exactly once, on approval. Rejection lets the member revise and resubmit. You cannot review your own tasks.</p>
      {queue.isLoading ? (
        <Loading />
      ) : (
        <div className="mt-4 space-y-4">
          {!queue.data?.length && <Empty>No task proof waiting.</Empty>}
          {queue.data?.map((t) => {
            const k = `t${t.id}`;
            const send = (approve: boolean) => {
              log.decide("house.tasks", "Task decision submitted", { taskId: t.id, approve });
              review.mutate(
                { taskId: t.id, approve, note: n.get(k) },
                {
                  onSuccess: () => {
                    n.clear(k);
                    setOk(approve ? `Approved @${t.handle}: +${t.reward.points} pts, +${t.reward.clout} clout.` : `Returned to @${t.handle} for revision.`);
                  },
                },
              );
            };
            return (
              <Card key={t.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="k-label">
                    @{t.handle} · {t.kind}
                    {t.projectId ? ` · project #${t.projectId}` : ""}
                    {t.revisionCount > 0 ? ` · revision ${t.revisionCount}` : ""}
                  </div>
                  <Pill tone="good">
                    +{t.reward.points} pts · +{t.reward.clout} clout
                  </Pill>
                </div>
                <h3 className="mt-2 font-semibold">{t.title}</h3>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm">{t.proof ?? "No proof text."}</p>
                {t.ownTask ? (
                  <p className="mt-3 text-sm text-warn">Your own task — another administrator has to review it.</p>
                ) : (
                  <>
                    {n.box(k, "Review note (3+ characters)")}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Btn disabled={!n.ok(k, 3)} loading={review.isPending && review.variables?.taskId === t.id} onClick={() => send(true)}>
                        Approve & reward
                      </Btn>
                      <Btn variant="outline" disabled={!n.ok(k, 3)} loading={review.isPending && review.variables?.taskId === t.id} onClick={() => send(false)}>
                        Return for revision
                      </Btn>
                    </div>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <OkLine>{ok}</OkLine>
      <ErrorLine error={queue.error ?? review.error} />
    </>
  );
}

function Ladder() {
  const { isAdmin } = useSession();
  const watch = useWatchlist(isAdmin);
  const grace = useIssueGrace();
  const def = useIssueDefault();
  const foreclose = useForeclose();
  const n = useNotes();
  const [confirm, setConfirm] = useState<number | null>(null);
  const [ok, setOk] = useState<string>();
  const keys = useRef<Record<number, string>>({});
  const keyFor = (id: number) => (keys.current[id] ??= newKey());

  return (
    <>
      <H2 id="ladder">Accommodation ladder</H2>
      <p className="mt-2 text-sm text-muted-foreground">Grace → expired grace → default notice → expired cure window → foreclosure. Difficulty is not a default.</p>
      {watch.isLoading ? (
        <Loading />
      ) : (
        <div className="mt-4 space-y-4">
          {!watch.data?.length && <Empty>No quiet projects on the watchlist.</Empty>}
          {watch.data?.map((p) => {
            const k = `p${p.id}`;
            const reason = n.get(k);
            const valid = n.ok(k, 5);
            const expired = !!p.graceUntil && new Date(p.graceUntil).getTime() < Date.now();
            return (
              <Card key={p.id}>
                <div className="flex flex-wrap justify-between gap-3">
                  <Link className="k-link font-semibold" to={`/forge/project/${p.id}`}>
                    {p.title}
                  </Link>
                  <span className="k-chip">
                    {p.idleDays} idle days · {p.escalation}
                  </span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{p.recommendation}</p>
                {p.graceUntil && <p className="mt-2 text-xs">Window {expired ? "closed" : "closes"} {date(p.graceUntil)}</p>}
                {n.box(k, "Written reason or recovery plan (5+ characters)")}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn
                    variant="outline"
                    disabled={!valid || p.status === "default_notice"}
                    loading={grace.isPending}
                    onClick={() => {
                      log.decide("house.ladder", "Grace opened", { projectId: p.id });
                      grace.mutate({ projectId: p.id, reason }, { onSuccess: () => setOk(`Grace opened on "${p.title}".`) });
                    }}
                  >
                    Open grace
                  </Btn>
                  <Btn
                    variant="outline"
                    disabled={!valid || !expired || p.status === "default_notice"}
                    loading={def.isPending}
                    onClick={() => {
                      log.decide("house.ladder", "Default notice issued", { projectId: p.id });
                      def.mutate({ projectId: p.id, reason }, { onSuccess: () => setOk(`Default notice issued on "${p.title}".`) });
                    }}
                  >
                    Default notice
                  </Btn>
                  <Btn variant="danger" disabled={!valid || p.status !== "default_notice" || !expired} loading={foreclose.isPending} onClick={() => setConfirm(p.id)}>
                    Foreclose…
                  </Btn>
                </div>
                {confirm === p.id && (
                  <div className="mt-4 border border-destructive p-4">
                    <p className="text-sm">Redistribute this project's residual escrow and list creator equity? Backers keep their equity. This cannot be undone.</p>
                    <div className="mt-3 flex gap-2">
                      <Btn
                        variant="danger"
                        loading={foreclose.isPending}
                        onClick={() => {
                          log.decide("house.ladder", "Foreclosure confirmed", { projectId: p.id });
                          foreclose.mutate(
                            { projectId: p.id, reason, idempotencyKey: keyFor(p.id) },
                            {
                              onSuccess: () => {
                                setConfirm(null);
                                delete keys.current[p.id];
                                setOk(`"${p.title}" foreclosed and redistributed.`);
                              },
                            },
                          );
                        }}
                      >
                        Confirm redistribution
                      </Btn>
                      <Btn variant="outline" onClick={() => setConfirm(null)}>
                        Keep project
                      </Btn>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <OkLine>{ok}</OkLine>
      <ErrorLine error={watch.error ?? grace.error ?? def.error ?? foreclose.error} />
    </>
  );
}

function NoticesDesk() {
  const { isAdmin } = useSession();
  const notices = useHouseNotices(isAdmin);
  const cure = useCureNotice();
  const n = useNotes();
  const [ok, setOk] = useState<string>();

  return (
    <>
      <H2 id="notices">Open notices</H2>
      {notices.isLoading ? (
        <Loading />
      ) : (
        <div className="mt-4 space-y-4">
          {!notices.data?.length && <Empty>No open notices.</Empty>}
          {notices.data?.map((x) => {
            const k = `n${x.id}`;
            return (
              <Card key={x.id}>
                <div className="k-label">
                  @{x.handle} · {x.kind}
                </div>
                <h3 className="mt-2 font-semibold">{x.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{x.body}</p>
                {x.recoveryPath && (
                  <p className="mt-2 text-sm">
                    <b>Recovery:</b> {x.recoveryPath}
                  </p>
                )}
                {["grace", "default_notice", "cure_plan"].includes(x.kind) && (
                  <>
                    {n.box(k, "Resolution (5+ characters)")}
                    <Btn
                      className="mt-3"
                      disabled={!n.ok(k, 5)}
                      loading={cure.isPending && cure.variables?.noticeId === x.id}
                      onClick={() => {
                        log.decide("house.notices", "Notice resolved", { noticeId: x.id, kind: x.kind });
                        cure.mutate({ noticeId: x.id, resolution: n.get(k) }, { onSuccess: () => setOk(`Notice for @${x.handle} resolved; project reinstated.`) });
                      }}
                    >
                      Resolve & reinstate
                    </Btn>
                  </>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <OkLine>{ok}</OkLine>
      <ErrorLine error={notices.error ?? cure.error} />
    </>
  );
}

function Treasury() {
  const grant = useGrantCredit();
  const fund = useFundFeature();
  const features = useFeatures();
  const [handle, setHandle] = useState("");
  const [amount, setAmount] = useState("25");
  const [reason, setReason] = useState("");
  const [featureId, setFeatureId] = useState("");
  const [fundAmount, setFundAmount] = useState("10");
  const grantKey = useRef(newKey());
  const fundKey = useRef(newKey());

  const grantCents = Math.round(Number(amount) * 100);
  const grantValid = handle.trim().length >= 2 && grantCents >= 100 && grantCents <= 100000 && reason.trim().length >= 3;
  const fundCents = Math.round(Number(fundAmount) * 100);
  const chosen = features.data?.find((f) => String(f.id) === featureId);
  const fundValid = !!chosen && fundCents >= 100;

  return (
    <>
      <H2 id="treasury">Credit & features</H2>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card>
          <div className="k-label">Grant simulated credit</div>
          <p className="mt-2 text-sm text-muted-foreground">Members cannot top themselves up. Grants are $1–$1,000 of club credit, logged to the ledger, the member's notices and the audit trail.</p>
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!grantValid) return;
              log.decide("house.treasury", "Credit grant submitted", { amountCents: grantCents });
              grant.mutate(
                { handle: handle.trim().replace(/^@/, ""), amountCents: grantCents, reason: reason.trim(), idempotencyKey: grantKey.current },
                {
                  onSuccess: () => {
                    grantKey.current = newKey();
                    setReason("");
                  },
                },
              );
            }}
          >
            <Field label="Member handle">
              <input className="k-input" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="mara_k" autoComplete="off" />
            </Field>
            <Field label="Amount (USD)" help="$1.00 – $1,000.00">
              <input className="k-input" type="number" min={1} max={1000} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Reason">
              <input className="k-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Onboarding credit" />
            </Field>
            <Btn type="submit" disabled={!grantValid} loading={grant.isPending}>
              Grant {money(grantCents)}
            </Btn>
          </form>
          <OkLine>{grant.data && `@${grant.data.handle} now holds ${money(grant.data.balanceCents)}.`}</OkLine>
          <ErrorLine error={grant.error} />
        </Card>

        <Card>
          <div className="k-label">Allocate the feature fund</div>
          <p className="mt-2 text-sm text-muted-foreground">Foreclosure residuals fund member-voted features. Allocation is manual and public; a feature reaching its target moves to "building".</p>
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!fundValid || !chosen) return;
              log.decide("house.treasury", "Feature allocation submitted", { featureId: chosen.id, amountCents: fundCents });
              fund.mutate({ featureId: chosen.id, amountCents: fundCents, idempotencyKey: fundKey.current }, { onSuccess: () => (fundKey.current = newKey()) });
            }}
          >
            <Field label="Feature">
              <select className="k-input" value={featureId} onChange={(e) => setFeatureId(e.target.value)}>
                <option value="">Choose…</option>
                {features.data?.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title} — {money(f.fundedCents)} / {money(f.targetCents)} · {f.votes} votes
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount (USD)" help={chosen ? `${money(Math.max(0, chosen.targetCents - chosen.fundedCents))} left to target` : undefined}>
              <input className="k-input" type="number" min={1} step={1} value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} />
            </Field>
            <Btn type="submit" disabled={!fundValid} loading={fund.isPending}>
              Allocate {money(fundCents)}
            </Btn>
          </form>
          <OkLine>{fund.data && `Funded ${money(fund.data.fundedCents)} · status ${fund.data.status}.`}</OkLine>
          <ErrorLine error={fund.error ?? features.error} />
        </Card>
      </div>
    </>
  );
}

function Reconciliation() {
  const { isAdmin } = useSession();
  const recon = useReconciliation(isAdmin);
  const tone = (s: string) => (s === "error" ? "bad" : s === "warn" ? "warn" : "muted") as "bad" | "warn" | "muted";

  return (
    <>
      <H2
        id="recon"
        aside={
          <Btn variant="outline" loading={recon.isFetching} onClick={() => recon.refetch()}>
            Re-run checks
          </Btn>
        }
      >
        Reconciliation
      </H2>
      <p className="mt-2 text-sm text-muted-foreground">Read-only checks over wallets, equity, escrow and rewards. Anomalies are surfaced, never rewritten.</p>
      {recon.isLoading ? (
        <Loading />
      ) : recon.data ? (
        <Card className="mt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Pill tone={recon.data.healthy ? "good" : "bad"}>{recon.data.healthy ? "Books balance" : `${recon.data.errors} error(s)`}</Pill>
            <span className="font-mono text-xs text-muted-foreground">
              ran {date(recon.data.ranAt)} · held {money(recon.data.heldEscrowCents)} · escrow ledger net {money(recon.data.escrowBucketNetCents)}
            </span>
          </div>
          {recon.data.anomalies.length === 0 ? (
            <p className="mt-3 text-sm">No anomalies.</p>
          ) : (
            <ul className="mt-4 space-y-2 text-sm">
              {recon.data.anomalies.map((a, i) => (
                <li key={`${a.check}-${i}`} className="flex flex-wrap items-baseline gap-2 border-t border-border pt-2">
                  <Pill tone={tone(a.severity)}>{a.severity}</Pill>
                  <span className="font-mono text-xs">{a.check}</span>
                  <span className="text-muted-foreground">{a.subject}</span>
                  <span>— {a.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}
      <ErrorLine error={recon.error} />
    </>
  );
}

function AuditTrail() {
  const { isAdmin } = useSession();
  const [outcome, setOutcome] = useState<"" | "accepted" | "rejected">("");
  const [action, setAction] = useState("");
  const trail = useAuditTrail(isAdmin, { outcome: outcome || undefined, action: action.trim() || undefined });

  return (
    <>
      <H2 id="audit" aside={trail.data && <span className="font-mono text-xs text-muted-foreground">{trail.data.total} events · {trail.data.rejected} rejected</span>}>
        Audit trail
      </H2>
      <div className="mt-4 flex flex-wrap gap-3">
        <input className="k-input max-w-56" placeholder="Action prefix, e.g. escrow." value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action prefix" />
        <select className="k-input max-w-44" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} aria-label="Filter by outcome">
          <option value="">All outcomes</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>
      <Card className="mt-4">
        {trail.isLoading ? (
          <Loading />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr>
                  <th className="p-2">When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Outcome</th>
                  <th>Target</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {trail.data?.events.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="whitespace-nowrap p-2">{date(e.createdAt)}</td>
                    <td>{e.actorHandle ? `@${e.actorHandle}` : "—"}</td>
                    <td className="font-mono">{e.action}</td>
                    <td>
                      <Pill tone={e.outcome === "rejected" ? "bad" : "good"}>{e.outcome}</Pill>
                    </td>
                    <td className="whitespace-nowrap">{e.targetType ? `${e.targetType} ${e.targetId ?? ""}` : "—"}</td>
                    <td className="min-w-56 p-2">{e.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!trail.data?.events.length && <p className="p-3 text-sm text-muted-foreground">No events match.</p>}
          </div>
        )}
        <ErrorLine error={trail.error} />
      </Card>
    </>
  );
}
