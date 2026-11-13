import { motion } from "motion/react";
import { useMotionAllowed } from "./motion-prefs";

/** Staggered scroll reveal for a grid of children. Reduced motion renders them in place. */
export function RevealGroup({ className, children }: { className?: string; children: React.ReactNode }) {
  const allowed = useMotionAllowed("reveal");
  return (
    <motion.div
      className={className}
      initial={allowed ? "hidden" : false}
      whileInView="shown"
      viewport={{ once: true, amount: 0.2 }}
      variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.08 } } }}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 18, filter: "blur(4px)" },
        shown: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.5, ease: [0.2, 0.8, 0.2, 1] } },
      }}
    >
      {children}
    </motion.div>
  );
}
