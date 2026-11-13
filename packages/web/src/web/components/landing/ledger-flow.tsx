import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { log } from "../../lib/log";
import { useMotionAllowed, useOnScreen } from "./motion-prefs";

/**
 * Live schematic of one $10 ticket moving through the books.
 * Every figure mirrors the server rules in src/api/lib/economy.ts + services/tickets.ts:
 *   HOUSE_RATE 10% of the ticket, RESERVE_RATE 25% of that fee, the rest held in escrow
 *   until a milestone is verified; points per ticket = 10 × 2^(stage−1) while the $10 cap holds.
 * It is an explainer animation, not live activity — the caption says so.
 */

const TICKET = 1000;
const FEE = Math.round(TICKET * 0.1);
const RESERVE = Math.round(FEE * 0.25);
const HOUSE = FEE - RESERVE;
const HELD = TICKET - FEE;
const CYCLE = 7200;
const MAX_STAGE = 5;

type Packet = { id: string; path: number; start: number; end: number; label: string; tone: "primary" | "accent2" };

const PATHS = [
  "M129 80 H191", // 0 ticket → fee
  "M309 80 H352 Q364 80 364 68 V52 Q364 40 376 40 H411", // 1 fee → house
  "M309 80 H352 Q364 80 364 92 V108 Q364 120 376 120 H411", // 2 fee → reserve
  "M250 103 V197", // 3 fee → escrow (net)
  "M309 220 H411", // 4 escrow → milestone
  "M470 243 V277", // 5 milestone → creator
];

const PACKETS: Packet[] = [
  { id: "in", path: 0, start: 0, end: 900, label: "1000¢", tone: "primary" },
  { id: "house", path: 1, start: 1000, end: 1900, label: `${HOUSE}¢`, tone: "accent2" },
  { id: "reserve", path: 2, start: 1000, end: 1900, label: `${RESERVE}¢`, tone: "accent2" },
  { id: "held", path: 3, start: 1000, end: 2100, label: `${HELD}¢`, tone: "primary" },
  { id: "verify", path: 4, start: 3500, end: 4400, label: "proof", tone: "primary" },
  { id: "release", path: 5, start: 4700, end: 5400, label: "tranche", tone: "primary" },
];

/** Phase boundaries (ms into the cycle) drive node highlights and the trace readout. */
const PHASES = [
  { at: 0, key: "ticket" },
  { at: 900, key: "fee" },
  { at: 2100, key: "held" },
  { at: 3500, key: "verify" },
  { at: 4400, key: "verified" },
  { at: 5400, key: "released" },
] as const;
type PhaseKey = (typeof PHASES)[number]["key"];

const NODES: { key: string; x: number; y: number; title: string; sub: string; lit: PhaseKey[] }[] = [
  { key: "ticket", x: 70, y: 80, title: "TICKET", sub: "$10.00 cap", lit: ["ticket"] },
  { key: "fee", x: 250, y: 80, title: "FEE 10%", sub: "bookFee()", lit: ["fee"] },
  { key: "house", x: 470, y: 40, title: "HOUSE 75%", sub: "$0.75", lit: ["fee", "held", "verify", "verified", "released"] },
  { key: "reserve", x: 470, y: 120, title: "RESERVE 25%", sub: "$0.25", lit: ["fee", "held", "verify", "verified", "released"] },
  { key: "escrow", x: 250, y: 220, title: "ESCROW", sub: "held_cents", lit: ["held", "verify"] },
  { key: "milestone", x: 470, y: 220, title: "MILESTONE", sub: "admin verify", lit: ["verify", "verified"] },
  { key: "creator", x: 470, y: 300, title: "CREATOR", sub: "release", lit: ["released"] },
];

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function phaseAt(t: number): PhaseKey {
  let k: PhaseKey = "ticket";
  for (const p of PHASES) if (t >= p.at) k = p.key;
  return k;
}

