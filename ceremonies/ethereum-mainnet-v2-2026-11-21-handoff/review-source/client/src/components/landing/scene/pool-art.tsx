/**
 * Art for the pool scene (sections/PoolScene.tsx) that the scene kit does not
 * draw itself:
 *
 *   CeilingMass   the underside of the hero's cloud as the camera comes out of
 *                 it: a heavy mass of billows with a rounded inner end, drawn in
 *                 the dive's colours (--wipe-deep body, --wipe-under billows), so
 *                 it continues the hero's CloudSeam without an edge. Two of them,
 *                 mirrored, part over the pool.
 *   NoteDiamond   the logo's diamond in SVG user units (a deposit / a note)
 *   sparklePath   a four-point star in SVG user units (the "fresh address")
 *   POOL_*        the pool's geometry in the logo's 960-unit space, i.e. the
 *                 Monoliths' own viewBox, so beats drawn over the monoliths stay
 *                 locked to the gap at every size
 *
 * Static, aria-hidden, seeded; gradients and strokes only, no filters.
 */
import { useId, useMemo, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { rng } from "./geometry";

export type PoolPt = readonly [number, number];

const r1 = (v: number) => Math.round(v * 10) / 10;

// ─── Pool geometry (the Monoliths' logo units) ────────────────────────────────

/** Monoliths `extend` used by the pool scene. */
export const POOL_EXTEND = 320;
/** The Monoliths viewBox for that extend (x 150 … 810, y 96 … bottom + 4). */
export const POOL_VB = {
  x: 150,
  y: 96,
  w: 660,
  h: 840 + POOL_EXTEND + 4 - 96,
} as const;
export const POOL_VIEWBOX = `${POOL_VB.x} ${POOL_VB.y} ${POOL_VB.w} ${POOL_VB.h}`;
/** Height of the monoliths' box as a multiple of its width. */
export const POOL_ASPECT = POOL_VB.h / POOL_VB.w;
/** Centre of the gap between the pillars, where the diamond floats: the pool. */
export const POOL_GAP = { x: 480, y: 512 } as const;
/** The ring of light: a tilted orbit around both pillars, a little below the diamond. */
export const POOL_RING = { cx: 480, cy: 566, rx: 432, ry: 92 } as const;

/** A point on the ring; 0° is its right end, angles grow clockwise on screen (0–180 = the front half). */
export function ringPoint(deg: number): { x: number; y: number } {
  const t = (deg * Math.PI) / 180;
  return {
    x: r1(POOL_RING.cx + POOL_RING.rx * Math.cos(t)),
    y: r1(POOL_RING.cy + POOL_RING.ry * Math.sin(t)),
  };
}

/** The ring's two halves, both drawn from its left end: over the top (behind the pillars) and under (in front). */
export const POOL_RING_BACK = `M${POOL_RING.cx - POOL_RING.rx} ${POOL_RING.cy}A${POOL_RING.rx} ${POOL_RING.ry} 0 0 1 ${POOL_RING.cx + POOL_RING.rx} ${POOL_RING.cy}`;
export const POOL_RING_FRONT = `M${POOL_RING.cx - POOL_RING.rx} ${POOL_RING.cy}A${POOL_RING.rx} ${POOL_RING.ry} 0 0 0 ${POOL_RING.cx + POOL_RING.rx} ${POOL_RING.cy}`;

/** Points along a cubic Bézier at n + 1 even parameter steps. */
export function cubicPoints(
  p0: PoolPt,
  p1: PoolPt,
  p2: PoolPt,
  p3: PoolPt,
  n: number
): PoolPt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return [
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ] as const;
  });
}

/** A cubic Bézier as path commands. */
export function cubicPath(
  c: readonly [PoolPt, PoolPt, PoolPt, PoolPt]
): string {
  const [a, b, d, e] = c;
  return `M${a[0]} ${a[1]}C${b[0]} ${b[1]} ${d[0]} ${d[1]} ${e[0]} ${e[1]}`;
}

// ─── Small marks ──────────────────────────────────────────────────────────────

