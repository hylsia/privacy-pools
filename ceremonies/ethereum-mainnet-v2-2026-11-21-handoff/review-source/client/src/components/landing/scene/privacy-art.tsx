/**
 * Art for "What stays private" (#privacy), the fog scene of the night journey:
 * a moonlit pass where two public beacons face each other across a gorge. A
 * dotted gold line joins them; as the scene scrolls up, fog rolls into the
 * gorge from both sides and swallows the middle of the line, so only its two
 * public ends stay in sight. Below the pass lies a moonlit sea of cloud.
 *
 * Two pieces, both aria-hidden:
 *
 *   PrivacyBackdrop  the stage's depth layers (sky · far · mid). In a
 *                    pass-through stage they barely move on screen, so they are
 *                    placed in screen terms at mid-pass:
 *                    top = calc(50% − 50vh + <screen y>).
 *   PrivacyValley    the foreground, drawn in the figure strip's own pixel
 *                    space (measured, so the beacons sit exactly on their
 *                    summits at every width): the cliffs and towers, the dotted
 *                    link, the lamps, two fog groups that slide sideways in
 *                    opposite directions, and the cloud sea with mist lying on
 *                    it. It scrolls with the page, like the copy in front of
 *                    it; only its fog slides (x), the sea drifts (x) and the
 *                    link's dots fade (opacity). No filters anywhere: soft
 *                    light and fog are radial gradients.
 *
 * Layer budget (measured with perf.mjs, A/B): the scene adds about 12
 * compositing layers while on screen (3 depth layers + the star twinkle, 3
 * sliding groups, the static art run between them, and one merged layer for
 * all the copy) and none while out of view (OFF_WILL_CHANGE). Keep static
 * paint in one run between moving layers, keep haze boxes inside their plane's
 * overhang (Haze), and avoid clipped decorations in the copy.
 */
import { useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { motion, useTransform, type MotionValue } from "framer-motion";
import { useRange } from "@/components/landing/parallax";
import {
  CloudWall,
  FogBand,
  Moon,
  NightSky,
  Ridge,
  SceneLayer,
  Starfield,
  Vignette,
  type CloudBand,
  type FogBandSpec,
} from "@/components/landing/scene";
import { cn } from "@/lib/utils";

export type PrivacyTier = "wide" | "tablet" | "phone";

/**
 * Strip progress ("through": 0 as its top enters the viewport, 1 as its bottom
 * leaves) at which the fog has closed over the link. The fog groups sit at
 * their resting place here; reduced motion shows this frame.
 */
export const PRIVACY_FOG_CLOSED = 0.52;
/**
 * The link starts to fade at this strip progress (when the fog's leading edges
 * reach the middle of the gorge) and is gone, in the middle, at PRIVACY_FOG_CLOSED.
 */
const HIDE_FROM = 0.3;
/** Half the link's length that the fog hides in the end (0.3: the middle 60%). */
const HOLE = 0.3;

type Pt = readonly [number, number];

interface ValleySpec {
  /** ridge line: x as a fraction of the strip width (runs past 0 and 1, to the stage edges), y of its height */
  ridge: readonly Pt[];
  /** indexes in `ridge` of the two summits that carry the beacons */
  peaks: readonly [number, number];
  /** beacon tower height, as a fraction of the strip height */
  tower: number;
  /** lowest point of the link (fractions) */
  sag: Pt;
  /** centre of the fog label, as a fraction of the strip height */
  label: number;
  /** top of the cloud sea, as a fraction of the strip height */
  sea: number;
  /** spacing of the link's dots (px) and their radius */
  dot: number;
  dotR: number;
  /** lamp halo radius (px) */
  halo: number;
  /** light shafts above the lamps, as a fraction of the strip height (0: none) */
  shaft: number;
  /** tower half-widths (base, top), px */
  towerW: readonly [number, number];
}

/** Wide: the cards stand beside their beacons ([card][beacon] gorge [beacon][card]). */
const WIDE: ValleySpec = {
  ridge: [
    [-0.95, 0.66], [-0.8, 0.56], [-0.68, 0.63], [-0.54, 0.53], [-0.42, 0.61], [-0.28, 0.5], [-0.16, 0.58],
    [-0.05, 0.48], [0.05, 0.56], [0.14, 0.465], [0.205, 0.515], [0.265, 0.425], [0.305, 0.38],
    [0.34, 0.41], [0.37, 0.5], [0.4, 0.62], [0.435, 0.72], [0.468, 0.78], [0.5, 0.8],
    [0.532, 0.785], [0.565, 0.73], [0.598, 0.62], [0.632, 0.5], [0.664, 0.43], [0.695, 0.4],
    [0.732, 0.43], [0.79, 0.5], [0.855, 0.455], [0.93, 0.535], [1.03, 0.48], [1.13, 0.57],
    [1.25, 0.505], [1.37, 0.595], [1.5, 0.53], [1.64, 0.625], [1.78, 0.56], [1.95, 0.66],
  ],
  peaks: [12, 24],
  tower: 0.13,
  sag: [0.5, 0.5],
  label: 0.6,
  sea: 0.52,
  dot: 11,
  dotR: 1.9,
  halo: 120,
  shaft: 0.3,
  towerW: [9.5, 3.4],
};

/** Tablets and phones: the cards sit side by side above the strip, the beacons below them. */
const STACKED_RIDGE: readonly Pt[] = [
  [-0.95, 0.62], [-0.78, 0.52], [-0.64, 0.6], [-0.48, 0.48], [-0.34, 0.57], [-0.2, 0.46],
  [-0.08, 0.54], [0.04, 0.45], [0.12, 0.5], [0.2, 0.41], [0.255, 0.37], [0.3, 0.33],
  [0.338, 0.37], [0.372, 0.5], [0.41, 0.66], [0.455, 0.78], [0.5, 0.82],
  [0.545, 0.79], [0.59, 0.67], [0.628, 0.5], [0.664, 0.39], [0.7, 0.35],
  [0.745, 0.395], [0.8, 0.46], [0.88, 0.42], [0.96, 0.5], [1.06, 0.44], [1.18, 0.53],
  [1.32, 0.46], [1.48, 0.56], [1.66, 0.49], [1.95, 0.6],
];

const TABLET: ValleySpec = {
  ridge: STACKED_RIDGE,
  peaks: [11, 21],
  tower: 0.15,
  sag: [0.5, 0.48],
  label: 0.63,
  sea: 0.64,
  dot: 10,
  dotR: 1.7,
  halo: 88,
  shaft: 0,
  towerW: [7.5, 2.8],
};

const PHONE: ValleySpec = { ...TABLET, dot: 9, dotR: 1.6, halo: 66, towerW: [6.5, 2.5] };

export const PRIVACY_VALLEY: Record<PrivacyTier, ValleySpec> = { wide: WIDE, tablet: TABLET, phone: PHONE };

/** A beacon's lamp, as fractions of the strip (side 0: deposit, left; 1: withdrawal, right). */
export function privacyLamp(tier: PrivacyTier, side: 0 | 1): Pt {
  const s = PRIVACY_VALLEY[tier];
  const p = s.ridge[s.peaks[side]];
  return [p[0], p[1] - s.tower];
}

// ─── Backdrop (stage-level depth layers) ──────────────────────────────────────

/**
 * Off-screen rest for the stage's moving art. Visibility.tsx sets `data-off`
 * on the stage while it is out of view (scrolled past, with at most its bottom
 * night blend still showing, or more than a third of a screen below). The
 * planes then drop will-change and the star twinkle rests, so the scene keeps
 * no compositing layers while a neighbour fills the screen. Nothing visible
 * changes: no stars or loops sit in that last strip, the planes still follow
 * the scroll (only without their own layers), and a stopped twinkle out of
 * view shows its first frame when it wakes.
 */
const OFF_WILL_CHANGE = "[[data-off]_&]:will-change-auto";
/** The twinkle is unlayered CSS (sky.css), so its override needs `!`. */
const OFF_TWINKLE = "[[data-off]_&_.sky-stars-layer]:[animation:none]!";

/**
 * A kit fog band (same colours and falloff: the closest-side ellipse of a box
 * `left`/`width` wide, in % of the plane) drawn in a box that stops at the
 * plane's 32px overhang. The kit's default box runs 30% past both sides of
 * the stage; that part is clipped anyway, but it widened the planes and cost
 * the page 2 more compositing layers while the scene is on screen (measured).
 * Same ellipse, so nothing on screen changes (the cut edges sit off-screen,
 * beyond any pointer shift).
 */
function Haze({
  top,
  height,
  left = -30,
  width = 160,
  alpha = 0.1,
  tone = "lavender",
}: {
  top: string;
  height: string;
  /** the ellipse's box, in % of the plane (the kit's defaults: -30 / 160) */
  left?: number;
  width?: number;
  alpha?: number;
  tone?: "lavender" | "mist";
}) {
  const c = tone === "mist" ? "201 204 255" : "174 180 255";
  // the box is the plane plus 32px each side, so the plane's width is (100% - 64px)
  const rx = `calc((100% - 64px) * ${(width / 200).toFixed(4)})`;
  const cx = `calc(32px + (100% - 64px) * ${((left + width / 2) / 100).toFixed(4)})`;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -inset-x-8"
      style={{
        top,
        height,
        background: `radial-gradient(${rx} 50% at ${cx} 50%, rgb(${c} / ${alpha}), rgb(${c} / ${+(alpha * 0.4).toFixed(4)}) 55%, transparent 100%)`,
      }}
    />
  );
}

/** Haze between the ranges, seen through the gorge (mid depth). */
const BACK_FOG = [
  { top: "calc(50% + 16vh)", height: "18vh", left: 8, width: 84, alpha: 0.12 },
  { top: "calc(50% + 24vh)", height: "14vh", left: -10, width: 70, alpha: 0.09, tone: "mist" },
] as const;

