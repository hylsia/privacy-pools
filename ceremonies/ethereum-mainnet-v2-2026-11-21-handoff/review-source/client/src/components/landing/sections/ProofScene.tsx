/**
 * "Inside the proof" — landing v2, scene 3 (spec §6.3): the proof drawn in the
 * night sky.
 *
 * Wide screens: the stage is pinned for 180vh. Four statements light one after
 * another on a rail on the left while, on the right, a constellation draws what
 * each one proves — the Merkle path from the pool's root down through the stars
 * to one gold star (your note), the association set closing around it, the
 * nullifier reticle, and the trail to the one star it may go to. The rail runs
 * on into a gold "Proof valid" seal, which closes last.
 *
 *   step 1  0.02–0.26  "My note is in the pool" · the Merkle path
 *   step 2  0.26–0.44  "Its deposit is in the association set" · the set ring
 *   step 3  0.44–0.62  "It hasn't been spent" · the nullifier reticle
 *   step 4  0.62–0.80  "It can only go where I said" · the trail
 *   seal    0.80–0.93  the seal ring closes, then "Proof valid" turns gold
 *   hold    0.93–1.00
 *
 * Depth, back to front (upward travel over the pin; pointer parallax on fine
 * pointers): NightSky (static) · sky 3vh: the galaxy band, fine stars ·
 * far 8vh: nebula, bright stars, the constellation, the far range with its
 * horizon glow and mist, sparkles (one plane, so the stars always sit behind
 * the mountains) · mid 16vh: valley mist, the middle range · subject 24vh: the
 * near range · vignette, scrim, edge fades (static) · copy (static; the rows
 * and the seal only cross-fade by opacity, the rail and the seal ring draw
 * with pathLength). Animated children paint last in their plane, so nothing
 * forces an extra compositing layer above them.
 *
 * Phones and portrait tablets (< 1024px): not pinned. The copy scrolls over a
 * sticky night backdrop (the same sky, its ridges rising as you go); the
 * constellation sits in the flow and draws itself as it comes up the screen,
 * and the statements light as they rise. Reduced motion and short screens get
 * still frames of the finished proof. The top and bottom fade to --night-1
 * (15vh wide; 12vh / 10vh stacked), so the scene joins its neighbours
 * without a seam.
 */
import { useId, useRef, type CSSProperties } from "react";
import { motion, motionValue, type MotionValue } from "framer-motion";
import { Check, Fingerprint, Lock, Network, Users, type IconType } from "@/components/icons";
import { PinnedScene, useMedia, useMotionSafe, useRange, useSectionProgress } from "@/components/landing/parallax";
import { SCENE_TYPE } from "@/components/landing/system";
import {
  FogBand,
  NightSky,
  Ridge,
  SceneLayer,
  SceneSparkles,
  SceneStage,
  Scrim,
  Starfield,
  Vignette,
  type SceneSparkleSpec,
} from "@/components/landing/scene";
import { ProofConstellation, type ProofBeats } from "@/components/landing/scene/proof-constellation";
import { ProofSeal } from "@/components/landing/scene/proof-seal";
import { ProofGalaxy, ProofNebula } from "@/components/landing/scene/proof-sky";
import { cn } from "@/lib/utils";

// ─── Copy ─────────────────────────────────────────────────────────────────────

const TITLE_ID = "proof-title";
const STATEMENTS: readonly { text: string; Icon: IconType }[] = [
  { text: "My note is in the pool", Icon: Network },
  { text: "Its deposit is in the association set", Icon: Users },
  { text: "It hasn't been spent", Icon: Fingerprint },
  { text: "It can only go where I said", Icon: Lock },
];
const FOOTNOTE = "Groth16 · development setup · not audited";

// ─── Timeline (constants, so every range is fixed for the life of a mount) ────

type Range = [number, number];

