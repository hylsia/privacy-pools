/**
 * Mountain ridges with atmospheric perspective: far tiers are lighter and
 * hazier, near tiers darker; every summit has a moonlit face on the moon side
 * with a bright rim along its crest, and mist gathers at the base of each
 * tier. One static SVG per tier, so each tier can sit in its own SceneLayer
 * (far ridge in "far", mid ridge in "mid", …).
 *
 * Sizing: the drawing (1600 × 400, crests in its upper 300) is never cropped
 * vertically. Its height is max(edgeHeight, width / 4): wide screens see the
 * whole range, narrow ones a centred slice with bigger peaks. Below the
 * drawing the box is filled with the tier's base colour, so a ridge can run on
 * below the stage for its layer's travel.
 */
import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ridgePaths } from "./geometry";

export type RidgeTier = 0 | 1 | 2 | 3;

interface RidgeTone {
  crest: string;
  body: string;
  base: string;
  /** mist at the base of the tier (opacity) */
  haze: number;
  /** moonlit faces (opacity at the crest) and rim (opacity) */
  face: number;
  rim: number;
}

/** Far → near (spec §2 ridges: #2B3170 #1D2262 #121646 #0A0D33). */
const TONES: Record<RidgeTier, RidgeTone> = {
  0: { crest: "#30377e", body: "#272d6a", base: "#2a3072", haze: 0.14, face: 0.3, rim: 0.62 },
  1: { crest: "#1f2566", body: "#1a1f58", base: "#191e57", haze: 0.1, face: 0.24, rim: 0.55 },
  2: { crest: "#161b50", body: "#121646", base: "#10143f", haze: 0.07, face: 0.13, rim: 0.42 },
  3: { crest: "#0d1140", body: "#0a0d33", base: "#080a28", haze: 0, face: 0.1, rim: 0.36 },
};

/** Ridge line per tier in the 1600 × 400 drawing: fewer, taller peaks far away. */
const PROFILES: Record<RidgeTier, { peaks: number; base: number; amp: number }> = {
  0: { peaks: 4, base: 260, amp: 200 },
  1: { peaks: 5, base: 270, amp: 170 },
  2: { peaks: 6, base: 285, amp: 140 },
  3: { peaks: 7, base: 300, amp: 110 },
};

export interface RidgeProps {
  /** 0 far … 3 near */
  tier?: RidgeTier;
  /** different seeds give different skylines (default 7) */
  seed?: number;
  /** override the number of summits */
  peaks?: number;
  /** side the moonlight comes from; "none" drops faces and rim (default "right") */
  rim?: "right" | "left" | "none";
  /** where along the width the light is strongest, 0–1 (default 0.8 for "right", 0.2 for "left") */
  rimAt?: number;
  /** mist at the base of the tier (default true) */
  haze?: boolean;
  /** minimum height of the drawn skyline (CSS length); it is at least width / 4. Default "0px" */
  edgeHeight?: string;
  /** box: position and size, e.g. "absolute -inset-x-8 top-[54%] -bottom-[10vh]" */
  className?: string;
}

