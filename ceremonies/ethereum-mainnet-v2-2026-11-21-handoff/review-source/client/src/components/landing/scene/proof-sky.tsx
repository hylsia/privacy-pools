/**
 * Sky art for the proof scene (sections/ProofScene.tsx): a band of the galaxy
 * running diagonally behind the constellation, and a nebula of violet and
 * lavender light gathered around it. aria-hidden, seeded (identical on every
 * render), static — they move only with their SceneLayer — and drawn with
 * gradients only (no CSS filter).
 */
import { useId, useMemo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { rng } from "./geometry";

type Pt = readonly [number, number];

export interface ProofGalaxyProps {
  /** the band's spine, from → to, in the 1600 × 900 drawing (sliced to cover the box) */
  from?: Pt;
  to?: Pt;
  /** half-width of the band's glow in drawing units */
  width?: number;
  /** fine stars scattered along the band (they thin out away from the spine) */
  stars?: number;
  /** overall strength of the glow (default 1) */
  glow?: number;
  seed?: number;
  className?: string;
}

/**
 * A band of the galaxy: uneven soft light along a diagonal spine, a dark dust
 * lane just off it and a dense scatter of fine stars, a few of them bright.
 * One static SVG.
 */
export function ProofGalaxy({
  from = [700, -90],
  to = [1700, 960],
  width = 210,
  stars = 360,
  glow = 1,
  seed = 41,
  className,
}: ProofGalaxyProps) {
  const id = useId().replace(/:/g, "");
  const art = useMemo(() => {
    const rand = rng(seed);
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy);
    // unit normal (across the band)
    const nx = -dy / len;
    const ny = dx / len;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const at = (t: number, off: number) => [from[0] + dx * t + nx * off, from[1] + dy * t + ny * off] as const;
    // Box–Muller: stars crowd the spine and thin out across the band
    const gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-6, rand()))) * Math.cos(2 * Math.PI * rand());

    // the glow: overlapping soft ellipses along the spine, uneven in width and strength
    const clouds = Array.from({ length: 10 }, (_, i) => {
      const t = 0.04 + (i / 9) * 0.92 + (rand() - 0.5) * 0.05;
      const [cx, cy] = at(t, (rand() - 0.5) * width * 0.4);
      return { cx, cy, rx: len * (0.1 + rand() * 0.07), ry: width * (0.5 + rand() * 0.5), a: 0.5 + rand() * 0.5 };
    });
    // brighter knots of light on the spine
    const knots = Array.from({ length: 4 }, (_, i) => {
      const t = 0.2 + i * 0.2 + (rand() - 0.5) * 0.08;
      const [cx, cy] = at(t, (rand() - 0.5) * width * 0.2);
      return { cx, cy, rx: len * (0.04 + rand() * 0.04), ry: width * (0.18 + rand() * 0.14) };
    });
    // the dust lane: darker streaks just off the spine
    const dust = Array.from({ length: 5 }, (_, i) => {
      const t = 0.12 + i * 0.19 + (rand() - 0.5) * 0.06;
      const [cx, cy] = at(t, width * (0.08 + rand() * 0.14));
      return { cx, cy, rx: len * (0.06 + rand() * 0.05), ry: width * (0.07 + rand() * 0.07) };
    });
    const fine: { x: number; y: number; r: number; o: number }[] = [];
    const bright: { x: number; y: number; r: number }[] = [];
    for (let i = 0; i < stars; i++) {
      const [x, y] = at(rand() * 1.1 - 0.05, gauss() * width * 0.42);
      if (rand() < 0.045) bright.push({ x, y, r: 1.3 + rand() * 1.2 });
      else fine.push({ x, y, r: 0.4 + rand() * rand() * 1.15, o: 0.3 + rand() * 0.6 });
    }
    return { angle, clouds, knots, dust, fine, bright };
  }, [from, to, width, stars, seed]);

  const rot = (cx: number, cy: number) => `rotate(${art.angle.toFixed(2)} ${cx.toFixed(1)} ${cy.toFixed(1)})`;
  return (
    <svg
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid slice"
      className={cn("pointer-events-none", className)}
      aria-hidden
    >
      <defs>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" stopColor="#c9ccff" stopOpacity={0.11 * glow} />
          <stop offset="0.45" stopColor="#aeb4ff" stopOpacity={0.06 * glow} />
          <stop offset="1" stopColor="#8b6cf6" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-knot`}>
          <stop offset="0" stopColor="#eceaff" stopOpacity={0.12 * glow} />
          <stop offset="1" stopColor="#c9ccff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-dust`}>
          <stop offset="0" stopColor="#04051a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#04051a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-star`}>
          <stop offset="0" stopColor="#f4f3ff" stopOpacity="0.5" />
          <stop offset="0.35" stopColor="#c9ccff" stopOpacity="0.14" />
          <stop offset="1" stopColor="#c9ccff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {art.clouds.map((c, i) => (
        <ellipse
          key={`c${i}`}
          cx={c.cx.toFixed(1)}
          cy={c.cy.toFixed(1)}
          rx={c.rx.toFixed(1)}
          ry={c.ry.toFixed(1)}
          opacity={c.a.toFixed(2)}
          transform={rot(c.cx, c.cy)}
          fill={`url(#${id}-glow)`}
        />
      ))}
      {art.knots.map((c, i) => (
        <ellipse
          key={`k${i}`}
          cx={c.cx.toFixed(1)}
          cy={c.cy.toFixed(1)}
          rx={c.rx.toFixed(1)}
          ry={c.ry.toFixed(1)}
          transform={rot(c.cx, c.cy)}
          fill={`url(#${id}-knot)`}
        />
      ))}
      {art.dust.map((c, i) => (
        <ellipse
          key={`d${i}`}
          cx={c.cx.toFixed(1)}
          cy={c.cy.toFixed(1)}
          rx={c.rx.toFixed(1)}
          ry={c.ry.toFixed(1)}
          transform={rot(c.cx, c.cy)}
          fill={`url(#${id}-dust)`}
        />
      ))}
      <g fill="#eceaff">
        {art.fine.map((s, i) => (
          <circle key={i} cx={s.x.toFixed(1)} cy={s.y.toFixed(1)} r={s.r.toFixed(2)} opacity={s.o.toFixed(2)} />
        ))}
      </g>
      {art.bright.map((s, i) => (
        <g key={`b${i}`}>
          <circle cx={s.x.toFixed(1)} cy={s.y.toFixed(1)} r={(s.r * 6).toFixed(1)} fill={`url(#${id}-star)`} />
          <circle cx={s.x.toFixed(1)} cy={s.y.toFixed(1)} r={s.r.toFixed(2)} fill="#f8f7ff" />
        </g>
      ))}
    </svg>
  );
}