/**
 * The sky, the moon, the far and mid ranges and their haze. Each sits in
 * its depth layer; at mid-pass the far crest is ~48% down the screen and the
 * mid crest ~55%, so both rise behind the beacons and show through the gorge
 * while they are in view, then sink behind the cliffs as the scene moves on.
 *
 * `still` (reduced motion): the layers rest at mid-pass, so on a tall stage
 * (phones, ~190vh) the sky box would start below the stage's top and leave a
 * hard edge. There it is anchored at both ends (it reaches the stage's top),
 * and its top starts from the page's night (--night-1, where the proof scene
 * ends) instead of night-0, as the moving sky looks at that point.
 */
export function PrivacyBackdrop({ tier, still = false }: { tier: PrivacyTier; still?: boolean }) {
  const wide = tier === "wide";
  const phone = tier === "phone";
  return (
    <>
      {/* sky: night gradient, vignette, stars. The twinkling star group is painted last, so nothing else needs a layer above it */}
      <SceneLayer depth="sky" className={cn(OFF_WILL_CHANGE, OFF_TWINKLE)}>
        <div
          className={cn(
            "absolute -inset-x-8",
            still ? "bottom-[calc(50%-50vh)] top-[min(0px,calc(50%-85vh))]" : "top-[calc(50%-85vh)] h-[135vh]",
          )}
        >
          <NightSky variant="horizon">
            {/* the gradient is night-0 → night-1 over its top 30%: fade that part from night-1 */}
            {still && (
              <div className="absolute inset-x-0 top-0 h-[30%] bg-[linear-gradient(to_bottom,var(--night-1),rgb(10_12_42/0))]" />
            )}
          </NightSky>
        </div>
        {/* the horizon colour continues below the gradient, so the sky never shows an edge */}
        <div className="absolute -inset-x-8 top-[calc(50%+49vh)] h-[90vh] bg-[#343c86]" />
        {/* the sky barely moves on screen, so its vignette works as the screen's */}
        <div className="absolute inset-x-0 top-[calc(50%-50vh)] h-screen">
          <Vignette strength={0.5} />
        </div>
        <Starfield
          count={phone ? 80 : 150}
          seed={23}
          twinkle="one"
          className="absolute -inset-x-4 top-[calc(50%-84vh)] h-[92vh]"
        />
      </SceneLayer>

      {/* far: sparse brighter stars, the crescent moon (clear of the copy), the far range and its haze */}
      <SceneLayer depth="far" className={OFF_WILL_CHANGE}>
        {!phone && (
          <Starfield
            count={40}
            seed={8}
            twinkle="none"
            className="absolute -inset-x-4 top-[calc(50%-80vh)] h-[70vh] opacity-80"
          />
        )}
        {!phone && (
          <Moon
            phase="crescent"
            seed={5}
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2",
              wide
                ? "left-[9%] top-[calc(50%-35vh)] w-[16vw] max-w-[300px]"
                : "left-[88%] top-[calc(50%-33vh)] w-[24vw]",
            )}
          />
        )}
        <Ridge
          tier={0}
          seed={12}
          rim="left"
          rimAt={0.16}
          edgeHeight={phone ? "18vh" : "26vh"}
          className="absolute -inset-x-8 bottom-0 top-[calc(50%-2vh)]"
        />
        <Haze top="calc(50% + 9vh)" height="16vh" alpha={0.12} />
      </SceneLayer>

      {/* mid: the nearer range, and haze between the ranges that shows through the gorge */}
      <SceneLayer depth="mid" className={OFF_WILL_CHANGE}>
        <Ridge
          tier={1}
          seed={5}
          rim="left"
          rimAt={0.24}
          edgeHeight={phone ? "16vh" : "22vh"}
          className="absolute -inset-x-8 bottom-0 top-[calc(50%+5vh)]"
        />
        <Haze top="calc(50% + 15vh)" height="14vh" alpha={0.1} tone="mist" />
        {BACK_FOG.map((b, i) => (
          <Haze key={i} {...b} />
        ))}
      </SceneLayer>
    </>
  );
}

// ─── Valley (static foreground in the strip's pixel space) ───────────────────

interface Box {
  w: number;
  h: number;
  vw: number;
  vh: number;
}

/** Size of the strip and of the viewport; updates on resize only (never on scroll). */
function useBox(ref: RefObject<HTMLElement | null>): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const next = { w: el.offsetWidth, h: el.offsetHeight, vw: window.innerWidth, vh: window.innerHeight };
      setBox((b) => (b && b.w === next.w && b.h === next.h && b.vw === next.vw && b.vh === next.vh ? b : next));
    };
    read();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    ro?.observe(el);
    window.addEventListener("resize", read);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", read);
    };
  }, [ref]);
  return box;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Catmull-Rom through every point as cubic Béziers: segment i runs from point i to i + 1. */
