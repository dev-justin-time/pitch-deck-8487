import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useFeeQuote, usePitch } from "../queries/projects";
import { useSession } from "../components/session";
import { Btn, Card, ErrorLine, Field, NeedPassport, PageHead, newKey } from "../components/bits";
import { log } from "../lib/log";
import { money } from "../lib/format";

const CATEGORIES = ["software", "consumer", "apparel", "worn_apparel", "media", "service", "deep_tech", "space", "other"];

export default function PitchPage() {
  return (
    <NeedPassport>
      <PitchForm />
    </NeedPassport>
  );
}

function PitchForm() {
  const { member } = useSession();
  const [, go] = useLocation();
  const pitch = usePitch();
  // One key per pitch attempt: a retry after a network blip replays the first charge instead of billing twice.
  const attemptKey = useRef(newKey());
  const [f, setF] = useState({
    title: "", tagline: "", description: "", brand: "forge" as "forge" | "orbital" | "sole", category: "other",
    riskTier: "low" as "low" | "medium" | "high", goal: 10000, pitchFormat: "writeup" as "video" | "deck" | "drawing" | "prototype" | "writeup",
    pitchUrl: "", equityPct: 10, accept: false,
  });
  const quote = useFeeQuote(f.goal * 100, f.riskTier);
  const short = !!quote.data && (member?.walletCents ?? 0) < quote.data.totalCents;
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF({ ...f, [k]: v });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!member || !f.accept) return;
    log.decide("pitch", "Pitch submitted", { brand: f.brand, riskTier: f.riskTier, goalCents: f.goal * 100, feeCents: quote.data?.totalCents });
    pitch.mutate(
      {
        idempotencyKey: attemptKey.current, title: f.title, tagline: f.tagline, description: f.description, brand: f.brand, category: f.category,
        riskTier: f.riskTier, capitalGoalCents: f.goal * 100, pitchFormat: f.pitchFormat, pitchUrl: f.pitchUrl || undefined,
        equityOfferedBp: Math.round(f.equityPct * 100), acceptTerms: true,
      },
      { onSuccess: (p) => { attemptKey.current = newKey(); go(`/forge/project/${p.id}`); } },
    );
  }

  return (
    <div>
      <PageHead kicker="Forge Club · Pitch" title="Pitch anything legal">
        Video, deck, drawing, prototype or a plain write-up. You pay a listing fee scaled by risk and goal, plus $200 to the independent escrow professional. Backers pay you in cash; you pay them in equity.
      </PageHead>
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card className="grid gap-4">
          <Field label="Title"><input className="k-input" required minLength={3} maxLength={80} aria-label="Title" value={f.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label="One-line tagline"><input className="k-input" required minLength={8} maxLength={140} aria-label="One-line tagline" value={f.tagline} onChange={(e) => set("tagline", e.target.value)} /></Field>
          <Field label="The pitch" help="What it is, why now, what would kill it. 40+ characters. Overclaiming gets rejected by the room and costs trust.">
            <textarea className="k-input" rows={8} required minLength={40} maxLength={4000} aria-label="The pitch" value={f.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Club">
              <select className="k-input" value={f.brand} onChange={(e) => set("brand", e.target.value as typeof f.brand)}>
                <option value="forge">Forge Club</option><option value="orbital">Orbital Works</option><option value="sole">Sole Society</option>
              </select>
            </Field>
            <Field label="Category">
              <select className="k-input" value={f.category} onChange={(e) => set("category", e.target.value)}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace("_", " ")}</option>)}
              </select>
            </Field>
            <Field label="Format">
              <select className="k-input" value={f.pitchFormat} onChange={(e) => set("pitchFormat", e.target.value as typeof f.pitchFormat)}>
                {["writeup", "video", "deck", "drawing", "prototype"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Link to pitch material (optional)" help="Video, deck or drawing hosted anywhere public.">
            <input className="k-input" type="url" aria-label="Pitch material URL" value={f.pitchUrl} onChange={(e) => set("pitchUrl", e.target.value)} placeholder="https://" />
          </Field>
        </Card>

        <div className="space-y-4">
          <Card className="grid gap-4">
            <Field label="Risk tier">
              <div className="grid grid-cols-3 gap-2">
                {(["low", "medium", "high"] as const).map((r) => (
                  <button type="button" key={r} onClick={() => set("riskTier", r)} className={`k-chip justify-center py-2 ${f.riskTier === r ? "border-primary text-primary" : ""}`}>{r}</button>
                ))}
              </div>
            </Field>
            <Field label={`Capital goal — ${money(f.goal * 100)}`}>
              <input type="range" min={100} max={500000} step={100} aria-label="Capital goal" value={f.goal} onChange={(e) => set("goal", Number(e.target.value))} className="w-full accent-[var(--accent)]" />
            </Field>
            <Field label={`Equity offered to the crowd — ${f.equityPct}%`} help="1% to 50%. Each ticket buys a pro-rata slice of this.">
              <input type="range" min={1} max={50} aria-label="Equity offered" value={f.equityPct} onChange={(e) => set("equityPct", Number(e.target.value))} className="w-full accent-[var(--accent)]" />
            </Field>
          </Card>
          <Card>
            <div className="k-label">What you pay today</div>
            <div className="mt-3 space-y-1.5 text-sm k-num">
              <div className="flex justify-between"><span>Listing fee</span><span>{money(quote.data?.pitchFeeCents)}</span></div>
              <div className="flex justify-between"><span>Escrow retainer (to agent)</span><span>{money(quote.data?.escrowFeeCents)}</span></div>
              <div className="flex justify-between border-t border-border pt-1.5 font-semibold"><span>Total (simulated)</span><span>{money(quote.data?.totalCents)}</span></div>
              <div className="flex justify-between text-muted-foreground"><span>Your wallet</span><span>{money(member?.walletCents)}</span></div>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{quote.data?.explanation}</p>
            <label className="mt-4 flex gap-2 text-xs">
              <input type="checkbox" aria-label="Accept legal and milestone terms" checked={f.accept} onChange={(e) => set("accept", e.target.checked)} />
              <span>The venture is legal where I operate, my claims are true to my knowledge, and I accept the milestone, grace, default and 25% cancellation terms.</span>
            </label>
            {short && <p className="mt-3 text-xs text-destructive">Your club credit doesn't cover this fee. Lower the goal or risk tier, or ask the house desk for a credit grant.</p>}
            <Btn type="submit" className="mt-4 w-full" disabled={!f.accept || short} loading={pitch.isPending}>Pay and go live</Btn>
            <ErrorLine error={pitch.error} />
          </Card>
        </div>
      </form>
    </div>
  );
}