/** The logo's diamond (left facet, right facet, rim, glint) centred on (0, 0), `size` units wide and 1.2× tall. */
export function NoteDiamond({ size }: { size: number }) {
  return (
    <g
      transform={`translate(${r1(-size / 2)} ${r1(-size * 0.6)}) scale(${(size / 100).toFixed(4)})`}
    >
      <path d="M50 5L5 60L50 115Z" fill="var(--gold-logo)" />
      <path d="M50 5L95 60L50 115Z" fill="var(--gold-lo)" />
      <path
        d="M50 5L95 60L50 115L5 60Z"
        fill="none"
        stroke="var(--gold-hi)"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        d="M48 15L17 54"
        stroke="#fffaf0"
        strokeOpacity="0.5"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </g>
  );
}

/** A four-point star with concave sides, centred on (0, 0), reaching `r` units. */
export function sparklePath(r: number): string {
  const k = r1(r * 0.15);
  return `M0 ${-r}Q${k} ${-k} ${r} 0Q${k} ${k} 0 ${r}Q${-k} ${k} ${-r} 0Q${-k} ${-k} 0 ${-r}Z`;
}

// ─── The cloud ceiling ────────────────────────────────────────────────────────

export interface CeilingMassProps {
  /** which side of the frame it hangs from; its rounded inner end faces the middle */
  side: "left" | "right";
  seed?: number;
  /** drawing size (default 1300 × 500) */
  width?: number;
  height?: number;
  /** the hanging edge, as a fraction of the height (default 0.78) */
  base?: number;
  /** where the inner end starts to curl up, as a fraction of the width from the outer side (default 0.76) */
  end?: number;
  /** how far past `end` the inner end reaches at the top, as a fraction of the width (default 0.16) */
  reach?: number;
  /** narrowest and widest billow, in drawing units (default 70 … 150) */
  puff?: readonly [number, number];
  /** position and size of the box; the drawing covers it, anchored at its inner end and bottom */
  className?: string;
  style?: CSSProperties;
}

interface Outline {
  /** the billowed edge (open): down the inner end, then along the hanging edge */
  edge: string;
  /** the closed shape, up to the top of the drawing */
  fill: string;
}

/**
 * Outline of a mass hanging from the left: from the top of its inner end, curl
 * down to the hanging edge, then run outwards (left) in billows with a long
 * swell. Consecutive points are joined by circular arcs that bulge outwards.
 * `mirror` flips it into a mass hanging from the right.
 */