function segments(pts: readonly Pt[], tension = 0.85): string[] {
  const out: string[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension;
    out.push(`C${r1(c1x)} ${r1(c1y)} ${r1(c2x)} ${r1(c2y)} ${r1(p2[0])} ${r1(p2[1])}`);
  }
  return out;
}

interface Face {
  edge: string;
  face: string;
  top: number;
  foot: number;
  /** brightness: 1 next to the moon (upper left) and on the beacon summits, less far from it */
  k: number;
}

/** Ridge silhouette, moonlit faces (slopes climbing to a summit from the left), beacon summits. */
function cliffShapes(spec: ValleySpec, box: Box) {
  const { w, h, vw, vh } = box;
  const P = spec.ridge.map(([u, v]) => [u * w, v * h] as Pt);
  const segs = segments(P);
  const crest = `M${r1(P[0][0])} ${r1(P[0][1])}${segs.join("")}`;
  const bottom = h + vh * 1.9;
  const fill = `${crest}L${r1(P[P.length - 1][0])} ${r1(bottom)}L${r1(P[0][0])} ${r1(bottom)}Z`;
  const beacons = new Set<number>(spec.peaks);
  const offset = (vw - w) / 2;
  const faces: Face[] = [];
  for (let k = 1; k < P.length - 1; k++) {
    // a summit: higher (smaller y) than both neighbours
    if (!(P[k][1] < P[k - 1][1] && P[k][1] <= P[k + 1][1])) continue;
    let j = k - 1;
    while (j > 0 && P[j - 1][1] > P[j][1]) j--;
    const S = P[k];
    const V = P[j];
    const foot = Math.max(S[1], V[1]) + h * 0.22;
    const spineX = S[0] - (S[0] - V[0]) * 0.22;
    const edge = `M${r1(V[0])} ${r1(V[1])}${segs.slice(j, k).join("")}`;
    const face = `${edge}Q${r1(spineX)} ${r1(S[1] + (foot - S[1]) * 0.45)} ${r1(spineX - (S[0] - V[0]) * 0.1)} ${r1(foot)}L${r1(V[0])} ${r1(foot)}Z`;
    const screen = Math.min(1, Math.max(0, (S[0] + offset) / vw));
    faces.push({ edge, face, top: S[1], foot, k: beacons.has(k) ? 1 : 1 - screen * 0.5 });
  }
  const summits = spec.peaks.map((i) => P[i]);
  const top = Math.min(...P.map((p) => p[1]));
  return { crest, fill, faces, summits, top };
}

/** The cliffs, their moonlit faces and rim, the light pooled round each beacon, and the two towers. */
function Cliffs({ spec, box }: { spec: ValleySpec; box: Box }) {
  const id = useId().replace(/:/g, "");
  const s = useMemo(() => cliffShapes(spec, box), [spec, box]);
  const { w, h } = box;
  const t = spec.tower * h;
  const [bw, tw] = spec.towerW;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="absolute left-0 top-0 overflow-visible">
      <defs>
        {/* the nearest rock: darker than every range behind it */}
        <linearGradient id={`${id}-rock`} gradientUnits="userSpaceOnUse" x1="0" y1={s.top} x2="0" y2={h * 1.3}>
          <stop offset="0" stopColor="#151a52" />
          <stop offset="0.16" stopColor="#0f1345" />
          <stop offset="0.5" stopColor="#0a0d37" />
          <stop offset="1" stopColor="#070923" />
        </linearGradient>
        {/* fog pooled in the gorge, lit from above */}
        <radialGradient id={`${id}-pooled`}>
          <stop offset="0" stopColor="#c9ccff" stopOpacity="0.3" />
          <stop offset="0.5" stopColor="#aeb4ff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#aeb4ff" stopOpacity="0" />
        </radialGradient>
        {s.faces.map((f, i) => (
          <linearGradient key={i} id={`${id}-f${i}`} gradientUnits="userSpaceOnUse" x1="0" y1={f.top} x2="0" y2={f.foot}>
            <stop offset="0" stopColor="#d9dbff" stopOpacity={(0.3 * f.k).toFixed(3)} />
            <stop offset="0.45" stopColor="#aeb4ff" stopOpacity={(0.11 * f.k).toFixed(3)} />
            <stop offset="1" stopColor="#aeb4ff" stopOpacity="0" />
          </linearGradient>
        ))}
        <radialGradient id={`${id}-pool`}>
          <stop offset="0" stopColor="#e4e5ff" stopOpacity="0.4" />
          <stop offset="0.32" stopColor="#aeb4ff" stopOpacity="0.15" />
          <stop offset="1" stopColor="#8b6cf6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-tower`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3a4092" />
          <stop offset="0.45" stopColor="#1b205c" />
          <stop offset="1" stopColor="#0b0e36" />
        </linearGradient>
        <clipPath id={`${id}-clip`}>
          <path d={s.fill} />
        </clipPath>
      </defs>

      <path d={s.fill} fill={`url(#${id}-rock)`} />
      <g clipPath={`url(#${id}-clip)`}>
        {s.faces.map((f, i) => (
          <path key={i} d={f.face} fill={`url(#${id}-f${i})`} />
        ))}
        {/* the beacons light the rock round their summits and down into the gorge */}
        {s.summits.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1] - t * 0.4} r={h * 0.38} fill={`url(#${id}-pool)`} />
        ))}
      </g>
      <path d={s.crest} fill="none" stroke="#c9ccff" strokeOpacity="0.22" strokeWidth="1" />
      <ellipse cx={w * 0.5} cy={h * (spec.label + 0.06)} rx={w * 0.21} ry={h * 0.22} fill={`url(#${id}-pooled)`} />
      {s.faces.map((f, i) => (
        <path
          key={i}
          d={f.edge}
          fill="none"
          stroke="#eceaff"
          strokeOpacity={(0.55 * f.k).toFixed(3)}
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      ))}

      {/* towers: a tapered stone post with a cradle for the lamp */}
      {s.summits.map(([x, y], i) => {
        const top = y - t + 9;
        return (
          <g key={i}>
            <path
              d={`M${r1(x - bw)} ${r1(y + 10)}L${r1(x - tw)} ${r1(top)}L${r1(x + tw)} ${r1(top)}L${r1(x + bw)} ${r1(y + 10)}Z`}
              fill={`url(#${id}-tower)`}
            />
            <path
              d={`M${r1(x - bw)} ${r1(y + 6)}L${r1(x - tw)} ${r1(top)}`}
              stroke="#c9ccff"
              strokeOpacity="0.45"
              strokeWidth="1"
            />
            <path
              d={`M${r1(x - tw * 3)} ${r1(top - 3)}Q${r1(x)} ${r1(top + 5)} ${r1(x + tw * 3)} ${r1(top - 3)}`}
              fill="none"
              stroke="#8d92e0"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </g>
        );
      })}
    </svg>
  );
}

