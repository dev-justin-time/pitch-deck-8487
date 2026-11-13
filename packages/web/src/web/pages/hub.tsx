import { useState } from "react";
import { Link } from "wouter";
import { Btn, Card, Empty, ErrorLine, Field, Loading, OkLine, PageHead, Pill, Stat } from "../components/bits";
import { useSession } from "../components/session";
import {
  useClaimTask,
  useFinalizeProposal,
  useMyTasks,
  useProposals,
  usePropose,
  useReserve,
  useSubmitTask,
  useTaskBoard,
  useVote,
} from "../queries/clout";
import { useFeatures, useVoteFeature } from "../queries/house";
import { useProjects } from "../queries/projects";
import { ago, date, money, ratio } from "../lib/format";
import { log } from "../lib/log";

type TaskKind = "marketing" | "diligence" | "referral" | "moderation" | "translation";
const TASK_TONE: Record<string, "muted" | "good" | "warn" | "bad"> = { claimed: "muted", submitted: "warn", approved: "good", rejected: "bad" };
const PROPOSAL_TONE: Record<string, "muted" | "good" | "warn" | "bad"> = { open: "warn", passed: "good", rejected: "bad" };

export default function HubPage() {
  const reserve = useReserve();
  return (
    <div>
      <PageHead kicker="Kinship Hub · Trust layer" title="Build the commons">
        The Hub holds only the Mutual Cover Reserve. It does not hold project capital. Contribution earns influence; it doesn't buy certainty.
      </PageHead>
      {reserve.isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Stat label="Reserve (sim)" value={money(reserve.data?.reserveCents)} />
            <Stat label="Escrow exposure (sim)" value={money(reserve.data?.exposureCents)} sub="sum of ticket value still held" />
            <Stat label="Coverage · not a guarantee" value={ratio(reserve.data?.coverageRatio)} sub={`${ratio(reserve.data?.target, 0)} target`} />
          </div>
          <Card className="mt-4">
            <p className="text-sm">{reserve.data?.honest}</p>
            <ul className="mt-4 list-disc space-y-2 pl-5 text-xs text-muted-foreground">
              {reserve.data?.mechanics.map((m) => <li key={m}>{m}</li>)}
            </ul>
          </Card>
        </>
      )}
      <ErrorLine error={reserve.error} />

      <Tasks />

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <Governance />
        <Features />
      </div>
    </div>
  );
}

