import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { log } from "../../lib/log";

/**
 * Shared motion policy for the landing page.
 * - Honors prefers-reduced-motion: animations render their final frame instead of playing.
 * - Pauses rAF loops while the element is offscreen or the tab is hidden, so the page costs nothing idle.
 */
export function useMotionAllowed(scope: string) {
  const reduced = useReducedMotion() ?? false;
  const logged = useRef(false);
  useEffect(() => {
    if (logged.current) return;
    logged.current = true;
    log.decide("landing.motion", reduced ? "reduced motion: rendering static final frames" : "full motion enabled", { scope });
  }, [reduced, scope]);
  return !reduced;
}

/** True while the element is at least partly on screen and the document is visible. */
export function useOnScreen<T extends Element>(scope: string, threshold = 0.15) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  const [visible, setVisible] = useState(typeof document === "undefined" ? true : !document.hidden);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        setInView((prev) => {
          if (prev !== entry.isIntersecting) log.decide("landing.motion", entry.isIntersecting ? "resume" : "pause (offscreen)", { scope });
          return entry.isIntersecting;
        });
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [scope, threshold]);

  useEffect(() => {
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return { ref, active: inView && visible, inView };
}