/** The artwork's four-point sparkle in a 24-unit box (same shape as the kit's sparkles). */
const STAR =
  "M12 0C12.9 7.3 16.7 11.1 24 12C16.7 12.9 12.9 16.7 12 24C11.1 16.7 7.3 12.9 0 12C7.3 11.1 11.1 7.3 12 0Z";

/** Lamp centres in strip pixels. */
function lampsPx(spec: ValleySpec, box: Box): Pt[] {
  return spec.peaks.map((i) => {
    const [u, v] = spec.ridge[i];
    return [u * box.w, (v - spec.tower) * box.h] as Pt;
  });
}

interface Dot {
  x: number;
  y: number;
  /** distance from the middle of the link, 0 … 0.5 (by length) */
  d: number;
}

/** Dots along the link: a curve from lamp to lamp that sags into the gorge, spaced evenly by length. */
function linkDots(spec: ValleySpec, box: Box): Dot[] {
  const [l, r] = lampsPx(spec, box);
  const gap = spec.halo * 0.2;
  const P0: Pt = [l[0] + gap, l[1] + gap * 0.35];
  const P2: Pt = [r[0] - gap, r[1] + gap * 0.35];
  const S: Pt = [spec.sag[0] * box.w, spec.sag[1] * box.h];
  // a quadratic through S at t = 0.5
  const C: Pt = [2 * S[0] - (P0[0] + P2[0]) / 2, 2 * S[1] - (P0[1] + P2[1]) / 2];
  const at = (t: number): Pt => {
    const a = (1 - t) * (1 - t);
    const b = 2 * t * (1 - t);
    const c = t * t;
    return [a * P0[0] + b * C[0] + c * P2[0], a * P0[1] + b * C[1] + c * P2[1]];
  };
  const N = 240;
  const pts: Pt[] = [P0];
  const acc = [0];
  for (let i = 1; i <= N; i++) {
    const p = at(i / N);
    const q = pts[i - 1];
    acc.push(acc[i - 1] + Math.hypot(p[0] - q[0], p[1] - q[1]));
    pts.push(p);
  }
  const len = acc[N];
  const n = Math.max(8, Math.round(len / spec.dot));
  const dots: Dot[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const target = (k / n) * len;
    while (j < N && acc[j + 1] < target) j++;
    const seg = acc[j + 1] - acc[j] || 1;
    const f = Math.min(1, Math.max(0, (target - acc[j]) / seg));
    const p = pts[j];
    const q = pts[Math.min(N, j + 1)];
    dots.push({ x: p[0] + (q[0] - p[0]) * f, y: p[1] + (q[1] - p[1]) * f, d: Math.abs(k / n - 0.5) });
  }
  return dots;
}

/** One dot of the link: it fades as the fog's hole (from the middle outwards) reaches it. */
function LinkDot({ x, y, d, r, hide }: Dot & { r: number; hide: MotionValue<number> }) {
  const opacity = useTransform(hide, (v: number) => {
    const soft = 0.12;
    const edge = -soft + v * (HOLE + soft);
    return Math.min(1, Math.max(0, (d - edge) / soft));
  });
  return (
    <motion.g style={{ opacity }}>
      <circle cx={r1(x)} cy={r1(y)} r={r * 2.6} fill="#d4ac4e" fillOpacity="0.2" />
      <circle cx={r1(x)} cy={r1(y)} r={r} fill="#f5d58a" />
    </motion.g>
  );
}

