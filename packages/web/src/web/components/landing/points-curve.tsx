import { motion } from "motion/react";
import { useMotionAllowed } from "./motion-prefs";
import { log } from "../../lib/log";

/**
 * Chart of the core economic rule: the ticket stays capped at $10 at every stage,
 * while points per ticket double with each verified milestone (10 × 2^(stage−1)).
 * Bars grow in sequence when scrolled into view; the cap line draws flat across.
 */
const STAGES = [1, 2, 3, 4, 5].map((s) => ({ stage: s, points: 10 * 2 ** (s - 1) }));
const MAX = STAGES[STAGES.length - 1].points;
const W = 520;
const H = 240;
const PAD = { l: 44, r: 16, t: 20, b: 36 };
const innerW = W - PAD.l - PAD.r;
const innerH = H - PAD.t - PAD.b;
const slot = innerW / STAGES.length;
const barW = slot * 0.46;
// The $10 cap is plotted on its own axis at a fixed height so it reads as "flat", not as points.
const capY = PAD.t + innerH * 0.78;

export function PointsCurve() {
  const allowed = useMotionAllowed("points-curve");
  const view = { once: true, amount: 0.4 } as const;

  return (
    <div className="k-card p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="k-label">fig. 1 — cap vs. points</span>
        <span className="font-mono text-[10px] text-muted-foreground">pointValueForStage(s) = 10·2^(s−1)</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Bar chart: points per ticket are 10, 20, 40, 80 and 160 at stages 1 to 5, while the ticket price stays capped at $10.">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = PAD.t + innerH * (1 - f);
          return (
            <g key={f}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} className="stroke-border" strokeDasharray="2 4" />
              <text x={PAD.l - 8} y={y + 3} textAnchor="end" className="fill-muted-foreground font-mono text-[9px]">
                {Math.round(MAX * f)}
              </text>
            </g>
          );
        })}

        {STAGES.map((s, i) => {
          const h = (s.points / MAX) * innerH;
          const x = PAD.l + slot * i + (slot - barW) / 2;
          const y = PAD.t + innerH - h;
          return (
            <g key={s.stage}>
              <motion.rect
                x={x}
                width={barW}
                rx={2}
                className="fill-primary"
                initial={allowed ? { y: PAD.t + innerH, height: 0 } : false}
                whileInView={{ y, height: h }}
                viewport={view}
                transition={{ delay: 0.15 + i * 0.16, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                onAnimationComplete={() => i === STAGES.length - 1 && log.decide("landing.curve", "points curve drawn", { stages: STAGES.length })}
              />
              <motion.text
                x={x + barW / 2}
                y={y - 6}
                textAnchor="middle"
                className="fill-foreground font-mono text-[10px] font-bold"
                initial={allowed ? { opacity: 0 } : false}
                whileInView={{ opacity: 1 }}
                viewport={view}
                transition={{ delay: 0.55 + i * 0.16 }}
              >
                {s.points}
              </motion.text>
              <text x={x + barW / 2} y={H - PAD.b + 16} textAnchor="middle" className="fill-muted-foreground font-mono text-[9px]">
                STAGE {s.stage}
              </text>
            </g>
          );
        })}

        <motion.line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={capY}
          y2={capY}
          className="stroke-accent2"
          strokeWidth={2}
          initial={allowed ? { pathLength: 0 } : false}
          whileInView={{ pathLength: 1 }}
          viewport={view}
          transition={{ delay: 0.1, duration: 1.1, ease: "easeInOut" }}
        />
        <motion.text
          x={W - PAD.r}
          y={capY - 6}
          textAnchor="end"
          className="fill-accent2 font-mono text-[10px] font-bold"
          initial={allowed ? { opacity: 0 } : false}
          whileInView={{ opacity: 1 }}
          viewport={view}
          transition={{ delay: 1.1 }}
        >
          $10 TICKET CAP — EVERY STAGE
        </motion.text>
      </svg>
    </div>
  );
}
