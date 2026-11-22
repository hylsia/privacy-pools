/**
 * The proof drawn as a constellation (sections/ProofScene.tsx): a four-level
 * Merkle tree whose nodes are stars. One beat per statement of the proof:
 *
 *   path   the kit Constellation draws the Merkle path from the pool's root
 *          down through the stars to one gold star — your note; the sibling
 *          star at each level gets a ring as the path passes it
 *   set    a ring closes around the group of leaves your note belongs to
 *          (the association set)
 *   spent  a reticle closes around your note (its nullifier: spent once)
 *   bound  a trail leaves your note for one fixed star (where it may go)
 *   seal   the path turns gold, rings of light open around your note and it
 *          lights the sky around it
 *
 * Three SVGs share one viewBox (1000 × 720, xMidYMid meet), stacked in the
 * box: the ghost tree and the marks behind the path, the kit Constellation,
 * then the marks in front. aria-hidden; motion is opacity, pathLength and the
 * travelling tips' positions only. Text-free, so it can ride a SceneLayer.
 */
import { useId, useMemo } from "react";
import { motion, useTransform, type MotionValue } from "framer-motion";
import { cn } from "@/lib/utils";
import { Constellation, type StarNode } from "./Atmosphere";

export interface ProofBeats {
  /** 0 → 1: the Merkle path, root → your note */
  path: MotionValue<number>;
  /** 0 → 1: the association-set ring */
  set: MotionValue<number>;
  /** 0 → 1: the nullifier reticle around your note */
  spent: MotionValue<number>;
  /** 0 → 1: the trail to the destination star */
  bound: MotionValue<number>;
  /** 0 → 1: sealed (gold path, flare) */
  seal: MotionValue<number>;
}

// ─── Geometry (viewBox 0 0 1000 720) ──────────────────────────────────────────

type P = readonly [number, number];

const VIEW = "0 0 1000 720";
const ROOT: P = [420, 70];
const L1: readonly P[] = [
  [222, 222],
  [618, 206],
];
const L2: readonly P[] = [
  [116, 388],
  [330, 366],
  [530, 396],
  [724, 360],
];
const L3: readonly P[] = [
  [56, 588],
  [160, 616],
  [262, 574],
  [372, 604],
  [474, 580],
  [580, 618],
  [676, 576],
  [786, 606],
];
/** your note: one leaf, and the path from the root down to it */
const NOTE = L3[5];
const PATH: readonly P[] = [ROOT, L1[1], L2[2], NOTE];
/** the sibling at each level (the hashes the path needs), lit as the path reaches its level */
const SIBLINGS: readonly P[] = [L1[0], L2[3], L3[4]];
/** every edge of the tree, drawn faintly */
const EDGES: readonly (readonly [P, P])[] = [
  [ROOT, L1[0]],
  [ROOT, L1[1]],
  ...L2.map((n, i) => [L1[i >> 1], n] as const),
  ...L3.map((n, i) => [L2[i >> 1], n] as const),
];
/** the association set: a ring around the leaves your note sits among */
const SET = { cx: 579, cy: 598, rx: 254, ry: 60 };
/** the trail from your note to the one star it may go to */
const DEST: P = [958, 238];
const TRAIL: readonly [P, P, P, P] = [NOTE, [760, 702], [962, 560], DEST];
const TRAIL_D = `M${TRAIL[0].join(" ")}C${TRAIL[1].join(" ")} ${TRAIL[2].join(" ")} ${TRAIL[3].join(" ")}`;

const STAR_PATH =
  "M12 0C12.9 7.3 16.7 11.1 24 12C16.7 12.9 12.9 16.7 12 24C11.1 16.7 7.3 12.9 0 12C7.3 11.1 11.1 7.3 12 0Z";