function LinkDots({ spec, box, hide }: { spec: ValleySpec; box: Box; hide: MotionValue<number> }) {
  const id = useId().replace(/:/g, "");
  const dots = useMemo(() => linkDots(spec, box), [spec, box]);
  // as the dots go, their light lingers in the fog: something passed, not where
  const glow = useTransform(hide, (v: number) => v * 0.85);
  return (
    <svg width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} className="absolute left-0 top-0 overflow-visible">
      <defs>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" stopColor="#f5d58a" stopOpacity="0.26" />
          <stop offset="0.45" stopColor="#d4ac4e" stopOpacity="0.09" />
          <stop offset="1" stopColor="#d4ac4e" stopOpacity="0" />
        </radialGradient>
      </defs>
      <motion.ellipse
        cx={r1(spec.sag[0] * box.w)}
        cy={r1(spec.sag[1] * box.h - box.h * 0.03)}
        rx={r1(box.w * 0.15)}
        ry={r1(box.h * 0.1)}
        fill={`url(#${id}-glow)`}
        style={{ opacity: glow }}
      />
      {dots.map((dot, i) => (
        <LinkDot key={i} {...dot} r={spec.dotR} hide={hide} />
      ))}
    </svg>
  );
}

/**
 * The beacons' light: a halo, a flare and a bright core per lamp, a short
 * light shaft above each (wide), and the dashed leaders that tie each record
 * card to its beacon.
 */
function Lamps({ spec, box, tier }: { spec: ValleySpec; box: Box; tier: PrivacyTier }) {
  const id = useId().replace(/:/g, "");
  const { w, h } = box;
  const lamps = lampsPx(spec, box);
  const core = spec.halo * 0.2;
  const shaft = spec.shaft * h;
  const star = tier === "wide" ? 26 : 19;
  const leaders: string[] =
    tier === "wide"
      ? [
          `M${r1(0.245 * w + 5)} ${r1(lamps[0][1])}L${r1(lamps[0][0] - core - 6)} ${r1(lamps[0][1])}`,
          `M${r1(lamps[1][0] + core + 6)} ${r1(lamps[1][1])}L${r1(0.755 * w - 5)} ${r1(lamps[1][1])}`,
        ]
      : lamps.map(([x, y]) => `M${r1(x)} 4L${r1(x)} ${r1(y - core - 6)}`);
  const ends: Pt[] =
    tier === "wide"
      ? [
          [0.245 * w + 5, lamps[0][1]],
          [0.755 * w - 5, lamps[1][1]],
        ]
      : lamps.map(([x]) => [x, 4] as Pt);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="absolute left-0 top-0 overflow-visible">
      <defs>
        <radialGradient id={`${id}-halo`}>
          <stop offset="0" stopColor="#eceaff" stopOpacity="0.5" />
          <stop offset="0.2" stopColor="#c9ccff" stopOpacity="0.24" />
          <stop offset="0.55" stopColor="#aeb4ff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#8b6cf6" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-core`}>
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.3" stopColor="#f4f3ff" stopOpacity="0.85" />
          <stop offset="0.62" stopColor="#c9ccff" stopOpacity="0.3" />
          <stop offset="1" stopColor="#aeb4ff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-flare`}>
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.7" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-shaft`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#e4e5ff" stopOpacity="0.42" />
          <stop offset="0.4" stopColor="#aeb4ff" stopOpacity="0.14" />
          <stop offset="1" stopColor="#aeb4ff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {shaft > 0 &&
        lamps.map(([x, y], i) => (
          <g key={i} fill={`url(#${id}-shaft)`}>
            {(
              [
                [18, 44, 0.32],
                [7, 17, 0.6],
                [2, 5, 1],
              ] as const
            ).map(([b, t, o]) => (
              <path
                key={b}
                d={`M${r1(x - b)} ${r1(y)}L${r1(x - t)} ${r1(y - shaft)}L${r1(x + t)} ${r1(y - shaft)}L${r1(x + b)} ${r1(y)}Z`}
                opacity={o}
              />
            ))}
          </g>
        ))}

      {leaders.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="#aeb4ff"
          strokeOpacity="0.6"
          strokeWidth="1.3"
          strokeDasharray="1.5 5"
          strokeLinecap="round"
        />
      ))}
      {ends.map(([x, y], i) => (
        <circle key={i} cx={r1(x)} cy={r1(y)} r="2.6" fill="#c9ccff" />
      ))}

      {lamps.map(([x, y], i) => (
        <g key={i}>
          <circle cx={r1(x)} cy={r1(y)} r={spec.halo} fill={`url(#${id}-halo)`} />
          <ellipse cx={r1(x)} cy={r1(y)} rx={spec.halo * 0.66} ry="1.6" fill={`url(#${id}-flare)`} />
          <circle cx={r1(x)} cy={r1(y)} r={core} fill={`url(#${id}-core)`} />
          {/* the artwork's four-point star: static (a twinkle would cost two more layers) */}
          <path
            d={STAR}
            transform={`translate(${r1(x - star / 2)} ${r1(y - star / 2)}) scale(${(star / 24).toFixed(3)})`}
            fill="#ffffff"
          />
        </g>
      ))}
    </svg>
  );
}

