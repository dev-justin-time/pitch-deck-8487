import { useEffect, useState } from "react";
import { useMotionAllowed } from "./motion-prefs";

const GLYPHS = "01$¢#%/<>[]=+*";

/**
 * Terminal-style decode: characters resolve left to right out of random glyphs.
 * Runs once on mount (~0.9s). Screen readers always get the final text via aria-label.
 */
export function DecodeText({ text, className, delay = 150 }: { text: string; className?: string; delay?: number }) {
  const allowed = useMotionAllowed("decode-text");
  const [out, setOut] = useState(allowed ? "" : text);

  useEffect(() => {
    if (!allowed) {
      setOut(text);
      return;
    }
    let frame = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      timer = setInterval(() => {
        frame += 1;
        const resolved = Math.floor(frame / 2);
        if (resolved >= text.length) {
          setOut(text);
          clearInterval(timer);
          return;
        }
        setOut(
          text
            .split("")
            .map((ch, i) => (i < resolved || ch === " " ? ch : GLYPHS[(i * 7 + frame) % GLYPHS.length]))
            .join(""),
        );
      }, 22);
    }, delay);
    return () => {
      clearTimeout(start);
      if (timer) clearInterval(timer);
    };
  }, [text, allowed, delay]);

  return (
    <span className={className} aria-label={text}>
      <span aria-hidden>{out || " "}</span>
    </span>
  );
}