const NODES: readonly StarNode[] = [
  { x: ROOT[0], y: ROOT[1], r: 6, tone: "lavender" },
  { x: L1[1][0], y: L1[1][1], r: 4.5, tone: "white" },
  { x: L2[2][0], y: L2[2][1], r: 4.5, tone: "white" },
  { x: NOTE[0], y: NOTE[1], r: 7, tone: "gold" },
];
const LINKS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 2],
  [2, 3],
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const seg = (d: P, e: P) => `M${d[0]} ${d[1]}L${e[0]} ${e[1]}`;

/** Arc-length lookup for the trail, so its travelling tip sits exactly at the drawn end. */
function cubicAt(c: readonly [P, P, P, P]) {
  const pt = (t: number): P => {
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const d = 3 * u * t * t;
    const e = t * t * t;
    return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
  };
  const N = 64;
  const pts = Array.from({ length: N + 1 }, (_, i) => pt(i / N));
  const acc = [0];
  for (let i = 1; i <= N; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = acc[N];
  return (f: number): P => {
    const target = clamp01(f) * total;
    let i = 1;
    while (i < N && acc[i] < target) i++;
    const k = (target - acc[i - 1]) / Math.max(1e-6, acc[i] - acc[i - 1]);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
  };
}
const trailAt = cubicAt(TRAIL);

// ─── Parts ────────────────────────────────────────────────────────────────────

/** The glow under one path segment, drawn in step with the kit's line for that segment. */
function SegmentGlow({ path, i, d }: { path: MotionValue<number>; i: number; d: string }) {
  const n = PATH.length - 1;
  const length = useTransform(path, (v: number) => clamp01((v - i / n) * n));
  const opacity = useTransform(length, (v: number) => (v > 0.001 ? 1 : 0));
  return (
    <motion.path
      d={d}
      fill="none"
      stroke="#aeb4ff"
      strokeOpacity="0.16"
      strokeWidth="9"
      strokeLinecap="butt"
      style={{ pathLength: length, opacity }}
    />
  );
}

/** A ring around the sibling star of level `k`, lit as the path reaches that level. */
function SiblingRing({ path, k, at }: { path: MotionValue<number>; k: number; at: P }) {
  const n = PATH.length - 1;
  const opacity = useTransform(path, (v: number) => clamp01((v - (k + 1) / n + 0.08) * 9));
  return (
    <motion.g style={{ opacity }}>
      <circle cx={at[0]} cy={at[1]} r="15" fill="none" stroke="#c9ccff" strokeOpacity="0.7" strokeWidth="1.6" />
      <circle cx={at[0]} cy={at[1]} r="22" fill="none" stroke="#aeb4ff" strokeOpacity="0.2" strokeWidth="1.2" />
    </motion.g>
  );
}

/** A four-point star that lights on a path node when the line reaches it (the note's is gold and larger). */
function NodeFlare({ path, k, at, gold }: { path: MotionValue<number>; k: number; at: P; gold?: boolean }) {
  const n = PATH.length - 1;
  const opacity = useTransform(path, (v: number) => clamp01((v - k / n + 0.03) * 14));
  const s = gold ? 1.9 : 1.15;
  return (
    <motion.path
      d={STAR_PATH}
      transform={`translate(${at[0] - 12 * s} ${at[1] - 12 * s}) scale(${s})`}
      fill={gold ? "#f5d58a" : "#f4f3ff"}
      fillOpacity={gold ? 1 : 0.9}
      style={{ opacity }}
    />
  );
}

/** Rings of light around your note once the proof is sealed (each one a little later and fainter). */
function SealRipple({ seal, i }: { seal: MotionValue<number>; i: number }) {
  const opacity = useTransform(seal, (v: number) => clamp01((v - i * 0.22) / 0.4) * [0.55, 0.34, 0.2][i]);
  return (
    <motion.circle
      cx={NOTE[0]}
      cy={NOTE[1]}
      r={[58, 96, 140][i]}
      fill="none"
      stroke="#f5d58a"
      strokeWidth="1.3"
      style={{ opacity }}
    />
  );
}

/** The bright tip of a line being drawn (visible only while it travels). */
function Tip({ x, y, show, tone }: { x: MotionValue<number>; y: MotionValue<number>; show: MotionValue<number>; tone: "lavender" | "gold" }) {
  const fill = tone === "gold" ? "#f5d58a" : "#eceaff";
  return (
    <motion.g style={{ opacity: show }}>
      <motion.circle cx={x} cy={y} r="16" fill={fill} fillOpacity="0.14" />
      <motion.circle cx={x} cy={y} r="7" fill={fill} fillOpacity="0.32" />
      <motion.circle cx={x} cy={y} r="3" fill="#ffffff" />
    </motion.g>
  );
}

// ─── Constellation ────────────────────────────────────────────────────────────

export interface ProofConstellationProps {
  beats: ProofBeats;
  /** box (the drawing keeps its aspect and centres in it) */
  className?: string;
}

export function ProofConstellation({ beats, className }: ProofConstellationProps) {
  const id = useId().replace(/:/g, "");
  const { path, set, spent, bound, seal } = beats;
  const n = PATH.length - 1;

  // the Merkle path's travelling tip
  const tipX = useTransform(path, (v: number) => {
    const s = Math.min(n - 1, Math.floor(v * n));
    const k = clamp01(v * n - s);
    return PATH[s][0] + (PATH[s + 1][0] - PATH[s][0]) * k;
  });
  const tipY = useTransform(path, (v: number) => {
    const s = Math.min(n - 1, Math.floor(v * n));
    const k = clamp01(v * n - s);
    return PATH[s][1] + (PATH[s + 1][1] - PATH[s][1]) * k;
  });
  const tipShow = useTransform(path, (v: number) => Math.min(clamp01(v * 30), clamp01((1 - v) * 18)));

  // the association set
  const setFill = useTransform(set, (v: number) => clamp01((v - 0.35) * 1.6));
  const setLine = useTransform(set, (v: number) => (v > 0.001 ? 1 : 0));

  // the nullifier reticle
  const ticks = useTransform(spent, (v: number) => clamp01((v - 0.6) * 2.5));
  const reticleLine = useTransform(spent, (v: number) => (v > 0.001 ? 1 : 0));

  // the trail and its tip
  const trailX = useTransform(bound, (v: number) => trailAt(v)[0]);
  const trailY = useTransform(bound, (v: number) => trailAt(v)[1]);
  const trailShow = useTransform(bound, (v: number) => Math.min(clamp01(v * 30), clamp01((1 - v) * 14)));
  const trailLine = useTransform(bound, (v: number) => (v > 0.001 ? 1 : 0));
  const destLit = useTransform(bound, (v: number) => clamp01((v - 0.86) * 7));

  // your note flares when its path arrives, and fully when the proof is sealed
  const flare = useTransform([path, seal], ([a, b]: number[]) => Math.max(clamp01((a - 0.9) * 10) * 0.5, b));
  const sealed = useTransform(seal, (v: number) => v * 0.9);

  const ghosts = useMemo(() => [ROOT, ...L1, ...L2, ...L3], []);
  const svg = "absolute inset-0 h-full w-full overflow-visible";

  return (
    <div aria-hidden className={cn("pointer-events-none relative", className)}>
      {/* behind the path: the faint tree, its stars, the set, the glow under the path, sibling rings */}
      <svg viewBox={VIEW} preserveAspectRatio="xMidYMid meet" className={svg}>
        <defs>
          <radialGradient id={`${id}-star`}>
            <stop offset="0" stopColor="#eceaff" stopOpacity="0.5" />
            <stop offset="0.4" stopColor="#aeb4ff" stopOpacity="0.14" />
            <stop offset="1" stopColor="#aeb4ff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-set`}>
            <stop offset="0" stopColor="#aeb4ff" stopOpacity="0.16" />
            <stop offset="0.7" stopColor="#8b6cf6" stopOpacity="0.08" />
            <stop offset="1" stopColor="#8b6cf6" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-warm`}>
            <stop offset="0" stopColor="#f5d58a" stopOpacity="0.2" />
            <stop offset="0.4" stopColor="#d4ac4e" stopOpacity="0.08" />
            <stop offset="1" stopColor="#8b6cf6" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-flare`}>
            <stop offset="0" stopColor="#f5d58a" stopOpacity="0.5" />
            <stop offset="0.3" stopColor="#d4ac4e" stopOpacity="0.2" />
            <stop offset="1" stopColor="#d4ac4e" stopOpacity="0" />
          </radialGradient>
        </defs>

        <g stroke="#aeb4ff" strokeOpacity="0.17" strokeWidth="1" fill="none">
          {EDGES.map(([a, b]) => (
            <path key={`${a.join()}-${b.join()}`} d={seg(a, b)} vectorEffect="non-scaling-stroke" />
          ))}
        </g>

        {/* the association set: soft light inside, then its ring */}
        <motion.ellipse cx={SET.cx} cy={SET.cy} rx={SET.rx + 26} ry={SET.ry + 22} fill={`url(#${id}-set)`} style={{ opacity: setFill }} />
        <motion.ellipse
          cx={SET.cx}
          cy={SET.cy}
          rx={SET.rx}
          ry={SET.ry}
          fill="none"
          stroke="#c9ccff"
          strokeOpacity="0.62"
          strokeWidth="1.6"
          transform={`rotate(180 ${SET.cx} ${SET.cy})`}
          style={{ pathLength: set, opacity: setLine }}
        />
        {/* a fainter outer orbit, closing in step */}
        <motion.ellipse
          cx={SET.cx}
          cy={SET.cy}
          rx={SET.rx + 18}
          ry={SET.ry + 12}
          fill="none"
          stroke="#aeb4ff"
          strokeOpacity="0.22"
          strokeWidth="1.2"
          style={{ pathLength: set, opacity: setLine }}
        />

        {/* every star of the tree, before any of it is lit */}
        {ghosts.map(([x, y]) => (
          <g key={`${x}-${y}`}>
            <circle cx={x} cy={y} r="13" fill={`url(#${id}-star)`} />
            <circle cx={x} cy={y} r="2.6" fill="#dfe1ff" fillOpacity="0.85" />
          </g>
        ))}
        {/* the root: the pool's state, a brighter four-point star in a soft halo */}
        <circle cx={ROOT[0]} cy={ROOT[1]} r="46" fill={`url(#${id}-star)`} />
        <circle cx={ROOT[0]} cy={ROOT[1]} r="27" fill="none" stroke="#aeb4ff" strokeOpacity="0.16" strokeWidth="1.2" />
        <path d={STAR_PATH} transform={`translate(${ROOT[0] - 18} ${ROOT[1] - 18}) scale(1.5)`} fill="#dfe1ff" fillOpacity="0.85" />

        {/* sealed: your note lights the sky around it */}
        <motion.circle cx={NOTE[0]} cy={NOTE[1]} r="330" fill={`url(#${id}-warm)`} style={{ opacity: seal }} />
        <motion.circle cx={NOTE[0]} cy={NOTE[1]} r="132" fill={`url(#${id}-flare)`} style={{ opacity: flare }} />

        {PATH.slice(0, -1).map((a, i) => (
          <SegmentGlow key={i} path={path} i={i} d={seg(a, PATH[i + 1])} />
        ))}
        {SIBLINGS.map((at, k) => (
          <SiblingRing key={k} path={path} k={k} at={at} />
        ))}
      </svg>

      {/* the Merkle path (scene kit) */}
      <Constellation
        nodes={NODES}
        links={LINKS}
        draw={path}
        viewBox={VIEW}
        preserveAspectRatio="xMidYMid meet"
        stroke="#dfe1ff"
        className={svg}
      />

      {/* in front: the reticle, the trail, the destination, the sealed gold path, the travelling tips */}
      <svg viewBox={VIEW} preserveAspectRatio="xMidYMid meet" className={svg}>
        <defs>
          <linearGradient id={`${id}-trail`} gradientUnits="userSpaceOnUse" x1={NOTE[0]} y1={NOTE[1]} x2={DEST[0]} y2={DEST[1]}>
            <stop offset="0" stopColor="#f5d58a" />
            <stop offset="1" stopColor="#eceaff" />
          </linearGradient>
          <radialGradient id={`${id}-dest`}>
            <stop offset="0" stopColor="#f4f3ff" stopOpacity="0.55" />
            <stop offset="0.35" stopColor="#c9ccff" stopOpacity="0.18" />
            <stop offset="1" stopColor="#c9ccff" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* nullifier: a reticle closes around your note */}
        <motion.circle
          cx={NOTE[0]}
          cy={NOTE[1]}
          r="30"
          fill="none"
          stroke="#f5d58a"
          strokeOpacity="0.9"
          strokeWidth="1.8"
          transform={`rotate(-90 ${NOTE[0]} ${NOTE[1]})`}
          style={{ pathLength: spent, opacity: reticleLine }}
        />
        <motion.g style={{ opacity: ticks }} stroke="#f5d58a" strokeOpacity="0.85" strokeWidth="1.8" strokeLinecap="round">
          <path d={`M${NOTE[0]} ${NOTE[1] - 38}V${NOTE[1] - 47}`} />
          <path d={`M${NOTE[0]} ${NOTE[1] + 38}V${NOTE[1] + 47}`} />
          <path d={`M${NOTE[0] - 38} ${NOTE[1]}H${NOTE[0] - 47}`} />
          <path d={`M${NOTE[0] + 38} ${NOTE[1]}H${NOTE[0] + 47}`} />
        </motion.g>

        {/* the destination: a faint star until the trail reaches it */}
        <circle cx={DEST[0]} cy={DEST[1]} r="2.6" fill="#dfe1ff" fillOpacity="0.6" />
        <motion.g style={{ opacity: destLit }}>
          <circle cx={DEST[0]} cy={DEST[1]} r="44" fill={`url(#${id}-dest)`} />
          <path d={STAR_PATH} transform={`translate(${DEST[0] - 16} ${DEST[1] - 16}) scale(1.333)`} fill="#f4f3ff" />
          <circle cx={DEST[0]} cy={DEST[1]} r="25" fill="none" stroke="#c9ccff" strokeOpacity="0.45" strokeWidth="1.4" />
        </motion.g>

        {/* the trail (with a soft glow under it) */}
        <motion.path
          d={TRAIL_D}
          fill="none"
          stroke="#f5d58a"
          strokeOpacity="0.16"
          strokeWidth="9"
          style={{ pathLength: bound, opacity: trailLine }}
        />
        <motion.path
          d={TRAIL_D}
          fill="none"
          stroke={`url(#${id}-trail)`}
          strokeOpacity="0.85"
          strokeWidth="2"
          style={{ pathLength: bound, opacity: trailLine }}
        />

        {/* sealed: the path and the trail turn gold */}
        <motion.g style={{ opacity: sealed }} fill="none" stroke="#f5d58a" strokeWidth="2.2" strokeLinecap="round">
          {PATH.slice(0, -1).map((a, i) => (
            <path key={i} d={seg(a, PATH[i + 1])} />
          ))}
        </motion.g>

        {[0, 1, 2].map((i) => (
          <SealRipple key={i} seal={seal} i={i} />
        ))}
        <NodeFlare path={path} k={1} at={PATH[1]} />
        <NodeFlare path={path} k={2} at={PATH[2]} />
        <NodeFlare path={path} k={3} at={NOTE} gold />

        <Tip x={tipX} y={tipY} show={tipShow} tone="lavender" />
        <Tip x={trailX} y={trailY} show={trailShow} tone="gold" />
      </svg>
    </div>
  );
}