// ─── Fog groups ───────────────────────────────────────────────────────────────

/**
 * will-change for the valley's sliding art, dropped while Landing marks the
 * block idle (far off-screen), so those layers are not kept for other scenes.
 */
const IDLE_SAFE_WILL_CHANGE = `will-change-transform [[data-idle]_&]:will-change-auto ${OFF_WILL_CHANGE}`;

interface FogGroupSpec {
  /** pointer-parallax depth of the group (fine pointers) */
  depth: "subject" | "near";
  /** sideways offset (vw) at strip progress 0.06, PRIVACY_FOG_CLOSED and 1 */
  x: readonly [number, number, number];
  /** bands, positioned in a box one viewport wide (centred on the gorge) and one strip tall */
  bands: readonly FogBandSpec[];
}

/**
 * Two groups per tier that slide in opposite directions: one behind the
 * cliffs, seen through the gorge (slides right), and one in front of the link
 * (slides left); they meet in the gorge and hide the link. A third depth of
 * mist rides on the cloud sea (SEA_MIST), drifting left with it.
 */
const FOG: Record<"wide" | "stacked", readonly [FogGroupSpec, FogGroupSpec]> = {
  wide: [
    {
      depth: "subject",
      x: [-34, 0, 7],
      bands: [
        { top: "28%", height: "44%", left: "29%", width: "42%", alpha: 0.2 },
        { top: "48%", height: "22%", left: "16%", width: "40%", alpha: 0.16, tone: "mist" },
        { top: "38%", height: "12%", left: "42%", width: "44%", alpha: 0.16 },
        { top: "56%", height: "20%", left: "36%", width: "36%", alpha: 0.2, tone: "mist" },
        { top: "46%", height: "5%", left: "25%", width: "50%", alpha: 0.24, tone: "mist" },
      ],
    },
    {
      depth: "near",
      x: [34, 0, -7],
      bands: [
        { top: "36%", height: "26%", left: "33%", width: "34%", alpha: 0.34 },
        { top: "43%", height: "17%", left: "38%", width: "24%", alpha: 0.3, tone: "mist" },
        { top: "31%", height: "11%", left: "22%", width: "50%", alpha: 0.16, tone: "mist" },
        { top: "50%", height: "15%", left: "45%", width: "40%", alpha: 0.18 },
        { top: "55%", height: "5%", left: "29%", width: "44%", alpha: 0.26, tone: "mist" },
        { top: "41.5%", height: "4%", left: "41%", width: "36%", alpha: 0.2 },
      ],
    },
  ],
  stacked: [
    {
      depth: "subject",
      x: [-40, 0, 8],
      bands: [
        { top: "22%", height: "48%", left: "20%", width: "60%", alpha: 0.2 },
        { top: "44%", height: "26%", left: "4%", width: "52%", alpha: 0.15, tone: "mist" },
        { top: "34%", height: "13%", left: "40%", width: "56%", alpha: 0.15 },
      ],
    },
    {
      depth: "near",
      x: [40, 0, -8],
      bands: [
        { top: "32%", height: "30%", left: "26%", width: "48%", alpha: 0.34 },
        { top: "40%", height: "20%", left: "32%", width: "36%", alpha: 0.28, tone: "mist" },
        { top: "28%", height: "12%", left: "12%", width: "64%", alpha: 0.15, tone: "mist" },
        { top: "51%", height: "6%", left: "16%", width: "68%", alpha: 0.24, tone: "mist" },
      ],
    },
  ],
};

/** One fog group: kit fog bands in a box that slides sideways with the strip's progress. */
function FogGroup({ spec, progress, moving }: { spec: FogGroupSpec; progress: MotionValue<number>; moving: boolean }) {
  const x = useRange(progress, [0.06, PRIVACY_FOG_CLOSED, 1], spec.x.map((v) => `${v}vw`));
  return (
    <motion.div
      style={{ x }}
      className={cn(
        "absolute inset-y-0 left-[calc(50%-50vw)] w-screen",
        `scene-depth-${spec.depth}`,
        moving && IDLE_SAFE_WILL_CHANGE,
      )}
    >
      {spec.bands.map((b, i) => (
        <FogBand key={i} {...b} />
      ))}
    </motion.div>
  );
}

// ─── Cloud sea ────────────────────────────────────────────────────────────────

/**
 * A moonlit sea of cloud below the pass: bands of billows that deepen, band by
 * band, from the hero's dim cloud tone to close to the page's night. Each tier
 * gets enough bands to keep the texture all the way down behind the lists.
 */
