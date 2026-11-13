import { Link } from "wouter";
import { usePortfolio } from "../queries/payouts";
import { useMyNotices } from "../queries/house";
import { useWalletHistory } from "../queries/members";
import { useMyIdentity, useRequestIdentity } from "../queries/identity";
import { useDismissNotice } from "../queries/house";
import { useState } from "react";
import { useSession } from "../components/session";
import { Btn, Card, Empty, ErrorLine, Field, Loading, NeedPassport, OkLine, PageHead, Pill, Stat } from "../components/bits";
import { log } from "../lib/log";
import { BRAND_LABEL, STATUS_LABEL, date, money, pct } from "../lib/format";

export default function PortfolioPage() {
  return <NeedPassport><Portfolio /></NeedPassport>;
}

function Portfolio() {
  const { member } = useSession();
  const signedIn = !!member;
  const pf = usePortfolio(signedIn);
  const notices = useMyNotices(signedIn);
  const history = useWalletHistory(signedIn);
  const dismiss = useDismissNotice();
  if (pf.isLoading) return <Loading />;
  if (pf.isError) return <ErrorLine error={pf.error} />;
  const t = pf.data?.totals;

  return (
    <div>
      <PageHead kicker={`@${member?.handle} · Portfolio`} title="What you own">
        {pf.data && "disclaimer" in pf.data ? pf.data.disclaimer : "Cost, ownership and income received, per round."}
      </PageHead>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Wallet (sim)" value={money(member?.walletCents)} sub={`${member?.points ?? 0} points · ${member?.clout ?? 0} clout`} />
        <Stat label="Cost basis" value={money(t?.costCents)} />
        <Stat label="Income received" value={money(t?.incomeCents)} sub="from published income runs" />
        <Stat label="Estimated mark" value={money(t?.markCents)} sub={`not an offer · ${money(t?.heldCents)} of your tickets still in escrow`} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <div className="k-label">Positions</div>
          {!pf.data?.positions.length ? (
            <div className="mt-4"><Empty>No positions yet. <Link to="/forge" className="k-link">Draw your first card.</Link></Empty></div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm k-num">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="py-2">Round</th><th>Status</th><th>Own</th><th>Cost</th><th>Income</th><th>Mark</th></tr>
                </thead>
                <tbody>
                  {pf.data.positions.map((p) => (
                    <tr key={p.projectId} className="border-t border-border">
                      <td className="py-2.5"><Link to={`/forge/project/${p.projectId}`} className="k-link">{p.title}</Link><div className="text-xs text-muted-foreground">{BRAND_LABEL[p.brand]} · stage {p.stage}</div></td>
                      <td>{STATUS_LABEL[p.status] ?? p.status}</td>
                      <td>{pct(p.equityBp, 3)}</td>
                      <td>{money(p.costCents)}</td>
                      <td className="text-good">{money(p.incomeCents)}</td>
                      <td title={p.markMethod}>{money(p.markCents)}<div className="text-[10px] text-muted-foreground">{p.markMethod}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <IdentityCard />
          <Card>
            <div className="k-label">Notices</div>
            {notices.isLoading ? <Loading /> : !notices.data?.length ? <p className="mt-2 text-sm text-muted-foreground">Nothing open.</p> : (
              <ul className="mt-3 space-y-3">
                {notices.data.map((n) => (
                  <li key={n.id} className="border-t border-border pt-3 text-sm">
                    <div className="flex items-center gap-2"><span className="k-chip">{n.kind.split("_").join(" ")}</span><span className="text-xs text-muted-foreground">{date(n.createdAt)}</span></div>
                    <div className="mt-1 font-semibold">{n.title}</div>
                    <p className="text-xs text-muted-foreground">{n.body}</p>
                    {n.recoveryPath && <p className="mt-1 text-xs"><b>Recovery path:</b> {n.recoveryPath}</p>}
                    {!LOCKED_NOTICES.includes(n.kind) && (
                      <Btn variant="ghost" className="mt-1 px-2 py-1 text-xs" loading={dismiss.isPending && dismiss.variables?.noticeId === n.id} onClick={() => { log.decide("portfolio", "Notice dismissed", { noticeId: n.id, kind: n.kind }); dismiss.mutate({ noticeId: n.id }); }}>
                        Dismiss
                      </Btn>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <ErrorLine error={dismiss.error} />
        </div>
      </div>

      <Card className="mt-6">
        <div className="flex items-center justify-between">
          <div className="k-label">Wallet history</div>
          <span className="text-xs text-muted-foreground">last 60 movements · simulated credit, not withdrawable</span>
        </div>
        {history.isLoading ? (
          <Loading />
        ) : !history.data?.length ? (
          <p className="mt-3 text-sm text-muted-foreground">No movements recorded yet. Credit comes from onboarding, the house desk, sales and income runs.</p>
        ) : (
          <div className="mt-3 max-h-96 overflow-auto">
            <table className="w-full text-sm k-num">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-1">When</th><th>What</th><th className="text-right">Change</th><th className="text-right">Balance</th></tr>
              </thead>
              <tbody>
                {history.data.map((w) => (
                  <tr key={w.id} className="border-t border-border">
                    <td className="py-2 text-xs text-muted-foreground">{date(w.createdAt)}</td>
                    <td>
                      {w.reason}
                      {w.projectId && <Link to={`/forge/project/${w.projectId}`} className="k-link ml-2 text-xs">#{w.projectId}</Link>}
                    </td>
                    <td className={`text-right ${w.deltaCents >= 0 ? "text-good" : "text-destructive"}`}>{w.deltaCents >= 0 ? "+" : ""}{money(w.deltaCents)}</td>
                    <td className="text-right">{money(w.balanceAfterCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const LOCKED_NOTICES = ["default_notice", "foreclosure", "grace"];

function IdentityCard() {
  const { member } = useSession();
  const mine = useMyIdentity(!!member);
  const request = useRequestIdentity();
  const [tier, setTier] = useState<"verified" | "accredited">("verified");
  const [statement, setStatement] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const status = mine.data?.kycStatus ?? member?.kycStatus ?? "none";
  const pending = mine.data?.requests.find((r) => r.status === "pending");
  const topTier = status === "accredited";

  return (
    <Card>
      <div className="k-label">Identity tier</div>
      <div className="mt-2 flex items-center gap-2">
        <span className="k-display text-2xl capitalize">{status}</span>
        <Pill tone={status === "accredited" ? "good" : status === "verified" ? "good" : "muted"}>simulated</Pill>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        You file a request; only an administrator can change your tier. No document is checked in this build — in production a KYC vendor would write this. Orbital Works backing and other-member score lookups need the accredited tier.
      </p>
      {pending ? (
        <p className="mt-3 rounded-[var(--radius)] border border-border p-3 text-xs">
          <b className="capitalize">{pending.tier}</b> review pending since {date(pending.createdAt)}.
        </p>
      ) : !topTier ? (
        <form
          className="mt-3 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            log.decide("identity", "Tier review requested", { tier });
            request.mutate(
              { tier, statement: statement.trim() },
              { onSuccess: () => { setStatement(""); setOk("Request filed. The house desk will review it."); } },
            );
          }}
        >
          <Field label="Tier">
            <select className="k-input" value={tier} onChange={(e) => setTier(e.target.value as typeof tier)} aria-label="Requested tier">
              {status !== "verified" && <option value="verified">Verified</option>}
              <option value="accredited">Accredited</option>
            </select>
          </Field>
          <Field label="Statement" help="20–800 characters. Who you are and why you need the tier. Do not paste ID numbers or documents.">
            <textarea className="k-input" rows={3} minLength={20} maxLength={800} required value={statement} onChange={(e) => setStatement(e.target.value)} aria-label="Statement for reviewer" />
          </Field>
          <Btn type="submit" variant="outline" className="text-xs" loading={request.isPending} disabled={statement.trim().length < 20}>
            Request review
          </Btn>
          <ErrorLine error={request.error} />
          <OkLine>{ok}</OkLine>
        </form>
      ) : (
        <p className="mt-3 text-xs">Highest tier held.</p>
      )}
      {!!mine.data?.requests.length && (
        <ul className="mt-4 space-y-2 border-t border-border pt-3 text-xs">
          {mine.data.requests.map((r) => (
            <li key={r.id}>
              <div className="flex items-center gap-2">
                <span className="capitalize">{r.tier}</span>
                <Pill tone={r.status === "approved" ? "good" : r.status === "rejected" ? "bad" : "warn"}>{r.status}</Pill>
                <span className="text-muted-foreground">{date(r.createdAt)}</span>
              </div>
              {r.reviewNote && <p className="mt-1 text-muted-foreground">Reviewer: {r.reviewNote}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
