/**
 * The "Proof valid" seal of the proof scene (sections/ProofScene.tsx): a gold
 * medallion whose outer ring draws closed (SVG pathLength), then its engraved
 * inner ring, its rays and the shield light up. Decorative (aria-hidden): the
 * words "Proof valid" sit next to it as text. Before it draws, only a faint
 * lavender track shows where it will close.
 */
import { useId } from "react";
import { motion, useTransform, type MotionValue } from "framer-motion";
import { ShieldCheck } from "@/components/icons";
import { cn } from "@/lib/utils";

/** 24 short rays around the rim (every third one longer), in the 64-unit box. */
const RAYS = Array.from({ length: 24 }, (_, i) => {
  const a = (i / 24) * Math.PI * 2;
  const r0 = 34.5;
  const r1 = i % 3 === 0 ? 39 : 37;
  return `M${(32 + Math.cos(a) * r0).toFixed(2)} ${(32 + Math.sin(a) * r0).toFixed(2)}L${(32 + Math.cos(a) * r1).toFixed(2)} ${(32 + Math.sin(a) * r1).toFixed(2)}`;
}).join("");

export function ProofSeal({
  draw,
  lit,
  className,
}: {
  /** 0 → 1: the outer ring closes */
  draw: MotionValue<number>;
  /** 0 → 1: the medallion lights (after the ring has closed) */
  lit: MotionValue<number>;
  /** size it here (it is square) */
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const ring = useTransform(draw, (v: number) => (v > 0.001 ? 1 : 0));
  const pending = useTransform(lit, (v: number) => 0.6 * (1 - v));
  return (
    <span aria-hidden className={cn("relative block shrink-0", className)}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <linearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f5d58a" />
            <stop offset="0.5" stopColor="#ffe9b8" />
            <stop offset="1" stopColor="#d4ac4e" />
          </linearGradient>
          <radialGradient id={`${id}-disc`} cx="0.42" cy="0.36" r="0.7">
            <stop offset="0" stopColor="#f5d58a" stopOpacity="0.34" />
            <stop offset="0.6" stopColor="#b08f42" stopOpacity="0.16" />
            <stop offset="1" stopColor="#b08f42" stopOpacity="0.06" />
          </radialGradient>
          <radialGradient id={`${id}-halo`}>
            <stop offset="0.45" stopColor="#f5d58a" stopOpacity="0.28" />
            <stop offset="0.7" stopColor="#d4ac4e" stopOpacity="0.1" />
            <stop offset="1" stopColor="#d4ac4e" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* where the ring will close */}
        <circle cx="32" cy="32" r="30" fill="#0d1036" stroke="#aeb4ff" strokeOpacity="0.22" strokeWidth="1.2" />

        {/* lit: halo, gold disc, engraved inner ring and rays */}
        <motion.g style={{ opacity: lit }}>
          <circle cx="32" cy="32" r="58" fill={`url(#${id}-halo)`} />
          <circle cx="32" cy="32" r="29.4" fill={`url(#${id}-disc)`} />
          <circle cx="32" cy="32" r="24" fill="none" stroke="#f5d58a" strokeOpacity="0.55" strokeWidth="0.9" strokeDasharray="1.2 2.4" />
          <path d={RAYS} stroke="#f5d58a" strokeOpacity="0.7" strokeWidth="1.1" strokeLinecap="round" fill="none" />
        </motion.g>

        {/* the outer ring, drawn from the top */}
        <motion.circle
          cx="32"
          cy="32"
          r="30"
          fill="none"
          stroke={`url(#${id}-ring)`}
          strokeWidth="2.2"
          transform="rotate(-90 32 32)"
          style={{ pathLength: draw, opacity: ring }}
        />
      </svg>
      {/* the shield: lavender while pending, gold once the seal is whole */}
      <motion.span style={{ opacity: pending }} className="absolute inset-0 grid place-items-center">
        <ShieldCheck className="h-[38%] w-[38%] text-[color:var(--lavender)]" />
      </motion.span>
      <motion.span style={{ opacity: lit }} className="absolute inset-0 grid place-items-center">
        <ShieldCheck className="h-[38%] w-[38%] text-[color:var(--gold-hi)]" />
      </motion.span>
    </span>
  );
}
