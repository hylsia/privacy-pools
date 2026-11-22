/**
 * Art for the end of the night journey: the dawn of the closing scene
 * (sections/Cta.tsx), the faint constellation behind the FAQ (sections/Faq.tsx)
 * and the dark foreground ridge the footer stands on (sections/Chrome.tsx).
 *
 *   DAWN_SEA, DAWN_FLOOR   CloudDeck palettes whose crests catch the dawn
 *   DawnGlow               the warm lavender / gold glow on the horizon
 *   DawnWisps              thin streaks of high cloud lit rose and gold from below
 *   DawnRays               faint crepuscular rays fanning up from the glow
 *   FAQ_STARS, FAQ_LINKS   the FAQ constellation (a loose "?" of nine stars)
 *   HorizonEdge            the footer's top edge: gentle dark hills with a faint
 *                          line of light along their crest
 *
 * All aria-hidden, deterministic (seeded) and drawn with gradients only (no
 * filters), so they are cheap to move in a SceneLayer.
 */
import { useId, useMemo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { rng, splinePath, type StarNode } from "@/components/landing/scene";

// ─── Clouds at dawn ───────────────────────────────────────────────────────────

/** The cloud sea between the ridges: rose-lavender crests catching the first light, lavender bodies, deep blue bases. */
export const DAWN_SEA = { top: "#ecd3e3", mid: "#8a85cc", low: "#283071" } as const;

/** The cloud floor in the foreground: backlit, so darker, with lavender crests. */
export const DAWN_FLOOR = { top: "#8c84cf", mid: "#353a86", low: "#141845" } as const;

// ─── Glow ─────────────────────────────────────────────────────────────────────

/**
 * The dawn on the horizon: a warm gold core inside a rose and lavender bloom,
 * all radial gradients (no filter). The box is the glow's full extent; put its
 * centre on the horizon (the far ridge's crests) and keep it behind the ridge.
 */
export function DawnGlow({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute", className)}
      style={{
        background: [
          "radial-gradient(closest-side, rgb(255 233 190 / 0.62), rgb(245 213 138 / 0.36) 24%, rgb(232 168 170 / 0.18) 52%, transparent 100%)",
          "radial-gradient(50% 50% at 50% 52%, rgb(174 180 255 / 0.16), transparent 100%)",
        ].join(", "),
        ...style,
      }}
    />
  );
}

// ─── Rays ─────────────────────────────────────────────────────────────────────

/** Irregular wedges (start, peak, end in degrees from the left horizon) and their peak opacity. */
const RAYS: readonly (readonly [number, number, number, number])[] = [
  [6, 10, 15, 0.05],
  [24, 28, 33, 0.07],
  [44, 49, 55, 0.055],
  [63, 68, 72, 0.07],
  [83, 89, 96, 0.06],
  [107, 112, 117, 0.075],
  [127, 132, 138, 0.05],
  [148, 153, 158, 0.06],
  [166, 170, 174, 0.045],
];

/**
 * Crepuscular rays: warm wedges fanning up from the middle of the box's bottom
 * edge (put that on the horizon, behind the far ridge), fading with distance.
 * One painted gradient with a mask, no filter.
 */
export function DawnRays({ className }: { className?: string }) {
  const stops = RAYS.flatMap(([a, m, b, o]) => [
    `transparent ${a}deg`,
    `rgb(255 224 196 / ${o}) ${m}deg`,
    `transparent ${b}deg`,
  ]).join(", ");
  const mask = "radial-gradient(56% 100% at 50% 100%, #000 0%, rgb(0 0 0 / 0.55) 42%, transparent 100%)";
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute", className)}
      style={{
        background: `conic-gradient(from -90deg at 50% 100%, ${stops}, transparent 180deg)`,
        WebkitMaskImage: mask,
        maskImage: mask,
      }}
    />
  );
}

// ─── Wisps ────────────────────────────────────────────────────────────────────

type WispTone = "rose" | "peach" | "gold" | "lavender";
const WISP_COLOR: Record<WispTone, string> = {
  rose: "#eaa9c6",
  peach: "#f6cdb6",
  gold: "#f5d58a",
  lavender: "#c9ccff",
};

/** Streaks in a 1600 × 180 drawing: [cx, cy, rx, ry, tone, peak opacity]. Clear of the centre, where the copy is. */
const WISPS: readonly (readonly [number, number, number, number, WispTone, number])[] = [
  [150, 40, 230, 10, "lavender", 0.3],
  [250, 78, 280, 8, "rose", 0.5],
  [120, 112, 190, 6, "peach", 0.55],
  [330, 140, 230, 5, "gold", 0.4],
  [1370, 52, 260, 9, "lavender", 0.3],
  [1300, 90, 250, 7, "rose", 0.5],
  [1480, 120, 200, 6, "peach", 0.55],
  [1230, 150, 210, 5, "gold", 0.4],
  [800, 168, 420, 5, "peach", 0.34],
];