function Tasks() {
  const { member } = useSession();
  const signedIn = !!member;
  const board = useTaskBoard();
  const tasks = useMyTasks(signedIn);
  const projects = useProjects();
  const claim = useClaimTask();
  const submit = useSubmitTask();
  const [proof, setProof] = useState<Record<number, string>>({});
  const [target, setTarget] = useState<Record<string, string>>({});
  const [ok, setOk] = useState<string | null>(null);
  const open = (tasks.data ?? []).filter((t) => t.status !== "approved");
  const done = (tasks.data ?? []).filter((t) => t.status === "approved");

  return (
    <section>
      <h2 className="k-display mt-10 text-3xl">Do useful work</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Claim a task, do it, submit evidence. A house reviewer — never you — approves it, and only then do points and clout land. Rejected work comes back with a note and can be revised. Up to 5 open tasks at a time.
      </p>
      {board.isLoading ? (
        <Loading />
      ) : (
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {board.data?.map((t) => (
            <Card key={t.kind}>
              <h3 className="font-semibold">{t.title}</h3>
              <p className="my-3 text-sm text-muted-foreground">{t.detail}</p>
              <div className="mb-3 k-num text-xs">
                {t.points} points · {t.clout} clout
              </div>
              {signedIn && (
                <select
                  className="k-input mb-3 text-xs"
                  aria-label={`Project for ${t.title}`}
                  value={target[t.kind] ?? ""}
                  onChange={(e) => setTarget({ ...target, [t.kind]: e.target.value })}
                >
                  <option value="">No specific project</option>
                  {projects.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              )}
              <Btn
                disabled={!signedIn}
                loading={claim.isPending && claim.variables?.kind === t.kind}
                onClick={() => {
                  const projectId = target[t.kind] ? Number(target[t.kind]) : undefined;
                  log.decide("hub", "Task claim requested", { kind: t.kind, projectId });
                  claim.mutate(
                    { kind: t.kind as TaskKind, title: t.title, projectId },
                    { onSuccess: (r) => setOk(r.note) },
                  );
                }}
              >
                {signedIn ? "Claim task" : "Sign in to claim"}
              </Btn>
            </Card>
          ))}
        </div>
      )}
      <ErrorLine error={board.error ?? claim.error} />
      <OkLine>{ok}</OkLine>

      {signedIn && (
        <div className="mt-6">
          <div className="k-label">Your tasks</div>
          {tasks.isLoading ? (
            <Loading />
          ) : !tasks.data?.length ? (
            <div className="mt-3">
              <Empty>Nothing claimed yet.</Empty>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {open.map((t) => (
                <Card key={t.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <b>{t.title}</b>
                      {t.projectId && (
                        <Link to={`/forge/project/${t.projectId}`} className="k-link ml-2 text-xs">
                          project #{t.projectId}
                        </Link>
                      )}
                      <div className="text-xs text-muted-foreground">
                        claimed {ago(t.createdAt)}
                        {t.revisionCount > 0 && ` · revision ${t.revisionCount}`}
                        {t.submittedAt && ` · submitted ${ago(t.submittedAt)}`}
                      </div>
                    </div>
                    <Pill tone={TASK_TONE[t.status]}>{t.status === "submitted" ? "in review" : t.status}</Pill>
                  </div>
                  {t.status === "rejected" && t.reviewNote && (
                    <p className="mt-3 rounded-[var(--radius)] border border-destructive/40 p-2 text-xs">
                      <b>Reviewer:</b> {t.reviewNote}
                    </p>
                  )}
                  {t.status === "submitted" && <p className="mt-2 text-xs text-muted-foreground">Evidence: {t.proof}</p>}
                  {(t.status === "claimed" || t.status === "rejected") && (
                    <form
                      className="mt-3 flex flex-wrap gap-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        log.decide("hub", t.status === "rejected" ? "Task revision submitted" : "Task evidence submitted", { taskId: t.id });
                        submit.mutate(
                          { taskId: t.id, proof: (proof[t.id] ?? "").trim() },
                          { onSuccess: () => { setProof({ ...proof, [t.id]: "" }); setOk("Evidence sent for house review."); } },
                        );
                      }}
                    >
                      <input
                        className="k-input flex-1"
                        aria-label={`Evidence for ${t.title}`}
                        required
                        minLength={10}
                        maxLength={2000}
                        placeholder={t.status === "rejected" ? "Revised evidence — address the reviewer's note" : "Evidence link or explanation (10+ characters)"}
                        value={proof[t.id] ?? (t.status === "rejected" ? (t.proof ?? "") : "")}
                        onChange={(e) => setProof({ ...proof, [t.id]: e.target.value })}
                      />
                      <Btn loading={submit.isPending && submit.variables?.taskId === t.id}>{t.status === "rejected" ? "Resubmit" : "Submit evidence"}</Btn>
                    </form>
                  )}
                </Card>
              ))}
              {done.length > 0 && (
                <Card>
                  <div className="k-label">Approved</div>
                  <ul className="mt-2 divide-y divide-border text-sm">
                    {done.map((t) => (
                      <li key={t.id} className="flex justify-between py-2 k-num">
                        <span>{t.title}</span>
                        <span className="text-xs text-muted-foreground">
                          +{t.pointsAwarded} pts · +{t.cloutAwarded} clout · {date(t.reviewedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          )}
          <ErrorLine error={tasks.error ?? submit.error} />
        </div>
      )}
    </section>
  );
}

function Governance() {
  const { member, isAdmin } = useSession();
  const signedIn = !!member;
  const proposals = useProposals();
  const propose = usePropose();
  const vote = useVote();
  const finalize = useFinalizeProposal();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const weight = 1 + Math.floor(Math.sqrt(Math.max(0, member?.clout ?? 0)));

  return (
    <section>
      <h2 className="k-display mb-4 text-3xl">Member governance</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Weight is 1 + floor(√clout){signedIn ? ` — yours is ${weight}` : ""}. One vote per member per proposal. A proposal passes with at least 3 distinct voters and more weighted yes than no. Passing never moves money by itself; the House acts on it publicly.
      </p>
      {proposals.isLoading ? (
        <Loading />
      ) : !proposals.data?.length ? (
        <Empty>No proposals yet.</Empty>
      ) : (
        <div className="space-y-4">
          {proposals.data.map((p) => {
            const closesAt = p.closesAt ? new Date(p.closesAt).getTime() : 0;
            const live = p.status === "open" && closesAt > Date.now();
            const total = p.yesWeight + p.noWeight;
            return (
              <Card key={p.id}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">{p.title}</h3>
                  <Pill tone={PROPOSAL_TONE[p.status] ?? "muted"}>{p.status}</Pill>
                </div>
                <p className="my-3 whitespace-pre-wrap text-sm text-muted-foreground">{p.body}</p>
                <div className="k-bar mb-2">
                  <span style={{ width: `${total ? (p.yesWeight / total) * 100 : 0}%` }} />
                </div>
                <p className="mb-3 k-num text-xs">
                  Yes {p.yesWeight} · No {p.noWeight} · {p.voterCount}/{p.quorum} voters for quorum ·{" "}
                  {p.status === "open" ? `closes ${ago(p.closesAt)}` : `closed ${date(p.finalizedAt)}`}
                </p>
                {p.outcomeNote && <p className="mb-3 text-xs">{p.outcomeNote}</p>}
                {p.myVote ? (
                  <p className="text-xs text-primary">
                    You voted {p.myVote.choice} with weight {p.myVote.weight}.
                  </p>
                ) : live ? (
                  <div className="flex gap-2">
                    {(["yes", "no"] as const).map((choice) => (
                      <Btn
                        key={choice}
                        variant="outline"
                        disabled={!signedIn}
                        loading={vote.isPending && vote.variables?.proposalId === p.id && vote.variables?.choice === choice}
                        onClick={() => {
                          log.decide("governance", "Vote cast", { proposalId: p.id, choice });
                          vote.mutate({ proposalId: p.id, choice }, { onSuccess: (r) => setOk(`Vote counted with weight ${r.weight}.`) });
                        }}
                      >
                        {choice}
                      </Btn>
                    ))}
                  </div>
                ) : null}
                {isAdmin && p.status === "open" && (
                  <Btn
                    variant="ghost"
                    className="mt-2 text-xs"
                    loading={finalize.isPending && finalize.variables?.proposalId === p.id}
                    onClick={() => {
                      if (!window.confirm("Close this proposal now and record the outcome?")) return;
                      log.decide("governance", "Admin finalize requested", { proposalId: p.id });
                      finalize.mutate({ proposalId: p.id });
                    }}
                  >
                    Finalize now (admin)
                  </Btn>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <ErrorLine error={proposals.error ?? vote.error ?? finalize.error} />
      <OkLine>{ok}</OkLine>

      <Card className="mt-4">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            log.decide("governance", "Proposal submitted");
            propose.mutate({ title, body }, { onSuccess: () => { setTitle(""); setBody(""); setOk("Proposal published. Voting runs 14 days."); } });
          }}
        >
          <div className="k-label">Propose · Level 1+</div>
          <Field label="Title">
            <input className="k-input" required minLength={6} maxLength={140} aria-label="Proposal title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Proposal" help="40+ characters. What changes, who pays, how we'd know it worked.">
            <textarea className="k-input min-h-28" required minLength={40} maxLength={4000} aria-label="Proposal body" value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <Btn disabled={!signedIn || (member?.level ?? 0) < 1} loading={propose.isPending}>
            Publish proposal
          </Btn>
          {signedIn && (member?.level ?? 0) < 1 && <p className="text-xs text-muted-foreground">You're at Level 0. Two approved tasks get you to Associate.</p>}
          <ErrorLine error={propose.error} />
        </form>
      </Card>
    </section>
  );
}

function Features() {
  const { member } = useSession();
  const features = useFeatures();
  const featureVote = useVoteFeature();
  return (
    <section>
      <h2 className="k-display mb-4 text-3xl">Failure into features</h2>
      <p className="mb-4 text-sm text-muted-foreground">Foreclosed value funds member features, not house bonuses. One vote per member per feature; the House allocates the fund in public.</p>
      <Stat label="Feature fund (sim)" value={money(features.data?.fundCents)} sub="unallocated balance" />
      {features.isLoading ? (
        <Loading />
      ) : (
        <div className="mt-4 space-y-4">
          {features.data?.features.map((f) => (
            <Card key={f.id}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold">{f.title}</h3>
                <Pill tone={f.status === "shipped" ? "good" : f.status === "building" ? "warn" : "muted"}>{f.status}</Pill>
              </div>
              <p className="my-3 text-sm text-muted-foreground">{f.description}</p>
              <div className="k-bar mb-2">
                <span style={{ width: `${Math.min(100, (f.fundedCents / Math.max(1, f.targetCents)) * 100)}%` }} />
              </div>
              <p className="mb-3 text-xs k-num">
                {f.votes} votes · {money(f.fundedCents)} of {money(f.targetCents)} funded
              </p>
              {f.votedByMe ? (
                <p className="text-xs text-primary">You voted for this.</p>
              ) : (
                <Btn
                  disabled={!member || f.status === "shipped"}
                  loading={featureVote.isPending && featureVote.variables?.featureId === f.id}
                  onClick={() => {
                    log.decide("features", "Feature vote cast", { featureId: f.id });
                    featureVote.mutate({ featureId: f.id });
                  }}
                >
                  Vote for this
                </Btn>
              )}
            </Card>
          ))}
        </div>
      )}
      <ErrorLine error={features.error ?? featureVote.error} />
    </section>
  );
}
