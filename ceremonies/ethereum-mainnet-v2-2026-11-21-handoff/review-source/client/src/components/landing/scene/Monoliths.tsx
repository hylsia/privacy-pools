/**
 * The Hylsia logo as scene architecture: two violet monoliths drawn exactly
 * like /logo.png (outer edge vertical, inner top sloping down towards the
 * centre at 45°, rounded corners) with the gold diamond floating in the gap,
 * plus the Diamond on its own for notes and deposits. Gold means "value / your
 * note" only. Gradients and strokes only: no filters.
 */
import { useId, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

// ─── Diamond ──────────────────────────────────────────────────────────────────

/** The logo's diamond in a 100 × 120 box: left facet, right facet, rim. */
const DIAMOND_LEFT = "M50 5L5 60L50 115Z";
const DIAMOND_RIGHT = "M50 5L95 60L50 115Z";
const DIAMOND_RIM = "M50 5L95 60L50 115L5 60Z";

export interface DiamondProps {
  /** width in px (height is 1.2×); default 40 */
  size?: number;
  /** soft gold glow behind it (radial gradient, default true) */
  glow?: boolean;
  /** slow float (CSS, off with reduced motion and while idle) */
  bob?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Gold rhombus with two facets (--gold-logo / --gold-lo) and a --gold-hi rim. aria-hidden. */
export function Diamond({ size = 40, glow = true, bob = false, className, style }: DiamondProps) {
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none relative inline-block", bob && "scene-bob", className)}
      style={{ width: size, height: size * 1.2, ...style }}
    >
      {glow && <span className="scene-glow" style={{ inset: `${-size * 0.95}px` }} />}
      <svg viewBox="0 0 100 120" className="relative block h-full w-full overflow-visible">
        <DiamondArt />
      </svg>
    </span>
  );
}

function DiamondArt() {
  return (
    <>
      <path d={DIAMOND_LEFT} fill="var(--gold-logo)" />
      <path d={DIAMOND_RIGHT} fill="var(--gold-lo)" />
      <path d={DIAMOND_RIM} fill="none" stroke="var(--gold-hi)" strokeWidth="5" strokeLinejoin="round" />
      {/* a glint along the upper-left facet */}
      <path d="M48 15L17 54" stroke="#fffaf0" strokeOpacity="0.45" strokeWidth="2.5" strokeLinecap="round" />
    </>
  );
}

// ─── Monoliths ────────────────────────────────────────────────────────────────

/**
 * Pillar outlines in the logo's 960-unit space, extended down to `bottom`.
 * Sharp corners: tip (168, 102), inner top (392, 326), and the two at the base;
 * each is rounded with a quadratic curve like the logo's.
 */
function pillar(bottom: number, mirror: boolean): string {
  const X = (x: number) => (mirror ? 960 - x : x);
  const b = bottom;
  return [
    `M${X(168)} 146`,
    `Q${X(168)} 102 ${X(199)} 133`,
    `L${X(378)} 312`,
    `Q${X(392)} 326 ${X(392)} 346`,
    `L${X(392)} ${b - 24}`,
    `Q${X(392)} ${b} ${X(368)} ${b}`,
    `L${X(192)} ${b}`,
    `Q${X(168)} ${b} ${X(168)} ${b - 24}`,
    "Z",
  ].join("");
}

export interface MonolithsProps {
  /** extra height below the logo's proportions, in logo units (0 = the logo; 400 ≈ half again). Default 240 */
  extend?: number;
  /** the gold diamond floating in the gap (default true) */
  diamond?: boolean;
  /** the diamond's slow float (default true; off with reduced motion) */
  bob?: boolean;
  /** box: position and width (height follows the drawing) */
  className?: string;
  style?: CSSProperties;
}

/**
 * Two monoliths with the diamond between them = the pool. Violet gradient
 * (--violet-hi → --violet → --violet-lo), moonlight on the sloped tops, the
 * diamond's gold light on the inner edges, and the bases darkening into the
 * night so they can stand in cloud or on a ridge. aria-hidden.
 */
export function Monoliths({ extend = 240, diamond = true, bob = true, className, style }: MonolithsProps) {
  const id = useId().replace(/:/g, "");
  const bottom = 840 + extend;
  // viewBox crops the logo's padding: x 150 … 810, y 96 … bottom + 4
  const vb = { x: 150, y: 96, w: 660, h: bottom + 4 - 96 };
  const left = pillar(bottom, false);
  const right = pillar(bottom, true);
  // diamond centre in the logo is (480, 512); its box is 224 × 268 there
  const dLeft = ((368 - vb.x) / vb.w) * 100;
  const dTop = ((378 - vb.y) / vb.h) * 100;
  const dWidth = (224 / vb.w) * 100;

  return (
    <div aria-hidden className={cn("pointer-events-none relative", className)} style={style}>
      <svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} className="block h-auto w-full overflow-visible">
        <defs>
          <linearGradient id={`${id}-body`} gradientUnits="userSpaceOnUse" x1="0" y1="110" x2="0" y2={bottom}>
            <stop offset="0" stopColor="var(--violet-hi)" />
            <stop offset="0.42" stopColor="var(--violet)" />
            <stop offset="0.74" stopColor="var(--violet-lo)" />
            <stop offset="1" stopColor="#1c1466" />
          </linearGradient>
          {/* the diamond's light on the faces around the gap */}
          <radialGradient id={`${id}-gold`} gradientUnits="userSpaceOnUse" cx="480" cy="512" r="300">
            <stop offset="0" stopColor="#f5d58a" stopOpacity="0.34" />
            <stop offset="0.45" stopColor="#d4ac4e" stopOpacity="0.12" />
            <stop offset="1" stopColor="#d4ac4e" stopOpacity="0" />
          </radialGradient>
          {/* the outer faces turn a little away from the light */}
          <linearGradient id={`${id}-turn`} gradientUnits="userSpaceOnUse" x1="168" y1="0" x2="392" y2="0">
            <stop offset="0" stopColor="#04051a" stopOpacity="0.28" />
            <stop offset="0.6" stopColor="#04051a" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-turn-r`} gradientUnits="userSpaceOnUse" x1="792" y1="0" x2="568" y2="0">
            <stop offset="0" stopColor="#04051a" stopOpacity="0.2" />
            <stop offset="0.6" stopColor="#04051a" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-inner`} gradientUnits="userSpaceOnUse" x1="0" y1="330" x2="0" y2="760">
            <stop offset="0" stopColor="#f5d58a" stopOpacity="0" />
            <stop offset="0.42" stopColor="#f5d58a" stopOpacity="0.85" />
            <stop offset="1" stopColor="#f5d58a" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`${id}-clip`}>
            <path d={left} />
            <path d={right} />
          </clipPath>
        </defs>

        <path d={left} fill={`url(#${id}-body)`} />
        <path d={right} fill={`url(#${id}-body)`} />
        <g clipPath={`url(#${id}-clip)`}>
          <rect x="150" y="96" width="250" height={vb.h} fill={`url(#${id}-turn)`} />
          <rect x="560" y="96" width="250" height={vb.h} fill={`url(#${id}-turn-r)`} />
          {diamond && <rect x="150" y="96" width="660" height={vb.h} fill={`url(#${id}-gold)`} />}
        </g>

        {/* moonlight along the sloped tops and the outer tips */}
        <path d="M168 150Q168 102 199 133L378 312" fill="none" stroke="#ecebff" strokeOpacity="0.62" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M792 150Q792 102 761 133L582 312" fill="none" stroke="#ecebff" strokeOpacity="0.5" strokeWidth="2.4" strokeLinecap="round" />
        {/* gold light on the inner edges, strongest beside the diamond */}
        {diamond && (
          <>
            <path d={`M392 346L392 760`} fill="none" stroke={`url(#${id}-inner)`} strokeWidth="3" />
            <path d={`M568 346L568 760`} fill="none" stroke={`url(#${id}-inner)`} strokeWidth="3" />
          </>
        )}
      </svg>

      {diamond && (
        <span className="absolute" style={{ left: `${dLeft}%`, top: `${dTop}%`, width: `${dWidth}%` }}>
          {/* glow centred on the diamond: 2.8× its width (the span is 1 wide × 1.2 tall) */}
          <span className="scene-glow" style={{ left: "-90%", top: "-66.7%", width: "280%", aspectRatio: "1" }} />
          <span className={cn("relative block", bob && "scene-bob")}>
            <svg viewBox="0 0 100 120" className="block h-auto w-full overflow-visible">
              <DiamondArt />
            </svg>
          </span>
        </span>
      )}
    </div>
  );
}