function massOutline(
  seed: number,
  o: {
    W: number;
    H: number;
    base: number;
    end: number;
    reach: number;
    minW: number;
    maxW: number;
  },
  mirror: boolean
): Outline {
  const rand = rng(seed);
  const by = o.base * o.H;
  const ex = o.end * o.W;
  const rx = o.reach * o.W;
  // the inner end: a cubic from above the drawing down to the start of the hanging edge
  const top: PoolPt = [ex + rx, -40];
  const curl = cubicPoints(
    top,
    [ex + rx * 1.18, by * 0.4],
    [ex + rx * 0.72, by * 1.05],
    [ex, by + 6],
    64
  );
  const pts: PoolPt[] = [top];
  const step = () => o.minW * 0.75 + rand() * (o.maxW - o.minW) * 0.55;
  let want = step();
  let run = 0;
  for (let i = 1; i < curl.length; i++) {
    run += Math.hypot(curl[i][0] - curl[i - 1][0], curl[i][1] - curl[i - 1][1]);
    if (run >= want || i === curl.length - 1) {
      // never leave a sliver of an arc at the very end
      if (i === curl.length - 1 && run < want * 0.45)
        pts[pts.length - 1] = curl[i];
      else pts.push(curl[i]);
      run = 0;
      want = step();
    }
  }
  // the hanging edge, outwards, rising and falling in long swells
  const phase = rand() * Math.PI * 2;
  let x = ex;
  while (x > -160) {
    x -= o.minW + rand() * (o.maxW - o.minW);
    const swell = Math.sin((x / o.W) * Math.PI * 2.3 + phase) * o.H * 0.04;
    pts.push([x, by + swell + (rand() - 0.5) * o.H * 0.025]);
  }

  const X = (v: number) => r1(mirror ? o.W - v : v);
  // clockwise round the mass (sweep 1) bulges outwards; mirroring reverses the turn
  const sweep = mirror ? 0 : 1;
  let edge = `M${X(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by2] = pts[i];
    const r = (Math.hypot(bx - ax, by2 - ay) / 2) * (1.03 + rand() * 0.28);
    edge += `A${r1(r)} ${r1(r)} 0 0 ${sweep} ${X(bx)} ${r1(by2)}`;
  }
  const last = pts[pts.length - 1];
  const fill = `${edge}L${X(last[0])} -80L${X(top[0])} -80Z`;
  return { edge, fill };
}

/**
 * One mass of the cloud ceiling, seen from below (aria-hidden). A back row of
 * billows hangs a little lower and paler; the front row's billows darken to
 * --wipe-under with a soft halo and a thin rim, and the pool's light warms
 * their undersides near the inner end. The drawing covers its box (slice),
 * anchored at the inner end and the bottom, so the edge sits where the box ends.
 */
export function CeilingMass({
  side,
  seed = 5,
  width = 1300,
  height = 500,
  base = 0.78,
  end = 0.76,
  reach = 0.16,
  puff = [70, 150],
  className,
  style,
}: CeilingMassProps) {
  const id = useId().replace(/:/g, "");
  const mirror = side === "right";
  const [minW, maxW] = puff;
  const { front, back } = useMemo(() => {
    const o = { W: width, H: height, base, end, reach, minW, maxW };
    return {
      back: massOutline(
        seed * 7 + 3,
        { ...o, base: base + 0.07, end: end - 0.035, reach: reach * 0.9 },
        mirror
      ),
      front: massOutline(seed * 13 + 1, o, mirror),
    };
  }, [seed, width, height, base, end, reach, minW, maxW, mirror]);
  const by = base * height;
  // the pool's light catches the billows near the inner end
  const glowX = r1(mirror ? width - end * width : end * width);

  return (
    <div
      aria-hidden
      className={cn("pointer-events-none", className)}
      style={style}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio={mirror ? "xMinYMax slice" : "xMaxYMax slice"}
        className="block h-full w-full overflow-visible"
      >
        <defs>
          <linearGradient
            id={`${id}-front`}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="0"
            y2={r1(by + maxW * 0.55)}
          >
            <stop offset="0" style={{ stopColor: "var(--wipe-deep)" }} />
            <stop
              offset={(
                Math.max(0, by - maxW * 0.5) /
                (by + maxW * 0.55)
              ).toFixed(3)}
              style={{ stopColor: "var(--wipe-deep)" }}
            />
            <stop offset="1" style={{ stopColor: "var(--wipe-under)" }} />
          </linearGradient>
          <linearGradient
            id={`${id}-back`}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="0"
            y2={r1(by + height * 0.07 + maxW * 0.55)}
          >
            <stop offset="0" style={{ stopColor: "var(--wipe-deep)" }} />
            <stop offset="0.7" style={{ stopColor: "var(--wipe-deep)" }} />
            <stop
              offset="1"
              style={{
                stopColor: "color-mix(in srgb, var(--wipe-under) 50%, #4a4f9e)",
              }}
            />
          </linearGradient>
          <radialGradient
            id={`${id}-glow`}
            gradientUnits="userSpaceOnUse"
            cx={glowX}
            cy={r1(by + maxW * 0.3)}
            r={r1(width * 0.42)}
          >
            <stop offset="0" stopColor="#c9b8ff" stopOpacity="0.3" />
            <stop offset="0.35" stopColor="#8b6cf6" stopOpacity="0.14" />
            <stop offset="0.7" stopColor="#f5d58a" stopOpacity="0.04" />
            <stop offset="1" stopColor="#8b6cf6" stopOpacity="0" />
          </radialGradient>
        </defs>

        <path
          d={back.edge}
          fill="none"
          style={{ stroke: "var(--wipe-under)" }}
          strokeOpacity="0.22"
          strokeWidth="9"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path d={back.fill} fill={`url(#${id}-back)`} />
        <path
          d={back.edge}
          fill="none"
          stroke="#dcdcff"
          strokeOpacity="0.16"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />

        <path
          d={front.edge}
          fill="none"
          style={{ stroke: "var(--wipe-under)" }}
          strokeOpacity="0.3"
          strokeWidth="10"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path d={front.fill} fill={`url(#${id}-front)`} />
        <path d={front.fill} fill={`url(#${id}-glow)`} />
        <path
          d={front.edge}
          fill="none"
          stroke="#ecebff"
          strokeOpacity="0.46"
          strokeWidth="1.25"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
