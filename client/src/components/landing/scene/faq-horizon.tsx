/**
 * The far horizon along the bottom of the FAQ band (sections/Faq.tsx): a low
 * moonlit range in silhouette against a faint glow on the horizon, with mist
 * over its foot. It foreshadows the closing scene's dawn ranges, so the FAQ
 * hands off to the dawn as one landscape.
 *
 *   sky   the glow on the horizon: lavender, with a faint warm core (the dawn to come)
 *   far   the range (a squat tier-1 Ridge: far away, so its peaks are low) and the mist
 *
 * Render it inside the FAQ's pass-through SceneStage (it reads the stage's mode
 * and factor). A pass-through plane lags its band and sinks through it as the
 * page scrolls, so every top is written as where it should be at the reference
 * frame (the band's bottom edge at 72% of the screen height, the last questions
 * on screen with the dawn coming up below) minus the plane's offset at that
 * frame. In a still frame (reduced motion) the planes rest at that place.
 *
 * The range's peaks sit just under the FAQ panel at the reference frame (the
 * band keeps a matching bottom padding), and the band's own bottom blend takes
 * its foot into the night. aria-hidden art: gradients only (no filters), no
 * animation. Put FaqHorizonGlow in the band's sky SceneLayer and
 * FaqHorizonRange in its far SceneLayer: they add no compositing layer.
 */
import type { CSSProperties } from "react";
import { DEPTH, useScene, type SceneDepth } from "./depth";
import { Ridge } from "./Ridges";
import { MistBand } from "./bands-art";

/** The reference frame: the band's bottom edge at this fraction of the screen height. */
const REF = 0.72;

export type FaqHorizonTier = "wide" | "narrow";

/**
 * Per tier: the drawing height D of the range before squashing (the Ridge box
 * is 100vw + 64px wide, so D = max(edge, 25vw + 16px)), the squash, the range's
 * top above the band's bottom at the reference frame, and the range's look.
 */
const SPEC: Record<FaqHorizonTier, { d: string; squash: number; edge: string; top: string; peaks: number; glowX: string }> = {
  // peaks 20vh above the bottom at the reference frame: just under the panel (the band's bottom padding is 22vh)
  wide: { d: "(25vw + 16px)", squash: 0.55, edge: "0px", top: "20vh", peaks: 6, glowX: "44%" },
  // stacked: the panel spans the width and ends 20vh above the bottom
  narrow: { d: "max(18vh, 25vw + 16px)", squash: 0.6, edge: "18vh", top: "18vh", peaks: 4, glowX: "50%" },
};

/**
 * `desired` (a CSS length, the top at the reference frame) for a plane at
 * `depth`: minus that plane's pass-through offset at the reference frame, which
 * is factor · (1 − rate) · (H/2 + V/2 − REF·V) for a band H tall on a screen V
 * tall (depth.tsx). In a still frame there is no offset.
 */
function useTop(depth: SceneDepth, desired: string): string {
  const { mode, factor } = useScene();
  if (mode !== "through") return `calc(${desired})`;
  const c = factor * (1 - DEPTH[depth].rate);
  const pct = ((c / 2) * 100).toFixed(2);
  const vh = (c * (REF - 0.5) * 100).toFixed(3);
  return `calc(${desired} - ${pct}% + ${vh}vh)`;
}

/** The range's geometry per tier: the squashed drawing's height and its top at the reference frame (CSS terms). */
function geometry(tier: FaqHorizonTier) {
  const s = SPEC[tier];
  const drawn = `(${s.squash} * ${s.d})`;
  // the tallest peak sits about a quarter of the drawing below the range's top
  return { s, drawn, rangeTop: `100% - ${s.top} - 0.25 * ${drawn}` };
}

/**
 * For the band's sky plane: the glow on the horizon, brightest just above the
 * crests. Its box runs on below the range's drawing, so its bottom edge always
 * sits behind the range's solid foot (the two planes drift apart by at most
 * ~20px over the pass) and never shows as a line in a valley.
 */
export function FaqHorizonGlow({ tier }: { tier: FaqHorizonTier }) {
  const { s, drawn, rangeTop } = geometry(tier);
  const style: CSSProperties = {
    top: useTop("sky", `${rangeTop} + ${drawn} - 54vh`),
    height: "60vh",
    background: [
      `radial-gradient(26% 36% at ${s.glowX} 62%, rgb(245 213 138 / 0.08), transparent 72%)`,
      `radial-gradient(56% 36% at ${s.glowX} 62%, rgb(174 180 255 / 0.16), rgb(139 108 246 / 0.06) 52%, transparent 100%)`,
    ].join(", "),
  };
  return <div aria-hidden className="pointer-events-none absolute -inset-x-8" style={style} />;
}

/**
 * For the band's far plane: the range and the mist over its foot. The range is
 * squashed from its top edge, and tall enough that its solid foot runs past the
 * band's bottom at every frame where that bottom is on screen (the plane only
 * sinks from the reference frame on). Both stay within the plane's 32px side
 * overhang: art reaching further out gets a compositing layer of its own.
 */
export function FaqHorizonRange({ tier }: { tier: FaqHorizonTier }) {
  const { s, drawn, rangeTop } = geometry(tier);
  const range: CSSProperties = {
    top: useTop("far", rangeTop),
    height: tier === "wide" ? "110vh" : "90vh",
    transform: `scaleY(${s.squash})`,
    transformOrigin: "top",
  };
  const mistTop = useTop("far", `${rangeTop} + 0.45 * ${drawn} - 3vh`);
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute -inset-x-8" style={range}>
        {/* keep the tier's haze: the kit fills below the drawing with the hazed base, so without it a seam would show */}
        <Ridge tier={1} seed={9} peaks={s.peaks} rimAt={0.62} edgeHeight={s.edge} className="absolute inset-0" />
      </div>
      <MistBand top={mistTop} height={tier === "wide" ? "12vh" : "10vh"} alpha={0.07} tone="mist" />
    </>
  );
}