/** One ridge tier (aria-hidden): crests at the top of the box, solid below. */
export function Ridge({
  tier = 1,
  seed = 7,
  peaks,
  rim = "right",
  rimAt,
  haze = true,
  edgeHeight = "0px",
  className,
}: RidgeProps) {
  const id = useId().replace(/:/g, "");
  const tone = TONES[tier];
  const profile = PROFILES[tier];
  const lit = rim === "left" ? "left" : "right";
  const shapes = useMemo(
    () => ridgePaths(seed * 31 + tier * 7, { ...profile, peaks: peaks ?? profile.peaks }, 404, lit),
    [seed, tier, peaks, profile, lit],
  );
  const top = profile.base - profile.amp;
  const peak = rimAt ?? (lit === "right" ? 0.8 : 0.2);
  const mistTop = profile.base - profile.amp * 0.35;

  return (
    <div aria-hidden className={cn("pointer-events-none flex flex-col", className)}>
      <svg
        viewBox="0 0 1600 400"
        preserveAspectRatio="xMidYMin slice"
        className="block w-full shrink-0"
        style={{ aspectRatio: "1600 / 400", minHeight: edgeHeight }}
      >
        <defs>
          <linearGradient id={`${id}-fill`} gradientUnits="userSpaceOnUse" x1="0" y1={top} x2="0" y2="310">
            <stop offset="0" stopColor={tone.crest} />
            <stop offset="0.3" stopColor={tone.body} />
            <stop offset="1" stopColor={tone.base} />
          </linearGradient>
          {/* the moonlit faces: bright under the crest, gone by the foot; stronger towards the moon */}
          <linearGradient id={`${id}-face`} gradientUnits="userSpaceOnUse" x1="0" y1={top} x2="0" y2={profile.base + 20}>
            <stop offset="0" stopColor="#c9ccff" stopOpacity={tone.face} />
            <stop offset="0.45" stopColor="#aeb4ff" stopOpacity={tone.face * 0.45} />
            <stop offset="1" stopColor="#aeb4ff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-light`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1600" y2="0">
            <stop offset={lit === "right" ? "0" : "1"} stopColor="#fff" stopOpacity="0.35" />
            <stop offset={peak.toFixed(3)} stopColor="#fff" stopOpacity="1" />
            <stop offset={lit === "right" ? "1" : "0"} stopColor="#fff" stopOpacity="0.7" />
          </linearGradient>
          <mask id={`${id}-near-moon`} maskUnits="userSpaceOnUse" x="-200" y="0" width="2000" height="404">
            <rect x="-200" y="0" width="2000" height="404" fill={`url(#${id}-light)`} />
          </mask>
          {haze && tone.haze > 0 && (
            <linearGradient id={`${id}-haze`} gradientUnits="userSpaceOnUse" x1="0" y1={mistTop} x2="0" y2="310">
              <stop offset="0" stopColor="#aeb4ff" stopOpacity="0" />
              <stop offset="0.55" stopColor="#aeb4ff" stopOpacity={tone.haze * 0.55} />
              <stop offset="1" stopColor="#c9ccff" stopOpacity={tone.haze} />
            </linearGradient>
          )}
          <clipPath id={`${id}-clip`}>
            <path d={shapes.fill} />
          </clipPath>
        </defs>

        <path d={shapes.fill} fill={`url(#${id}-fill)`} />
        {rim !== "none" && (
          <g clipPath={`url(#${id}-clip)`} mask={`url(#${id}-near-moon)`}>
            {shapes.faces.map((f, i) => (
              <path key={i} d={f.face} fill={`url(#${id}-face)`} />
            ))}
          </g>
        )}
        {haze && tone.haze > 0 && (
          <rect x="-200" y={mistTop} width="2000" height="500" fill={`url(#${id}-haze)`} clipPath={`url(#${id}-clip)`} />
        )}
        {rim !== "none" && (
          <g mask={`url(#${id}-near-moon)`}>
            <path
              d={shapes.crest}
              fill="none"
              stroke="#c9ccff"
              strokeOpacity={tone.rim * 0.28}
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            {shapes.faces.map((f, i) => (
              <path
                key={i}
                d={f.edge}
                fill="none"
                stroke="#eceaff"
                strokeOpacity={tone.rim}
                strokeWidth="1.5"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        )}
      </svg>
      <div className="min-h-0 w-full flex-1" style={{ background: hazeBase(tone) }} />
    </div>
  );
}

/** Colour at the very bottom of a tier: its base, lifted by the haze when it has one. */
function hazeBase(tone: RidgeTone): string {
  return tone.haze > 0
    ? `color-mix(in srgb, ${tone.base} ${Math.round(100 - tone.haze * 100)}%, #c9ccff)`
    : tone.base;
}

/**
 * A static stack of 3 or 4 tiers in one box (for a backdrop whose tiers do not
 * need separate depths). Each tier starts lower than the one behind it.
 */
export function Ridges({
  layers = 3,
  seed = 7,
  rim = "right",
  className,
}: {
  layers?: 3 | 4;
  seed?: number;
  rim?: "right" | "left" | "none";
  className?: string;
}) {
  const tops = ["top-0", "top-[16%]", "top-[32%]", "top-[46%]"];
  const tiers: RidgeTier[] = layers === 4 ? [0, 1, 2, 3] : [0, 1, 2];
  return (
    <div aria-hidden className={cn("pointer-events-none relative overflow-hidden", className)}>
      {tiers.map((t, i) => (
        <Ridge key={t} tier={t} seed={seed} rim={rim} className={cn("absolute inset-x-0 bottom-0", tops[i])} />
      ))}
    </div>
  );
}