/**
 * Thin streaks of high cloud lit from below by the dawn: each is a soft
 * ellipse (radial gradient, no filter) with a brighter core along its lower
 * edge. Size and place the box with className; the drawing fills it (slice).
 */
export function DawnWisps({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 1600 180"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      className={cn("pointer-events-none absolute overflow-visible", className)}
    >
      <defs>
        {(Object.keys(WISP_COLOR) as WispTone[]).map((tone) => (
          <radialGradient key={tone} id={`${id}-${tone}`}>
            <stop offset="0" stopColor={WISP_COLOR[tone]} stopOpacity="1" />
            <stop offset="0.45" stopColor={WISP_COLOR[tone]} stopOpacity="0.45" />
            <stop offset="1" stopColor={WISP_COLOR[tone]} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {WISPS.map(([cx, cy, rx, ry, tone, a], i) => (
        <g key={i}>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry * 2.4} fill={`url(#${id}-${tone})`} opacity={a * 0.5} />
          <ellipse cx={cx + rx * 0.06} cy={cy + ry * 0.45} rx={rx * 0.7} ry={ry * 0.8} fill={`url(#${id}-${tone})`} opacity={a * 0.62} />
        </g>
      ))}
    </svg>
  );
}

// ─── FAQ constellation ────────────────────────────────────────────────────────

/**
 * Nine stars in a loose question mark (drawing space 1000 × 600): a hook of
 * five stars, a stem of two, a gap and the dot, which is the brightest.
 */
export const FAQ_STARS: readonly StarNode[] = [
  { x: 380, y: 170, r: 3.2, tone: "lavender" },
  { x: 452, y: 96, r: 4 },
  { x: 560, y: 78, r: 3.4, tone: "lavender" },
  { x: 650, y: 128, r: 4.4 },
  { x: 654, y: 226, r: 3.2, tone: "lavender" },
  { x: 566, y: 300, r: 3.6 },
  { x: 520, y: 384, r: 3, tone: "lavender" },
  { x: 512, y: 456, r: 3.4 },
  { x: 506, y: 540, r: 5.4 },
];

/** Hook, then stem; the dot stands alone. */
export const FAQ_LINKS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 5],
  [5, 6],
  [6, 7],
];

/** A few loose stars around it (no links), for depth. */
export const FAQ_FIELD: readonly StarNode[] = [
  { x: 210, y: 320, r: 2.6, tone: "lavender" },
  { x: 300, y: 470, r: 2.2 },
  { x: 760, y: 360, r: 2.4, tone: "lavender" },
  { x: 842, y: 156, r: 2.8 },
  { x: 118, y: 120, r: 2.2 },
];

// ─── Footer horizon ───────────────────────────────────────────────────────────

/**
 * Gentle dark hills along the top of the footer, filled with the footer's own
 * colour, so the page ends on solid ground; a faint line of light runs along
 * their crest, warmest in the middle where the dawn is. Drawn 1600 × 100 and
 * stretched to its box (the crest line keeps a 1px stroke). Place the box so it
 * rises above the footer's top edge (e.g. `absolute inset-x-0 bottom-full h-16`)
 * and give the footer a top colour of `fill` (default #080a28).
 */
export function HorizonEdge({
  seed = 5,
  fill = "#080a28",
  className,
}: {
  seed?: number;
  fill?: string;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const { crest, shape } = useMemo(() => {
    const rand = rng(seed);
    const n = 9;
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const x = -60 + (i * 1720) / n + (i > 0 && i < n ? (rand() - 0.5) * 70 : 0);
      // alternate low saddles and rounded tops, highest towards the sides
      const side = Math.abs(i / n - 0.5) * 2;
      const y = i % 2 === 1 ? 26 + rand() * 22 - side * 14 : 60 + rand() * 18;
      pts.push([x, y]);
    }
    const line = splinePath(pts, 0.9);
    return { crest: line, shape: `${line}L1660 104L-60 104Z` };
  }, [seed]);

  return (
    <svg
      viewBox="0 0 1600 100"
      preserveAspectRatio="none"
      aria-hidden
      className={cn("pointer-events-none block w-full", className)}
    >
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0e1238" />
          <stop offset="0.55" stopColor={fill} />
          <stop offset="1" stopColor={fill} />
        </linearGradient>
        <linearGradient id={`${id}-line`} x1="0" y1="0" x2="1600" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#aeb4ff" stopOpacity="0" />
          <stop offset="0.24" stopColor="#aeb4ff" stopOpacity="0.32" />
          <stop offset="0.5" stopColor="#f5d58a" stopOpacity="0.62" />
          <stop offset="0.76" stopColor="#aeb4ff" stopOpacity="0.32" />
          <stop offset="1" stopColor="#aeb4ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={shape} fill={`url(#${id}-fill)`} />
      {/* a soft halo, then the hairline itself */}
      <path
        d={crest}
        fill="none"
        stroke={`url(#${id}-line)`}
        strokeOpacity="0.28"
        strokeWidth="7"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={crest}
        fill="none"
        stroke={`url(#${id}-line)`}
        strokeWidth="1.2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