/** Per statement: when it lights, when its art draws, when its check lands. */
const STEPS: readonly { lit: Range; art: Range; done: Range }[] = [
  { lit: [0.02, 0.06], art: [0.05, 0.24], done: [0.23, 0.26] },
  { lit: [0.26, 0.3], art: [0.28, 0.42], done: [0.41, 0.44] },
  { lit: [0.44, 0.48], art: [0.46, 0.6], done: [0.59, 0.62] },
  { lit: [0.62, 0.66], art: [0.64, 0.78], done: [0.77, 0.8] },
];
/** The seal closes after the last check, then the words turn gold. */
const SEAL_DRAW: Range = [0.8, 0.9];
const SEAL_LIT: Range = [0.89, 0.93];
/**
 * The rail reaches each statement as it lights and the seal as it starts to
 * close. The list is laid out in units of --tile (gap 0.41, seal gap 0.64,
 * seal 1.36), so these fractions hold at every size.
 */
const RAIL_IN = [0.02, 0.26, 0.44, 0.62, 0.8];
const RAIL_OUT = [0, 0.233, 0.466, 0.699, 1];
/** A statement before its step: dimmed but still legible (≥ 4.5:1 over the scrim). */
const DIM = 0.55;

/** A finished timeline, for still frames. */
const FULL = motionValue(1);
const DONE: ProofBeats = { path: FULL, set: FULL, spent: FULL, bound: FULL, seal: FULL };

/** The constellation's beats on the pinned timeline. */
function usePinnedBeats(p: MotionValue<number>): ProofBeats {
  return {
    path: useRange(p, STEPS[0].art, [0, 1]),
    set: useRange(p, STEPS[1].art, [0, 1]),
    spent: useRange(p, STEPS[2].art, [0, 1]),
    bound: useRange(p, STEPS[3].art, [0, 1]),
    seal: useRange(p, SEAL_LIT, [0, 1]),
  };
}

// ─── Layout ───────────────────────────────────────────────────────────────────

/** Width of the copy column (wide layouts); the constellation starts 3rem to its right. */
const COL_VARS = "[--proof-col:30rem] xl:[--proof-col:36rem] 2xl:[--proof-col:44rem]";
/** The list's unit (tile size); smaller on short screens. */
const TILE_VARS =
  "[--tile:2.75rem] 2xl:[--tile:3rem] [@media(max-height:819px)]:[--tile:2.5rem]";
/** Short wide screens: tighter spacing so the column fits under the nav pill. */
const SHORT = "[@media(max-height:819px)]";

/** The constellation's box: from the copy column's right edge (+3rem) to near the right edge of the stage. */
const ART_BOX: CSSProperties = {
  left: "calc(max(2.5rem, (100% - 80rem) / 2) + var(--proof-col) + 3rem)",
  right: "2.5%",
  top: "16%",
  height: "58%",
};

/** Light low in the sky behind the far range (in the box above the ridge: 0% its top, 100% its bottom). */
const HORIZON_GLOW = [
  "radial-gradient(56% 42% at 44% 66%, rgb(201 204 255 / 0.16), transparent 72%)",
  "radial-gradient(34% 40% at 78% 60%, rgb(174 180 255 / 0.16), transparent 72%)",
  "radial-gradient(90% 30% at 50% 78%, rgb(139 108 246 / 0.1), transparent 72%)",
].join(",");

/** White only: in this scene gold means your note. Few of them: every sparkle is its own compositing layer. */
const SPARKLES_WIDE: SceneSparkleSpec[] = [
  { left: "57%", top: "11%", size: 10, tone: "white", delay: 0.6 },
  { left: "93%", top: "15%", size: 13, tone: "white", delay: 2.2 },
];
const SPARKLES_STACKED: SceneSparkleSpec[] = [
  { left: "88%", top: "20%", size: 11, tone: "white", delay: 0.8 },
  { left: "9%", top: "44%", size: 8, tone: "white", delay: 2.6 },
];

// ─── Shared pieces ────────────────────────────────────────────────────────────

/**
 * The top and bottom of the scene fade to the page's night (15vh each on wide
 * screens; shorter when stacked, where the next scene's own fade follows), so
 * the scene has no hard edge.
 */
