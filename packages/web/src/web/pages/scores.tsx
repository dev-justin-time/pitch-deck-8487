import { useState } from "react";
import { Link } from "wouter";
import { Btn, Card, ErrorLine, Loading, NeedPassport, PageHead, Stat } from "../components/bits";
import { useSession } from "../components/session";
import { useScores } from "../queries/members";
import { log } from "../lib/log";

export default function ScoresPage() { return <NeedPassport><Scores /></NeedPassport>; }
function Scores() {
  const { member } = useSession();
  const [handle, setHandle] = useState("");
  const [target, setTarget] = useState<string>();
  // Mirrors the server rule: only administrator-approved accreditation unlocks lookups. No level or admin bypass.
  const allowed = member?.kycStatus === "accredited";
  const scores = useScores(!!member, target);
  return <div><PageHead kicker="Kinship Hub · Private standing" title="Your file">A record of participation, not a credit rating or a prediction of investment success. No public leaderboard of private scores.</PageHead>
    <Card className="mb-6"><form className="flex flex-wrap gap-3" onSubmit={(e) => { e.preventDefault(); if (allowed) { log.decide("scores", "Lookup requested"); setTarget(handle.replace(/^@/, "").trim().toLowerCase() || undefined); } else log.warn("scores", "Lookup blocked: accreditation required"); }}><input className="k-input flex-1" aria-label="Member handle" placeholder="Your own file, or a handle" value={handle} onChange={(e) => setHandle(e.target.value)} disabled={!allowed} /><Btn disabled={!allowed}>Look up</Btn><Btn type="button" variant="outline" onClick={() => { setTarget(undefined); setHandle(""); }}>My file</Btn></form>{!allowed && <p className="mt-3 text-sm text-muted-foreground">Looking up another member needs administrator-approved simulated accreditation — paid levels and admin roles do not bypass it, and the member is notified of every lookup. Your own file is always available. <Link className="k-link" to="/portfolio">Request accreditation review</Link></p>}</Card>
    {scores.isLoading ? <Loading /> : scores.data && <><h2 className="k-display mb-4 text-3xl">@{scores.data.handle}</h2><div className="grid gap-4 md:grid-cols-2"><Stat label="Trust" value={`${scores.data.trust.score} / 1000`} sub={scores.data.trust.band.label} /><Stat label="Social" value={`${scores.data.social.score} / 1000`} sub={scores.data.social.band.label} /></div><div className="mt-6 grid gap-6 md:grid-cols-2">{[scores.data.trust, scores.data.social].map((s, i) => <Card key={i}><div className="k-label">{i === 0 ? "Trust factors" : "Social factors"}</div>{s.factors.map((f) => <div key={f.label} className="mt-4 border-t border-border pt-3"><div className="flex justify-between gap-4"><b className="text-sm">{f.label}</b><span className="k-num text-sm">{f.points} / {f.max}</span></div><p className="mt-1 text-xs text-muted-foreground">{f.detail}</p></div>)}</Card>)}</div><p className="mt-6 text-sm text-muted-foreground">{scores.data.visibility}</p></>}
    <ErrorLine error={scores.error} />
  </div>;
}