export function LedgerFlow() {
  const allowed = useMotionAllowed("ledger-flow");
  const { ref: wrapRef, active } = useOnScreen<HTMLDivElement>("ledger-flow");
  const pathRefs = useRef<(SVGPathElement | null)[]>([]);
  const packetRefs = useRef<(SVGGElement | null)[]>([]);
  const clockRef = useRef<SVGTextElement | null>(null);
  const [phase, setPhase] = useState<PhaseKey>(allowed ? "ticket" : "released");
  const [stage, setStage] = useState(1);
  const elapsed = useRef(0);
  const cycle = useRef(0);

  useEffect(() => {
    if (!allowed || !active) return;
    let raf = 0;
    let last = performance.now();
    let currentPhase: PhaseKey | null = null;
    const lengths = pathRefs.current.map((p) => p?.getTotalLength() ?? 0);

    const frame = (now: number) => {
      elapsed.current += Math.min(64, now - last); // clamp so a stalled tab doesn't skip a whole cycle
      last = now;
      const n = Math.floor(elapsed.current / CYCLE);
      const t = elapsed.current % CYCLE;

      if (n !== cycle.current) {
        cycle.current = n;
        const next = (n % MAX_STAGE) + 1;
        setStage(next);
        log.decide("landing.ledger", "cycle complete; advancing stage to show points doubling under the same $10 cap", {
          stage: next,
          pointsPerTicket: 10 * 2 ** (next - 1),
        });
      }

      PACKETS.forEach((pk, i) => {
        const g = packetRefs.current[i];
        const path = pathRefs.current[pk.path];
        if (!g || !path) return;
        if (t < pk.start || t > pk.end + 120) {
          g.style.opacity = "0";
          return;
        }
        const k = ease(Math.min(1, (t - pk.start) / (pk.end - pk.start)));
        const pt = path.getPointAtLength(k * lengths[pk.path]);
        g.setAttribute("transform", `translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`);
        g.style.opacity = t > pk.end ? String(1 - (t - pk.end) / 120) : "1";
      });

      if (clockRef.current) clockRef.current.textContent = `T+${(t / 1000).toFixed(2)}s  #${String(n + 1).padStart(3, "0")}`;

      const ph = phaseAt(t);
      if (ph !== currentPhase) {
        currentPhase = ph;
        setPhase(ph);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [allowed, active]);

  const points = 10 * 2 ** (stage - 1);
  const order: PhaseKey[] = ["ticket", "fee", "held", "verify", "verified", "released"];
  const reached = (k: PhaseKey) => !allowed || order.indexOf(phase) >= order.indexOf(k);

  const trace: { k: PhaseKey; left: string; right: string }[] = [
    { k: "ticket", left: "ticket.amount", right: "$10.00" },
    { k: "ticket", left: `points @ stage ${stage}`, right: `+${points}` },
    { k: "fee", left: "fee = 10%", right: "$1.00" },
    { k: "fee", left: "├ house 75%", right: "$0.75" },
    { k: "fee", left: "└ reserve 25%", right: "$0.25" },
    { k: "held", left: "escrow.held_cents", right: String(HELD) },
    { k: "verified", left: "milestone.verified", right: "✓" },
    { k: "released", left: "tranche → creator", right: "sim" },
  ];

  return (
    <div ref={wrapRef} className="k-card relative overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="k-label">ledger.trace — one ticket</span>
        <span className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          <span className={cn("size-1.5 rounded-full bg-primary", allowed && active && "animate-pulse")} />
          {allowed ? (active ? "running" : "paused") : "static"}
        </span>
      </div>

      <svg viewBox="0 0 560 340" className="block w-full" role="img" aria-label="Diagram: a $10 ticket pays a 10% fee split 75% house and 25% reserve; $9 is held in escrow and released to the creator after a verified milestone.">
        <defs>
          <pattern id="k-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0 H0 V20" fill="none" className="stroke-border" strokeWidth="0.6" />
          </pattern>
          <filter id="k-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect width="560" height="340" fill="url(#k-grid)" opacity="0.6" />

        {/* wires: a dim base plus an animated dash overlay */}
        {PATHS.map((d, i) => (
          <g key={d}>
            <path ref={(el) => { pathRefs.current[i] = el; }} d={d} fill="none" className="stroke-border" strokeWidth="2" />
            <path
              d={d}
              fill="none"
              className={cn(i === 1 || i === 2 ? "stroke-accent2" : "stroke-primary", allowed && "k-wire")}
              strokeWidth="1.25"
              strokeDasharray="3 7"
              opacity="0.55"
            />
          </g>
        ))}

        {NODES.map((n) => {
          const lit = !allowed || n.lit.includes(phase);
          return (
            <g key={n.key} transform={`translate(${n.x} ${n.y})`}>
              <rect
                x={-59}
                y={-23}
                width={118}
                height={46}
                rx={4}
                className={cn("fill-card transition-[stroke] duration-300", lit ? "stroke-primary" : "stroke-border")}
                strokeWidth={lit ? 1.6 : 1}
                filter={lit && allowed ? "url(#k-glow)" : undefined}
              />
              {/* corner ticks — engineering-drawing feel */}
              <path d="M-59 -15 V-23 H-51 M51 -23 H59 V-15 M59 15 V23 H51 M-51 23 H-59 V15" fill="none" className={lit ? "stroke-primary" : "stroke-muted-foreground"} strokeWidth="1" opacity="0.8" />
              <text y={-3} textAnchor="middle" className={cn("font-mono text-[11px] font-bold", lit ? "fill-primary" : "fill-foreground")}>
                {n.title}
              </text>
              <text y={12} textAnchor="middle" className="fill-muted-foreground font-mono text-[9px]">
                {n.sub}
              </text>
              {n.key === "escrow" && phase === "held" && allowed && (
                <circle r="30" fill="none" className="stroke-primary k-ping" strokeWidth="1" />
              )}
            </g>
          );
        })}

        {PACKETS.map((pk, i) => (
          <g key={pk.id} ref={(el) => { packetRefs.current[i] = el; }} style={{ opacity: 0 }}>
            <circle r="5" className={pk.tone === "accent2" ? "fill-accent2" : "fill-primary"} filter="url(#k-glow)" />
            <text y={-10} textAnchor="middle" className="fill-foreground font-mono text-[9px] font-semibold">
              {pk.label}
            </text>
          </g>
        ))}

        <text ref={clockRef} x="12" y="330" className="fill-muted-foreground font-mono text-[9px]">
          {allowed ? "T+0.00s  #001" : "static frame"}
        </text>
        <text x="548" y="330" textAnchor="end" className="fill-muted-foreground font-mono text-[9px]">
          simulated · explainer, not live activity
        </text>
      </svg>

      <div className="grid grid-cols-1 gap-x-6 border-t border-border px-4 py-3 font-mono text-[11px] sm:grid-cols-2">
        {trace.map((line) => (
          <div
            key={line.left}
            className={cn("flex justify-between gap-3 transition-opacity duration-300", reached(line.k) ? "opacity-100" : "opacity-25")}
          >
            <span className="text-muted-foreground">
              <span className="text-primary">›</span> {line.left}
            </span>
            <span className="k-num text-foreground">{line.right}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
