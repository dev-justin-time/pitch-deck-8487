import { useEffect, useRef, useState } from "react";
import { animate } from "motion";
import { useMotionAllowed, useOnScreen } from "./motion-prefs";

/**
 * Counts from 0 to `value` once, the first time it scrolls into view.
 * The formatter receives an integer so cents/points never show fractional junk mid-animation.
 */
export function CountUp({ value, format, duration = 1.4 }: { value: number; format: (n: number) => string; duration?: number }) {
  const allowed = useMotionAllowed("count-up");
  const { ref, inView } = useOnScreen<HTMLSpanElement>("count-up", 0.4);
  const [shown, setShown] = useState(allowed ? 0 : value);
  const played = useRef(false);
  const last = useRef(shown);
  last.current = shown;

  useEffect(() => {
    if (!allowed) {
      setShown(value);
      return;
    }
    if (!inView) return;
    // Replay only when the value itself changes (e.g. data refetch), not on every scroll.
    const from = played.current ? last.current : 0;
    played.current = true;
    const controls = animate(from, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, inView, allowed, duration]);

  return (
    <span ref={ref} className="k-num">
      {format(shown)}
    </span>
  );
}
