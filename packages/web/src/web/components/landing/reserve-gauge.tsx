import { motion } from "motion/react";
import { useMotionAllowed } from "./motion-prefs";

/**
 * Radial gauge for Mutual Cover Reserve coverage (reserve ÷ simulated escrow exposure).
 * The tick marks the 25% target. Values above 100% clamp the arc but keep the true label.
 */
const R = 52;
const TARGET = 0.25;

export function ReserveGauge({ ratio }: { ratio: number }) {
  const allowed = useMotionAllowed("reserve-gauge");
  const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : 0;
  const arc = Math.min(1, safe);
  const tickAngle = TARGET * 2 * Math.PI - Math.PI / 2;
  const tx = 64 + Math.cos(tickAngle) * R;
  const ty = 64 + Math.sin(tickAngle) * R;
  const met = safe >= TARGET;

  return (
    <svg viewBox="0 0 128 128" className="size-32 shrink-0" role="img" aria-label={`Reserve coverage ${(safe * 100).toFixed(1)} percent against a 25 percent target`}>
      <circle cx="64" cy="64" r={R} fill="none" className="stroke-muted" strokeWidth="10" />
      <motion.circle
        cx="64"
        cy="64"
        r={R}
        fill="none"
        className={met ? "stroke-primary" : "stroke-warn"}
        strokeWidth="10"
        strokeLinecap="round"
        transform="rotate(-90 64 64)"
        initial={allowed ? { pathLength: 0 } : false}
        whileInView={{ pathLength: arc }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
      />
      <circle cx={tx} cy={ty} r="3.5" className="fill-accent2" />
      <text x="64" y="62" textAnchor="middle" className="fill-foreground font-mono text-[15px] font-bold">
        {(safe * 100).toFixed(1)}%
      </text>
      <text x="64" y="78" textAnchor="middle" className="fill-muted-foreground font-mono text-[8px]">
        TARGET 25%
      </text>
    </svg>
  );
}
