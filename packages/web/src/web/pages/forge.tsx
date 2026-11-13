import { useState } from "react";
import { Link } from "wouter";
import { Shuffle, Check, X, Lock } from "lucide-react";
import { useDecide, useDrawNext, useDrawState } from "../queries/draw";
import { useLevelUp, useUnlockOngoing } from "../queries/members";
import { useSession } from "../components/session";
import { Bar, Btn, Card, ErrorLine, Loading, NeedPassport, OkLine, PageHead, Stat, newKey } from "../components/bits";
import { log } from "../lib/log";
import { BRAND_LABEL, money, num, pct } from "../lib/format";

export default function ForgePage() {
  return (
    <NeedPassport>
      <Draw />
    </NeedPassport>
  );
}

function Draw() {
  const { member } = useSession();
  const state = useDrawState(!!member);
  const next = useDrawNext();
  const decide = useDecide();
  const levelUp = useLevelUp();
  const unlock = useUnlockOngoing();
  const [amount, setAmount] = useState(10);
  const [note, setNote] = useState("");
  const [last, setLast] = useState<string | null>(null);
  const [levelMsg, setLevelMsg] = useState<string | null>(null);

  if (state.isError) return <ErrorLine error={state.error} />;
  if (state.isLoading || !state.data) return <Loading label="Shuffling" />;
  const s = state.data;
  const p = s.project;

  function answer(decision: "yes" | "bye") {
    if (!s.pending) return;
    if (decision === "bye" && !window.confirm("Bye is permanent — this round will never be shown to you again. Continue?")) return;
    log.decide("draw", "Decision submitted", { drawId: s.pending.id, decision, amountCents: decision === "yes" ? amount * 100 : 0 });
    decide.mutate(
      { drawId: s.pending.id, decision, amountCents: decision === "yes" ? amount * 100 : undefined, note: note || undefined, idempotencyKey: newKey() },
      {
        onSuccess: (r) => {
          setNote("");
          setLast(
            r.decision === "yes"
              ? `Backed. ${money(r.escrowedCents)} escrowed, ${money(r.houseFeeCents)} house fee, +${r.pointsAwarded} points, ${pct(r.equityBp)} equity.`
              : r.message,
          );
        },
      },
    );
  }

  return (
    <div>
      <PageHead kicker="Forge Club · The Draw" title="One card. Yes or bye.">
        {s.rule}
      </PageHead>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="This week" value={`${s.week.used}/${s.week.allowance}`} sub={`${s.week.remaining} draws left · resets Monday UTC`} />
        <Stat label="Level" value={`L${s.level.level}`} sub={s.level.name} />
        <Stat label="Lifetime" value={num(s.lifetime.drawn)} sub={`${s.lifetime.backed} backed · ${s.lifetime.passed} bye`} />
        <Stat label="Points" value={num(member?.points)} sub={member?.ongoingAccess ? "Ongoing rounds unlocked" : "Stage-1 rounds only"} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div>
          {p && s.pending ? (
            <Card className="k-deal p-6 md:p-8">
              <div className="flex flex-wrap items-center gap-2">
                <span className="k-chip">{BRAND_LABEL[p.brand]}</span>
                <span className="k-chip">Stage {p.stage}</span>
                <span className="k-chip">{p.riskTier} risk</span>
                <span className="k-chip">{p.pitchFormat}</span>
              </div>
              <h2 className="k-display mt-5 text-4xl md:text-5xl">{p.title}</h2>
              <p className="mt-2 text-lg">{p.tagline}</p>
              <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground">{p.description}</p>
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <div><div className="k-label">Goal</div><div className="k-num font-semibold">{money(p.capitalGoalCents)}</div></div>
                <div><div className="k-label">Equity offered</div><div className="k-num font-semibold">{pct(p.equityOfferedBp)}</div></div>
                <div><div className="k-label">Points per $10</div><div className="k-num font-semibold">{s.pointValue}</div></div>
              </div>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>{money(p.raisedCents)} escrowed · {p.backerCount} backers</span>
                  <span>by @{p.creatorHandle}</span>
                </div>
                <Bar value={p.raisedCents / p.capitalGoalCents} />
              </div>

              <div className="mt-6 grid gap-3 border-t border-border pt-6">
                <div className="flex items-center gap-3">
                  <span className="k-label w-24">Ticket</span>
                  <input type="range" min={1} max={10} aria-label="Ticket amount" value={amount} onChange={(e) => setAmount(Number(e.target.value))} className="flex-1 accent-[var(--accent)]" />
                  <span className="k-display k-num w-16 text-right text-2xl">${amount}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  ${amount}.00 in: ${(amount * 0.9).toFixed(2)} to escrow with {p.escrowVendor ?? "the escrow agent"}, ${(amount * 0.1).toFixed(2)} house fee (a quarter of which goes to the Reserve). $10 is the ceiling per project, forever.
                </p>
                <textarea className="k-input" rows={2} placeholder="Optional note for the room — why yes, or why bye" aria-label="Optional decision note" value={note} onChange={(e) => setNote(e.target.value)} />
                <div className="grid grid-cols-2 gap-3">
                  <Btn onClick={() => answer("yes")} loading={decide.isPending && decide.variables?.decision === "yes"} disabled={decide.isPending}>
                    <Check className="size-4" /> Yes — back ${amount}
                  </Btn>
                  <Btn variant="outline" onClick={() => answer("bye")} loading={decide.isPending && decide.variables?.decision === "bye"} disabled={decide.isPending}>
                    <X className="size-4" /> Bye, for good
                  </Btn>
                </div>
                <ErrorLine error={decide.error} />
              </div>
            </Card>
          ) : (
            <Card className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center">
              <Shuffle className="size-10 text-primary" />
              <div className="k-display mt-4 text-4xl">{s.week.remaining > 0 ? "Deck is ready" : "Out of draws this week"}</div>
              {last && <p className="mt-3 max-w-md text-sm">{last}</p>}
              <p className="mt-3 max-w-md text-sm text-muted-foreground">
                {s.week.remaining > 0
                  ? "Draw a random round you have never seen. You will have to answer it before another unlocks."
                  : "Level up for more draws, or earn points on the Hub task board."}
              </p>
              {s.week.remaining > 0 && (
                <Btn className="mt-6 px-8 py-3" loading={next.isPending} onClick={() => { log.decide("draw", "Next card requested", { remaining: s.week.remaining }); next.mutate(undefined, { onSuccess: () => setLast(null) }); }}>
                  Draw a card
                </Btn>
              )}
              <ErrorLine error={next.error} />
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <div className="k-label">Level up</div>
            {s.nextLevel ? (
              <>
                <div className="k-display mt-2 text-2xl">L{s.nextLevel.level} {s.nextLevel.name}</div>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {s.nextLevel.perks.map((x) => <li key={x}>— {x}</li>)}
                </ul>
                <div className="mt-3"><Bar value={(member?.points ?? 0) / s.nextLevel.pointCost} /></div>
                <div className="mt-1 text-xs text-muted-foreground k-num">{num(member?.points)} / {num(s.nextLevel.pointCost)} points</div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Btn variant="outline" className="text-xs" loading={levelUp.isPending && levelUp.variables?.method === "points"} disabled={(member?.points ?? 0) < s.nextLevel.pointCost} onClick={() => levelUp.mutate({ method: "points", idempotencyKey: newKey() }, { onSuccess: (r) => setLevelMsg(`Now L${r.level} ${r.name}.`) })}>
                    Use {num(s.nextLevel.pointCost)} pts
                  </Btn>
                  <Btn className="text-xs" loading={levelUp.isPending && levelUp.variables?.method === "fee"} disabled={(member?.walletCents ?? 0) < s.nextLevel.feeCents} onClick={() => { if (window.confirm(`Pay ${money(s.nextLevel!.feeCents)} in club credit to reach L${s.nextLevel!.level}?`)) levelUp.mutate({ method: "fee", idempotencyKey: newKey() }, { onSuccess: (r) => setLevelMsg(`Now L${r.level} ${r.name}.`) }); }}>
                    Pay {money(s.nextLevel.feeCents)}
                  </Btn>
                </div>
                <ErrorLine error={levelUp.error} />
                <OkLine>{levelMsg}</OkLine>
              </>
            ) : (
              <p className="mt-2 text-sm">Top level. Nothing left to unlock.</p>
            )}
          </Card>
          {!member?.ongoingAccess && (
            <Card>
              <div className="flex items-center gap-2"><Lock className="size-4 text-primary" /><span className="k-label">Ongoing rounds</span></div>
              <p className="mt-2 text-sm text-muted-foreground">
                At L0–L1 you only see brand-new rounds. Rounds past stage 1 earn more points per ticket. Unlock them for $5, or reach Operator.
              </p>
              <Btn variant="outline" className="mt-3 w-full text-xs" loading={unlock.isPending} disabled={(member?.walletCents ?? 0) < 500} onClick={() => unlock.mutate({ idempotencyKey: newKey() })}>Unlock for $5.00</Btn>
              <ErrorLine error={unlock.error} />
            </Card>
          )}
          <Card>
            <div className="k-label">Elsewhere</div>
            <div className="mt-3 grid gap-2 text-sm">
              <Link to="/portfolio" className="k-link">Your portfolio and income</Link>
              <Link to="/projects" className="k-link">Browse every round</Link>
              <Link to="/hub" className="k-link">Earn points on the task board</Link>
              <Link to="/forge/pitch" className="k-link">Pitch your own</Link>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
