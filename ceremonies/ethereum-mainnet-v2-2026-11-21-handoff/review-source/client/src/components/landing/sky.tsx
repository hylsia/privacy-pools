/**
 * Night-sky decorations for the landing page, drawn from the Hylsia artwork:
 * a glowing crescent moon, drifting ribbons of light, gold four-point
 * sparkles, a starfield and soft cloud banks. Purely decorative (aria-hidden).
 */
import { useId, useMemo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import "./sky.css";

/** Four-point sparkle with concave sides, as in the artwork. */
export function Sparkle({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("sky-sparkle", className)}
      style={style}
      aria-hidden
    >
      <path
        d="M12 0C12.9 7.3 16.7 11.1 24 12C16.7 12.9 12.9 16.7 12 24C11.1 16.7 7.3 12.9 0 12C7.3 11.1 11.1 7.3 12 0Z"
        fill="currentColor"
      />
    </svg>
  );
}

/** Seeded PRNG so the starfield is identical on every render. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A field of tiny stars in three layers that twinkle out of step. Each layer is
 * its own <svg> so the twinkle is a cheap opacity change, not a repaint.
 *
 * `twinkle`: "all" (default) — the three layers twinkle out of step; "one" —
 * only the top layer twinkles (calm, for large or long-lived fields such as the
 * page sky); "none" — a still field. A stopped layer keeps no compositing layer
 * and paints with its parent (see sky.css).
 */
export function Starfield({
  count = 140,
  seed = 11,
  twinkle = "all",
  className,
}: {
  count?: number;
  seed?: number;
  twinkle?: "all" | "one" | "none";
  className?: string;
}) {
  const groups = useMemo(() => {
    const rand = mulberry32(seed);
    const g: { x: number; y: number; r: number; o: number }[][] = [[], [], []];
    for (let i = 0; i < count; i++) {
      g[i % 3].push({
        x: rand() * 1600,
        y: rand() * 900,
        r: 0.5 + rand() * rand() * 1.6,
        o: 0.35 + rand() * 0.65,
      });
    }
    return g;
  }, [count, seed]);
  return (
    <div
      className={cn(
        "sky-stars",
        twinkle === "one" && "sky-stars--calm",
        twinkle === "none" && "sky-stars--still",
        className,
      )}
      aria-hidden
    >
      {groups.map((stars, gi) => (
        <svg
          key={gi}
          viewBox="0 0 1600 900"
          preserveAspectRatio="xMidYMid slice"
          className={`sky-stars-layer sky-stars-${gi}`}
        >
          {stars.map((s, i) => (
            <circle
              key={i}
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="currentColor"
              opacity={s.o}
            />
          ))}
        </svg>
      ))}
    </div>
  );
}

/** Glowing crescent moon with the faint rest of its disc, like the artwork. */
export function CrescentMoon({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      viewBox="0 0 200 200"
      className={cn("sky-moon", className)}
      style={style}
      aria-hidden
    >
      <defs>
        <mask id={`${id}-cut`}>
          <rect width="200" height="200" fill="#fff" />
          <circle cx="84" cy="94" r="86" fill="#000" />
        </mask>
        <linearGradient id={`${id}-lit`} x1="0.2" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="var(--moon-a)" />
          <stop offset="0.55" stopColor="var(--moon-b)" />
          <stop offset="1" stopColor="var(--moon-c)" />
        </linearGradient>
        <radialGradient id={`${id}-disc`} cx="0.42" cy="0.45" r="0.6">
          <stop offset="0" stopColor="var(--moon-disc)" stopOpacity="0.2" />
          <stop offset="1" stopColor="var(--moon-disc)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="96" fill={`url(#${id}-disc)`} />
      <circle
        cx="100"
        cy="100"
        r="96"
        fill="none"
        stroke="var(--moon-b)"
        strokeOpacity="0.22"
        strokeWidth="0.6"
      />
      <circle
        cx="100"
        cy="100"
        r="96"
        fill={`url(#${id}-lit)`}
        mask={`url(#${id}-cut)`}
      />
    </svg>
  );
}

const RIBBONS = [
  {
    d: "M-260 560 C -60 420, 60 250, 250 290 S 470 470, 640 330",
    w: 46,
    delay: 0,
  },
  {
    d: "M760 600 C 940 470, 1120 520, 1250 430 S 1420 300, 1520 330",
    w: 40,
    delay: -4,
  },
  {
    d: "M820 860 C 1000 730, 1160 800, 1300 700 S 1460 600, 1560 640",
    w: 30,
    delay: -8,
  },
];

/**
 * Translucent ribbons of light that drift behind the mascot. Drawn in the
 * artwork's pixel space (1233 × 1236) so they line up with the fox; each ribbon
 * is its own <svg> and drifts with a transform, so nothing is repainted.
 */
export function Ribbons({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <div className={cn("sky-ribbons", className)} aria-hidden>
      {RIBBONS.map((r, i) => (
        <svg
          key={i}
          viewBox="0 0 1233 1236"
          className="sky-ribbon"
          style={{ animationDelay: `${r.delay}s` }}
        >
          <defs>
            <linearGradient id={`${id}-band-${i}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--ribbon)" stopOpacity="0" />
              <stop offset="0.3" stopColor="var(--ribbon)" stopOpacity="0.5" />
              <stop offset="0.7" stopColor="var(--ribbon)" stopOpacity="0.36" />
              <stop offset="1" stopColor="var(--ribbon)" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${id}-edge-${i}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="var(--ribbon-edge)" stopOpacity="0" />
              <stop
                offset="0.45"
                stopColor="var(--ribbon-edge)"
                stopOpacity="0.55"
              />
              <stop offset="1" stopColor="var(--ribbon-edge)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d={r.d}
            fill="none"
            stroke={`url(#${id}-band-${i})`}
            strokeWidth={r.w * 1.6}
            strokeOpacity="0.35"
            strokeLinecap="round"
          />
          <path
            d={r.d}
            fill="none"
            stroke={`url(#${id}-band-${i})`}
            strokeWidth={r.w}
            strokeLinecap="round"
          />
          <path
            d={r.d}
            fill="none"
            stroke={`url(#${id}-edge-${i})`}
            strokeWidth="2.5"
            transform={`translate(0 ${-r.w / 2.6})`}
          />
        </svg>
      ))}
    </div>
  );
}

export interface Puff {
  left: number;
  bottom: number;
  width: number;
  height: number;
}

/** A bank of soft cloud puffs (positions in % of the bank). */
export function CloudBank({
  puffs,
  className,
}: {
  puffs: Puff[];
  className?: string;
}) {
  return (
    <div className={cn("sky-clouds", className)} aria-hidden>
      {puffs.map(p => (
        <span
          key={`${p.left}-${p.bottom}`}
          className="sky-puff"
          style={{
            left: `${p.left}%`,
            bottom: `${p.bottom}%`,
            width: `${p.width}%`,
            height: `${p.height}%`,
          }}
        />
      ))}
      <span className="sky-cloud-floor" />
    </div>
  );
}