/** Where the nebula gathers: around the constellation on the right (wide) or behind it, centred (stacked). */
const NEBULA: Record<"wide" | "stacked", string> = {
  wide: [
    // a luminous core behind the tree, a warmer whisper around the note, violet gas around both
    "radial-gradient(13% 15% at 70% 47%, rgb(201 204 255 / 0.1), transparent 72%)",
    "radial-gradient(11% 11% at 77% 64%, rgb(245 213 138 / 0.08), transparent 72%)",
    "radial-gradient(30% 36% at 69% 42%, rgb(139 108 246 / 0.22), transparent 72%)",
    "radial-gradient(26% 22% at 82% 62%, rgb(174 180 255 / 0.15), transparent 72%)",
    "radial-gradient(22% 18% at 58% 26%, rgb(160 104 236 / 0.13), transparent 72%)",
    "radial-gradient(34% 20% at 64% 12%, rgb(106 75 224 / 0.14), transparent 72%)",
    "radial-gradient(18% 16% at 93% 30%, rgb(201 204 255 / 0.09), transparent 72%)",
    "radial-gradient(40% 26% at 22% 86%, rgb(106 75 224 / 0.08), transparent 72%)",
  ].join(","),
  stacked: [
    "radial-gradient(70% 22% at 50% 34%, rgb(139 108 246 / 0.16), transparent 72%)",
    "radial-gradient(52% 16% at 62% 44%, rgb(174 180 255 / 0.12), transparent 72%)",
    "radial-gradient(60% 18% at 30% 12%, rgb(106 75 224 / 0.12), transparent 72%)",
    "radial-gradient(70% 20% at 60% 74%, rgb(139 108 246 / 0.1), transparent 72%)",
  ].join(","),
};

/** Soft nebula light (static CSS gradients). Size and place it with className. */
export function ProofNebula({
  variant = "wide",
  className,
  style,
}: {
  variant?: "wide" | "stacked";
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute", className)}
      style={{ background: NEBULA[variant], ...style }}
    />
  );
}