function EdgeFades({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 bg-[linear-gradient(to_bottom,var(--night-1)_0%,rgb(10_12_42/0.8)_34%,rgb(10_12_42/0.34)_70%,rgb(10_12_42/0)_100%)]",
          compact ? "h-[12vh]" : "h-[15vh]",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(to_top,var(--night-1)_0%,rgb(10_12_42/0.8)_34%,rgb(10_12_42/0.34)_70%,rgb(10_12_42/0)_100%)]",
          compact ? "h-[10vh]" : "h-[16vh]",
        )}
      />
    </>
  );
}

/**
 * Eyebrow, h2 and the one-line lead. `pinned`: the column must fit one screen
 * under the nav pill, so short screens tighten it and drop the lead below
 * 700px (the stacked layout scrolls, so it keeps everything).
 */
function Heading({ pinned = false }: { pinned?: boolean }) {
  return (
    <div>
      <p className={SCENE_TYPE.eyebrow}>Inside the proof</p>
      <h2 id={TITLE_ID} className={cn("mt-4 sm:mt-5", pinned && SHORT + ":mt-3", SCENE_TYPE.headline)}>
        <span className="block">One proof.</span> <span className="scene-text-glow">Four statements.</span>
      </h2>
      <p
        className={cn(
          "mt-4 sm:mt-6",
          pinned && SHORT + ":mt-4",
          pinned && "[@media(max-height:699px)]:hidden",
          SCENE_TYPE.lead,
        )}
      >
        Your browser proves all four before a private withdrawal.
      </p>
    </div>
  );
}

/** The rail behind the tiles: a faint track, filled (pathLength) from the first statement down to the seal. */
function Rail({ fill }: { fill: MotionValue<number> }) {
  const id = useId().replace(/:/g, "");
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute bottom-[calc(var(--tile)*0.68)] left-[calc(var(--tile)/2_-_1px)] top-[calc(var(--tile)/2)] w-[2px]"
    >
      <svg viewBox="0 0 2 100" preserveAspectRatio="none" className="block h-full w-full overflow-visible">
        <defs>
          <linearGradient id={`${id}-rail`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
            <stop offset="0" stopColor="#aeb4ff" />
            <stop offset="0.7" stopColor="#dfe1ff" />
            <stop offset="1" stopColor="#f5d58a" />
          </linearGradient>
        </defs>
        <line x1="1" y1="0" x2="1" y2="100" stroke="#aeb4ff" strokeOpacity="0.2" strokeWidth="1.5" />
        <motion.line x1="1" y1="0" x2="1" y2="100" stroke={`url(#${id}-rail)`} strokeWidth="2" style={{ pathLength: fill }} />
      </svg>
    </div>
  );
}

/** One statement: icon tile + words. Dim until its step, then lit; its check lands when its art is drawn. */
function StatementRow({ p, i }: { p: MotionValue<number>; i: number }) {
  const { lit, done } = STEPS[i];
  const { text, Icon } = STATEMENTS[i];
  const opacity = useRange(p, lit, [DIM, 1]);
  const glow = useRange(p, [lit[0], lit[1], done[0], done[1]], [0, 1, 1, 0.3]);
  const check = useRange(p, done, [0, 1]);
  return (
    <motion.li style={{ opacity }} className="grid grid-cols-[var(--tile)_minmax(0,1fr)] items-center gap-x-4 2xl:gap-x-5">
      <span
        aria-hidden
        className="relative grid h-[var(--tile)] w-[var(--tile)] place-items-center rounded-[30%] border border-white/15 bg-[#0d1036] shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_10px_30px_-12px_rgb(4_5_26/0.9)]"
      >
        <span className="absolute inset-0 rounded-[inherit] bg-[linear-gradient(155deg,rgb(174_180_255/0.2),rgb(174_180_255/0.02)_62%)]" />
        <motion.span
          style={{ opacity: glow }}
          className="absolute -inset-px rounded-[inherit] border border-[color:rgb(201_204_255/0.75)] shadow-[0_0_26px_-4px_rgb(174_180_255/0.7),inset_0_0_14px_rgb(174_180_255/0.25)]"
        />
        <Icon className="relative h-[40%] w-[40%] text-[color:var(--lavender)]" />
        <motion.span
          style={{ opacity: check }}
          className="absolute -right-[7px] -top-[7px] grid h-[18px] w-[18px] place-items-center rounded-full bg-[color:var(--lavender)] text-[color:var(--night-1)] shadow-[0_0_0_3px_var(--night-1)]"
        >
          <Check className="h-2.5 w-2.5" />
        </motion.span>
      </span>
      <span
        className={cn(
          "font-display text-xl font-medium leading-[1.2] tracking-[-0.02em] text-[color:var(--ink)] [text-shadow:0_2px_18px_rgb(4_5_26/0.6)] xl:text-2xl 2xl:text-[1.625rem]",
          SHORT + ":xl:text-[1.375rem]",
        )}
      >
        {text}
      </span>
    </motion.li>
  );
}