const SEA_FROM = { top: [0x90, 0x95, 0xe2], mid: [0x4a, 0x50, 0xa5], low: [0x2d, 0x32, 0x77] } as const;
const SEA_TO = { top: [0x35, 0x3b, 0x86], mid: [0x17, 0x1b, 0x50], low: [0x0c, 0x0f, 0x38] } as const;

function mix(a: readonly number[], b: readonly number[], t: number): string {
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

function seaBands(n: number): CloudBand[] {
  return Array.from({ length: n }, (_, i) => {
    const t = n > 1 ? Math.pow(i / (n - 1), 0.85) : 0;
    return { top: mix(SEA_FROM.top, SEA_TO.top, t), mid: mix(SEA_FROM.mid, SEA_TO.mid, t), low: mix(SEA_FROM.low, SEA_TO.low, t) };
  });
}

/** Low mist lying on the sea (positioned in the sea's box: 124vw wide, from the sea's top). */
const SEA_MIST: Record<"wide" | "stacked", readonly FogBandSpec[]> = {
  wide: [
    { top: "3vh", height: "15vh", left: "10%", width: "45%", alpha: 0.18, tone: "mist" },
    { top: "7vh", height: "16vh", left: "47%", width: "45%", alpha: 0.16, tone: "mist" },
    { top: "2vh", height: "8vh", left: "34%", width: "32%", alpha: 0.14 },
  ],
  stacked: [
    { top: "-1vh", height: "11vh", left: "3%", width: "58%", alpha: 0.18, tone: "mist" },
    { top: "1vh", height: "11vh", left: "40%", width: "58%", alpha: 0.16, tone: "mist" },
  ],
};

/** Bands, band height and puff size of the sea per tier (phones stack the lists, so their sea runs deeper). */
const SEA: Record<PrivacyTier, { bands: readonly CloudBand[]; edge: string; puff: "medium" | "large" }> = {
  wide: { bands: seaBands(5), edge: "18vh", puff: "medium" },
  tablet: { bands: seaBands(7), edge: "18vh", puff: "large" },
  phone: { bands: seaBands(10), edge: "26vh", puff: "large" },
};

// ─── Valley ───────────────────────────────────────────────────────────────────

export interface PrivacyValleyProps {
  tier: PrivacyTier;
  /** the strip's "through" progress (a constant PRIVACY_FOG_CLOSED for still frames) */
  progress: MotionValue<number>;
  /** false for still frames: no will-change */
  moving: boolean;
}

/**
 * The static foreground of the scene, in paint order: fog flowing into the
 * gorge (behind the cliffs), the cliffs and towers, the link, the lamps and
 * leaders, fog in front of the link, and the cloud sea with mist lying on it.
 * Three moving layers in all, with the static art in one run between them. Put it in the figure
 * strip (a positioned box): it fills the strip, draws in the strip's pixel
 * space (it measures its own box, which is the strip's) and paints past it,
 * full-bleed sideways and down to the stage's bottom.
 */
export function PrivacyValley({ tier, progress, moving }: PrivacyValleyProps) {
  // measured on this component's own box: a parent's ref is not attached yet when a child's layout effect runs
  const ref = useRef<HTMLDivElement>(null);
  const box = useBox(ref);
  const spec = PRIVACY_VALLEY[tier];
  const fog = FOG[tier === "wide" ? "wide" : "stacked"];
  const hide = useRange<number>(progress, [HIDE_FROM, PRIVACY_FOG_CLOSED], [0, 1]);
  const seaX = useRange(progress, [0, 1], ["4vw", "-4vw"]);

  return (
    <div ref={ref} aria-hidden className="pointer-events-none absolute inset-0 z-[2]">
      {/* behind the cliffs: it shows through the gorge, flowing in from the left */}
      <FogGroup spec={fog[0]} progress={progress} moving={moving} />
      {/* the static art in one run, so it shares one compositing layer between the moving fog groups */}
      {box && (
        <>
          <Cliffs spec={spec} box={box} />
          <LinkDots spec={spec} box={box} hide={hide} />
          <Lamps spec={spec} box={box} tier={tier} />
        </>
      )}
      <FogGroup spec={fog[1]} progress={progress} moving={moving} />
      {/* the cloud sea, with low mist lying on it (one layer, drifting left) */}
      <motion.div
        style={{ x: seaX, top: `${spec.sea * 100}%` }}
        className={cn(
          "absolute left-[calc(50%-62vw)] w-[124vw]",
          tier === "wide" ? "-bottom-[100vh]" : "-bottom-[140vh]",
          moving && IDLE_SAFE_WILL_CHANGE,
        )}
      >
        <CloudWall
          bands={SEA[tier].bands}
          seed={17}
          tone="dim"
          puff={SEA[tier].puff}
          edgeHeight={SEA[tier].edge}
          className="h-full w-full"
        />
        {SEA_MIST[tier === "wide" ? "wide" : "stacked"].map((b, i) => (
          <FogBand key={i} {...b} />
        ))}
      </motion.div>
    </div>
  );
}
