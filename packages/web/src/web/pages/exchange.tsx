import { useState } from "react";
import { Link } from "wouter";
import {
  useBuyEquity,
  useBuyPoints,
  useCancelEquityListing,
  useCancelListing,
  useEquityBook,
  useMyListings,
  usePointBook,
  usePointRate,
  useSellPoints,
} from "../queries/exchange";
import { useSession } from "../components/session";
import { Btn, Card, Empty, ErrorLine, Loading, OkLine, PageHead, Pill, Stat, newKey } from "../components/bits";
import { BRAND_LABEL, ago, money, num, pct } from "../lib/format";
import { log } from "../lib/log";

const HOUSE_FEE = 0.1;

export default function ExchangePage() {
  const { member } = useSession();
  const signedIn = !!member;
  const rate = usePointRate();
  const book = usePointBook();
  const eq = useEquityBook();
  const mine = useMyListings(signedIn);
  const sell = useSellPoints();
  const buy = useBuyPoints();
  const cancel = useCancelListing();
  const cancelEq = useCancelEquityListing();
  const buyEq = useBuyEquity();
  const [pts, setPts] = useState("");
  const [price, setPrice] = useState("");
  const [ok, setOk] = useState<string | null>(null);

  const ptsN = Math.floor(Number(pts) || 0);
  const priceN = Math.floor(Number(price) || 0);
  const gross = ptsN * priceN;
  const tooMany = signedIn && ptsN > (member?.points ?? 0);
  const canEquity = (member?.level ?? 0) >= 2;

  function buyPoints(listingId: number, cost: number) {
    log.decide("exchange", "Buy points requested", { listingId, cost });
    buy.mutate(
      { listingId, idempotencyKey: newKey() },
      { onSuccess: (r) => setOk(`Bought ${num(r.pointsBought)} points for ${money(r.paidCents)} (house fee ${money(r.houseFeeCents)} paid by the seller).`) },
    );
  }
  function buyLot(listingId: number, ask: number) {
    log.decide("exchange", "Buy equity lot requested", { listingId, ask });
    buyEq.mutate(
      { listingId, idempotencyKey: newKey() },
      { onSuccess: (r) => setOk(`Bought ${pct(r.equityBp, 3)} for ${money(r.paidCents)}. Proceeds went to the ${r.proceedsTo === "feature_fund" ? "feature fund" : "seller"}.`) },
    );
  }

  return (
    <div>
      <PageHead kicker="Forge Club · Exchange" title="Points and equity, priced by people">
        {rate.data?.method}
      </PageHead>
      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Rate (VWAP)" value={rate.isLoading ? "…" : `${rate.data?.vwapCentsPerPoint}¢`} sub="per point" />
        <Stat label="Best ask" value={rate.data?.bestAskCentsPerPoint ? `${rate.data.bestAskCentsPerPoint}¢` : "—"} />
        <Stat label="Open depth" value={num(rate.data?.openDepthPoints)} sub="points for sale" />
        <Stat label="Floor" value={`${rate.data?.floorCentsPerPoint ?? 2}¢`} sub="minimum ask" />
      </div>
      <OkLine>{ok}</OkLine>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="k-label">Points book</div>
          {book.isLoading ? (
            <Loading />
          ) : !book.data?.length ? (
            <p className="mt-3 text-sm text-muted-foreground">No asks.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {book.data.map((l) => {
                const cost = l.points * l.priceCentsPerPoint;
                const own = l.sellerId === member?.id;
                return (
                  <li key={l.id} className="flex items-center justify-between py-2.5 text-sm k-num">
                    <span>
                      {num(l.points)} pts @ {l.priceCentsPerPoint}¢{" "}
                      <span className="text-xs text-muted-foreground">
                        = {money(cost)} · @{l.sellerHandle}
                      </span>
                    </span>
                    {signedIn && !own && (
                      <Btn
                        variant="outline"
                        className="py-1 text-xs"
                        disabled={(member?.walletCents ?? 0) < cost}
                        title={(member?.walletCents ?? 0) < cost ? "Not enough club credit" : undefined}
                        loading={buy.isPending && buy.variables?.listingId === l.id}
                        onClick={() => buyPoints(l.id, cost)}
                      >
                        Buy
                      </Btn>
                    )}
                    {own && <Pill>yours</Pill>}
                  </li>
                );
              })}
            </ul>
          )}
          <ErrorLine error={buy.error} />

          {rate.data?.lastTrades.length ? (
            <div className="mt-4 border-t border-border pt-3">
              <div className="k-label">Last prints</div>
              <ul className="mt-2 grid grid-cols-2 gap-1 text-xs text-muted-foreground k-num">
                {rate.data.lastTrades.map((t) => (
                  <li key={t.id}>
                    {num(t.points)} @ {t.priceCentsPerPoint}¢ · {ago(t.filledAt)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {signedIn ? (
            <form
              className="mt-5 grid gap-2 border-t border-border pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                log.decide("exchange", "Points ask submitted", { points: ptsN, priceCentsPerPoint: priceN });
                sell.mutate(
                  { points: ptsN, priceCentsPerPoint: priceN, idempotencyKey: newKey() },
                  {
                    onSuccess: () => {
                      setOk(`Listed ${num(ptsN)} points at ${priceN}¢. They're held off your balance until filled or cancelled.`);
                      setPts("");
                      setPrice("");
                    },
                  },
                );
              }}
            >
              <div className="k-label">Sell points — you hold {num(member?.points)}</div>
              <div className="grid grid-cols-2 gap-2">
                <input className="k-input" type="number" min={10} max={50000} placeholder="Points" aria-label="Points to sell" value={pts} onChange={(e) => setPts(e.target.value)} required />
                <input className="k-input" type="number" min={2} max={500} placeholder="¢ per point" aria-label="Price per point in cents" value={price} onChange={(e) => setPrice(e.target.value)} required />
              </div>
              {gross > 0 && (
                <p className="text-xs text-muted-foreground k-num">
                  If filled: {money(gross)} gross − {money(Math.round(gross * HOUSE_FEE))} house fee = {money(gross - Math.round(gross * HOUSE_FEE))} to you.
                </p>
              )}
              {tooMany && <p className="text-xs text-destructive">You only hold {num(member?.points)} points.</p>}
              <Btn type="submit" className="text-xs" loading={sell.isPending} disabled={tooMany}>
                List
              </Btn>
              <p className="text-xs text-muted-foreground">Settles in club credit only. Cash-out waits on a money-transmitter analysis — see the compliance roadmap.</p>
              <ErrorLine error={sell.error} />
            </form>
          ) : (
            <p className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">
              <Link to="/join" className="k-link">Sign in</Link> to buy or list points.
            </p>
          )}
        </Card>

        <Card>
          <div className="k-label">Equity Book — secondary stakes and foreclosure lots</div>
          {eq.isLoading ? (
            <Loading />
          ) : !eq.data?.length ? (
            <div className="mt-3">
              <Empty>No lots open. Sell from any project room where you hold a stake.</Empty>
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {eq.data.map((l) => {
                const own = l.sellerId === member?.id;
                return (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                    <div>
                      <Link to={`/forge/project/${l.projectId}`} className="k-link">
                        {l.projectTitle}
                      </Link>
                      <div className="text-xs text-muted-foreground k-num">
                        {pct(l.equityBp, 3)} for {money(l.askCents)} · {BRAND_LABEL[l.projectBrand]} · stage {l.projectStage} · @{l.sellerHandle}
                        {l.isForeclosureLot && " · foreclosure lot"}
                      </div>
                    </div>
                    {signedIn && !own && (
                      <Btn
                        variant="outline"
                        className="py-1 text-xs"
                        disabled={!canEquity || (member?.walletCents ?? 0) < l.askCents}
                        title={!canEquity ? "Opens at Operator (L2)" : undefined}
                        loading={buyEq.isPending && buyEq.variables?.listingId === l.id}
                        onClick={() => buyLot(l.id, l.askCents)}
                      >
                        Buy
                      </Btn>
                    )}
                    {own && <Pill>yours</Pill>}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Equity Book opens at Operator (L2){signedIn && !canEquity ? " — you're below it" : ""}. 10% house fee on every fill. Orbital lots need administrator-approved accreditation.
          </p>
          <ErrorLine error={buyEq.error} />
        </Card>
      </div>

      {signedIn && (mine.data?.points.length || mine.data?.equity.length) ? (
        <Card className="mt-6">
          <div className="k-label">Your listings</div>
          <ul className="mt-3 divide-y divide-border text-sm">
            {mine.data.points.map((l) => (
              <li key={`p${l.id}`} className="flex items-center justify-between py-2">
                <span className="k-num">
                  {num(l.points)} pts @ {l.priceCentsPerPoint}¢ · <Pill tone={l.status === "open" ? "good" : "muted"}>{l.status}</Pill> · {ago(l.createdAt)}
                </span>
                {l.status === "open" && (
                  <Btn
                    variant="ghost"
                    className="py-1 text-xs"
                    loading={cancel.isPending && cancel.variables?.listingId === l.id}
                    onClick={() => cancel.mutate({ listingId: l.id }, { onSuccess: (r) => setOk(`Cancelled; ${num(r.pointsReturned)} points returned.`) })}
                  >
                    Cancel
                  </Btn>
                )}
              </li>
            ))}
            {mine.data.equity.map((l) => (
              <li key={`e${l.id}`} className="flex items-center justify-between py-2">
                <span className="k-num">
                  {pct(l.equityBp, 3)} of <Link to={`/forge/project/${l.projectId}`} className="k-link">round #{l.projectId}</Link> for {money(l.askCents)} ·{" "}
                  <Pill tone={l.status === "open" ? "good" : "muted"}>{l.status}</Pill>
                </span>
                {l.status === "open" && l.lotKind === "member" && (
                  <Btn
                    variant="ghost"
                    className="py-1 text-xs"
                    loading={cancelEq.isPending && cancelEq.variables?.listingId === l.id}
                    onClick={() => cancelEq.mutate({ listingId: l.id }, { onSuccess: () => setOk("Equity listing withdrawn.") })}
                  >
                    Withdraw
                  </Btn>
                )}
              </li>
            ))}
          </ul>
          <ErrorLine error={cancel.error || cancelEq.error} />
        </Card>
      ) : null}
    </div>
  );
}