/**
 * The four statements on their rail, ending in the seal. `p` is the timeline
 * (the pin's progress, a scroll-linked stand-in on stacked layouts, or FULL).
 * Lay it out inside an element that sets --tile (TILE_VARS).
 */
function ProofList({ p, className }: { p: MotionValue<number>; className?: string }) {
  const rail = useRange<number>(p, RAIL_IN, RAIL_OUT);
  const sealDraw = useRange<number>(p, SEAL_DRAW, [0, 1]);
  const sealLit = useRange<number>(p, SEAL_LIT, [0, 1]);
  const pending = useRange<number>(p, SEAL_LIT, [DIM, 0]);
  return (
    <div className={cn("relative", className)}>
      <Rail fill={rail} />
      <ol className="relative grid gap-[calc(var(--tile)*0.41)]">
        {STATEMENTS.map((s, i) => (
          <StatementRow key={s.text} p={p} i={i} />
        ))}
      </ol>
      <div className="relative mt-[calc(var(--tile)*0.64)] grid grid-cols-[var(--tile)_minmax(0,1fr)] items-center gap-x-4 2xl:gap-x-5">
        <ProofSeal
          draw={sealDraw}
          lit={sealLit}
          className="-mx-[calc(var(--tile)*0.18)] h-[calc(var(--tile)*1.36)] w-[calc(var(--tile)*1.36)]"
        />
        <div className="min-w-0">
          <p className="relative font-display text-[1.625rem] font-semibold leading-none tracking-[-0.03em] xl:text-[1.875rem] 2xl:text-[2.125rem]">
            <motion.span style={{ opacity: pending }} className="text-[color:var(--ink)]">
              Proof valid
            </motion.span>
            <motion.span aria-hidden style={{ opacity: sealLit }} className="scene-text-gold absolute inset-0">
              Proof valid
            </motion.span>
          </p>
          <p className="mt-2 font-mono text-xs tracking-wide text-[color:rgb(201_204_255/0.82)]">{FOOTNOTE}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Wide: art ────────────────────────────────────────────────────────────────

/**
 * Every art plane of the wide layout. Full-bleed planes overhang the sides by
 * 32px and bottom-anchored ones run on below the stage (by more than their
 * travel), so neither scroll travel nor pointer parallax uncovers an edge.
 */
function WideArt({ beats }: { beats: ProofBeats }) {
  return (
    <>
      <NightSky variant="deep" />

      {/* sky: fine stars and the galaxy band */}
      <SceneLayer depth="sky">
        <ProofGalaxy className="absolute -inset-x-8 -top-[3vh] h-full" />
        {/* last in its plane: nothing paints over the twinkling group, so it needs no extra layer above it */}
        <Starfield count={170} seed={23} twinkle="one" className="absolute -inset-x-4 -top-4 h-[90%]" />
      </SceneLayer>

      {/* far: nebula, a few bright stars, sparkles, the constellation, and the far range below it
          (the stars sit behind the mountains). One plane: the drawing repaints only the lines' boxes. */}
      <SceneLayer depth="far">
        <ProofNebula variant="wide" className="-inset-x-8 -top-[4vh] h-full" />
        <Starfield count={36} seed={8} twinkle="none" className="absolute -inset-x-4 -top-4 h-[72%] opacity-90" />
        <div className="absolute" style={ART_BOX}>
          <ProofConstellation beats={beats} className="h-full w-full" />
        </div>
        {/* a glow along the horizon, so the far range stands out as a silhouette */}
        <div aria-hidden className="absolute -inset-x-8 top-[53%] h-[34%]" style={{ background: HORIZON_GLOW }} />
        <Ridge tier={0} seed={12} rimAt={0.8} edgeHeight="30vh" className="absolute -inset-x-8 -bottom-[12vh] top-[66%]" />
        <FogBand top="77%" height="16%" alpha={0.14} tone="lavender" />
        <SceneSparkles items={SPARKLES_WIDE} />
      </SceneLayer>

      {/* mid: mist over the valley, the middle range rising in front of the far one */}
      <SceneLayer depth="mid">
        <FogBand top="74%" height="20%" alpha={0.13} tone="mist" />
        <Ridge tier={1} seed={3} rimAt={0.82} edgeHeight="26vh" className="absolute -inset-x-8 -bottom-[22vh] top-[86%]" />
      </SceneLayer>

      {/* subject: the near range, rising into the frame last */}
      <SceneLayer depth="subject">
        <Ridge tier={2} seed={5} rimAt={0.85} edgeHeight="22vh" className="absolute -inset-x-8 -bottom-[30vh] top-[97%]" />
      </SceneLayer>
    </>
  );
}

/** The copy column of the wide layouts. */
function WideCopy({ p }: { p: MotionValue<number> }) {
  return (
    <div className="w-full max-w-[var(--proof-col)]">
      <Heading pinned />
      <ProofList p={p} className={cn("mt-9", SHORT + ":mt-6", TILE_VARS)} />
    </div>
  );
}

/** The pinned stage. Its ranges are constants, so it never needs to remount. */
function WideStage({ progress }: { progress: MotionValue<number> }) {
  const beats = usePinnedBeats(progress);
  return (
    <SceneStage progress={progress} className={cn("h-full w-full", COL_VARS)}>
      <WideArt beats={beats} />
      <Vignette strength={0.5} />
      <Scrim side="left" />
      <EdgeFades />
      <div className={cn("absolute inset-0 grid items-center px-6 pb-10 pt-24 sm:px-10", SHORT + ":pb-6", SHORT + ":pt-20")}>
        <div className="mx-auto w-full max-w-7xl">
          <WideCopy p={progress} />
        </div>
      </div>
    </SceneStage>
  );
}

/** Reduced motion, or a wide screen too short to pin: the finished proof as one still frame. */
function WideStill() {
  return (
    <SceneStage
      as="section"
      id="proof"
      aria-labelledby={TITLE_ID}
      mode="static"
      frame={0.85}
      className={cn("min-h-[100svh]", COL_VARS)}
    >
      <WideArt beats={DONE} />
      <Vignette strength={0.5} />
      <Scrim side="left" />
      <EdgeFades />
      <div className="relative z-10 grid min-h-[100svh] items-center px-6 py-24 sm:px-10">
        <div className="mx-auto w-full max-w-7xl">
          <WideCopy p={FULL} />
        </div>
      </div>
    </SceneStage>
  );
}

// ─── Stacked (phones, portrait tablets) ───────────────────────────────────────

/** The night behind the stacked layout: one screen tall and sticky, or the whole section when still. */
function StackedBackdrop({ still = false }: { still?: boolean }) {
  return (
    <>
      <NightSky variant="deep" />
      <SceneLayer depth="sky">
        <ProofGalaxy from={[240, -120]} to={[1460, 1020]} width={250} stars={300} className="absolute -inset-x-8 -top-[3vh] h-full" />
        {still ? (
          <>
            <Starfield count={100} seed={23} twinkle="none" className="absolute inset-x-0 top-0 h-1/2" />
            <Starfield count={100} seed={31} twinkle="none" className="absolute inset-x-0 top-1/2 h-1/2" />
          </>
        ) : (
          <Starfield count={110} seed={23} twinkle="one" className="absolute -inset-x-4 -top-4 h-[96%]" />
        )}
      </SceneLayer>
      <SceneLayer depth="far">
        <ProofNebula variant="stacked" className="inset-x-0 -top-[4vh] h-full" />
        <SceneSparkles items={SPARKLES_STACKED} />
      </SceneLayer>
      <SceneLayer depth="mid">
        <Ridge
          tier={0}
          seed={12}
          rimAt={0.8}
          edgeHeight="16vh"
          className={cn("absolute -inset-x-8 -bottom-[20vh]", still ? "top-[86%]" : "top-[82%]")}
        />
      </SceneLayer>
      <SceneLayer depth="subject">
        {/* mist in the valley, so the foot of the range glows instead of going flat */}
        <FogBand top={still ? "88%" : "86%"} height="16%" alpha={0.15} tone="mist" />
        <Ridge
          tier={1}
          seed={5}
          rimAt={0.85}
          edgeHeight="13vh"
          className={cn("absolute -inset-x-8 -bottom-[30vh]", still ? "top-[94%]" : "top-[95%]")}
        />
      </SceneLayer>
      <Vignette strength={0.45} />
      <EdgeFades compact />
    </>
  );
}

/** The constellation in the flow: it draws itself as it comes up the screen. */
function StackedConstellation({ animate }: { animate: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const enter = useSectionProgress(ref, "enter");
  const p = animate ? enter : FULL;
  const beats: ProofBeats = {
    path: useRange(p, [0.1, 0.42], [0, 1]),
    set: useRange(p, [0.4, 0.52], [0, 1]),
    spent: useRange(p, [0.5, 0.6], [0, 1]),
    bound: useRange(p, [0.58, 0.72], [0, 1]),
    seal: useRange(p, [0.72, 0.84], [0, 1]),
  };
  return (
    <div ref={ref} className="relative -mx-3 mt-8 aspect-[1000/720] sm:mx-0 sm:mt-10">
      <ProofConstellation beats={beats} className="absolute inset-0" />
    </div>
  );
}

function StackedContent({ animate }: { animate: boolean }) {
  const listRef = useRef<HTMLDivElement>(null);
  // the statements light as the list rises from the bottom of the screen to its upper third
  const enter = useSectionProgress(listRef, "enter");
  const timeline = useRange<number>(enter, [0.04, 0.72], [0, 1]);
  return (
    <div className="relative z-10 mx-auto w-full max-w-[38rem] px-6 pb-[12vh] pt-[calc(12vh+1.5rem)] sm:px-10">
      <Heading />
      <StackedConstellation animate={animate} />
      <div ref={listRef} className="mt-10 [--tile:2.5rem] sm:[--tile:2.75rem]">
        <ProofList p={animate ? timeline : FULL} />
      </div>
    </div>
  );
}

/**
 * Phones and portrait tablets. The section is not pinned: its copy scrolls
 * over a sticky backdrop whose planes rise at their depth's pace (pinned
 * travel over the section). With reduced motion the backdrop simply covers
 * the section (no sticky, nothing moves).
 */
function Stacked({ animate }: { animate: boolean }) {
  const ref = useRef<HTMLElement>(null);
  const progress = useSectionProgress(ref, "pinned");
  return (
    <section ref={ref} id="proof" aria-labelledby={TITLE_ID} className="relative">
      {animate ? (
        <div className="sticky top-0 h-screen overflow-hidden supports-[height:100svh]:h-[100svh]">
          <SceneStage progress={progress} factor={0.8} className="h-full w-full">
            <StackedBackdrop />
          </SceneStage>
        </div>
      ) : (
        <SceneStage mode="static" frame={0.5} className="absolute inset-0">
          <StackedBackdrop still />
        </SceneStage>
      )}
      <div className={cn("relative", animate && "-mt-[100vh] supports-[height:100svh]:-mt-[100svh]")}>
        <StackedContent animate={animate} />
      </div>
    </section>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

export default function ProofScene() {
  const safe = useMotionSafe();
  const wide = useMedia("(min-width: 1024px)");
  // too short to pin the column under the nav pill: the still frame
  const short = useMedia("(max-height: 639px)");

  if (!wide) return <Stacked key={safe ? "move" : "still"} animate={safe} />;
  if (!safe || short) return <WideStill />;
  return (
    <PinnedScene id="proof" heightVh={180} labelledBy={TITLE_ID} fallback={<WideStill />}>
      {(progress) => <WideStage progress={progress} />}
    </PinnedScene>
  );
}
