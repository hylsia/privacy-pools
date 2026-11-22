/**
 * Landing hero v2 — "the vista", the first scene of the night journey and the
 * showcase of the scene kit (components/landing/scene).
 *
 * A moonlit range under a full moon, light ribbons drifting across the sky, a
 * sea of cloud between the ridges and the fox on a cloud bank, looking up at
 * the moon. The stage is pinned for 170vh (160 on tablets, 130 on phones);
 * as you scroll, the camera sinks: every plane rises at its own speed, back to
 * front (sky 3vh · far 8vh · mid 16vh · subject 24vh · near 42vh over the pin),
 * and from 72% of the pin the front cloud deck sweeps up over everything — the
 * dive into the clouds. Its underside (CloudSeam) hangs below the section over
 * the top of the pool scene, so the hand-off has no straight seam.
 *
 * Depth, back to front:
 *   NightSky (static) · sky: stars, moon · far: sparse stars, ribbons,
 *   sparkles, far ridge · mid: mid ridge, cloud sea (camera push-in) ·
 *   subject: the fox on its cloud bank · near: dark backlit cloud deck ·
 *   vignette + scrim (static) · copy (static) · scroll cue · front: CloudWipe
 *
 * The copy is static (never transformed or faded; only the final cloud deck
 * may cover it), so the Robinhood Chain plate is never moved, scaled or faded.
 * Pointer parallax on fine pointers. Phones get fewer planes and a shorter
 * pin; reduced motion and short viewports get the still composition (no pin,
 * no wipe). The stage body is keyed by tier so every range is constant per
 * mount. Once the dive's cloud wall hides the whole stage, the planes under it
 * stop drawing and looping (useDiveCover); nothing visible changes.
 */
import { useEffect, useRef, useState, type RefObject } from "react";
import { cancelFrame, frame, motion, useScroll, type MotionValue } from "framer-motion";
import { Link } from "wouter";
import { ArrowDown, ArrowRight, Check, Copy } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { FoxFigure } from "@/components/HeroMascot";
import { RobinhoodChainLogo } from "@/components/brand/RobinhoodChain";
import { PinnedScene, useMedia, useRange } from "@/components/landing/parallax";
import { SCENE_CTA_PRIMARY, SCENE_CTA_SECONDARY, SCENE_TYPE, SectionLink } from "@/components/landing/system";
import { PoolStatePill, primaryCta, usePoolStatus } from "@/components/landing/usePoolStatus";
import {
  CloudDeck,
  CloudIsland,
  CloudSeam,
  CloudWall,
  CloudWipe,
  Moon,
  NEAR_BANDS,
  NightSky,
  Ribbons,
  Ridge,
  SceneLayer,
  SceneSparkles,
  SceneStage,
  Scrim,
  Starfield,
  Vignette,
  useScene,
  type SceneSparkleSpec,
} from "@/components/landing/scene";
import { cn } from "@/lib/utils";

type Tier = "wide" | "tablet" | "phone";

/** Pin length per tier (vh) and how much of the spec's travel each tier uses. */
const PIN_VH: Record<Tier, number> = { wide: 170, tablet: 160, phone: 130 };
const FACTOR: Record<Tier, number> = { wide: 1, tablet: 0.9, phone: 0.75 };
/** The dive: the front deck rises over this slice of the pin. */
const WIPE: readonly [number, number] = [0.72, 1];
/** Class on the dive's cloud wall, so useDiveCover can find its top band. */
const WIPE_MARK = "hero-wipe";
/** The stage counts as covered once the wall's deepest gap is this far above the screen. */
const COVER_MARGIN_PX = 4;
/** The scroll cue has faded out by this progress. */
const CUE_GONE = 0.08;

/** Sparkles in the open sky, clear of the copy (left) and the moon (upper right). */
const SPARKLES_WIDE: SceneSparkleSpec[] = [
  { left: "52%", top: "13%", size: 15, tone: "gold", delay: 0 },
  { left: "61%", top: "31%", size: 8, tone: "white", delay: 1.6 },
  { left: "69%", top: "7%", size: 9, tone: "white", delay: 3.1 },
  { left: "97.5%", top: "53%", size: 12, tone: "white", delay: 2.4 },
  { left: "56%", top: "52%", size: 13, tone: "gold", delay: 0.9 },
];
const SPARKLES_STACKED: SceneSparkleSpec[] = [
  { left: "90%", top: "58%", size: 12, tone: "gold", delay: 0.4 },
  { left: "8%", top: "90%", size: 9, tone: "white", delay: 1.9 },
  { left: "62%", top: "66%", size: 8, tone: "white", delay: 3 },
];

// ─── Art ──────────────────────────────────────────────────────────────────────

/**
 * Every art plane of the hero. Bottom-anchored planes run on below the stage
 * (by more than their travel) and full-bleed planes overhang the sides by 32px,
 * so neither scroll travel nor pointer parallax ever uncovers an edge.
 */
function HeroArt({ tier }: { tier: Tier }) {
  const wide = tier === "wide";
  const phone = tier === "phone";
  return (
    <>
      <NightSky variant="deep" />

      {/* sky: the star field and the moon */}
      <SceneLayer depth="sky">
        <Starfield
          count={phone ? 90 : 160}
          seed={11}
          twinkle="one"
          className="absolute -inset-x-4 -top-4 h-[80%]"
        />
        {wide ? (
          <Moon className="absolute left-[83%] top-[26%] w-[44vw] max-w-[780px] -translate-x-1/2 -translate-y-1/2" />
        ) : (
          // stacked layouts: a crescent behind the fox, as in the artwork
          <Moon
            phase="crescent"
            className={cn(
              "absolute -translate-x-1/2 -translate-y-1/2",
              phone ? "left-[80%] top-[78%] w-[84vw]" : "left-[74%] top-[67%] w-[84vw]",
            )}
          />
        )}
      </SceneLayer>

      {/* far: sparse brighter stars, light ribbons, sparkles, the far range */}
      <SceneLayer depth="far">
        {!phone && (
          <Starfield count={44} seed={5} twinkle="none" className="absolute -inset-x-4 -top-4 h-[64%] opacity-80" />
        )}
        {wide && <Ribbons className="absolute right-[-6%] top-[2%] h-[88%] w-[66%]" />}
        <SceneSparkles items={wide ? SPARKLES_WIDE : SPARKLES_STACKED} />
        <Ridge
          tier={0}
          seed={4}
          rimAt={0.8}
          edgeHeight={phone ? "26vh" : "34vh"}
          className={cn("absolute -inset-x-8 -bottom-[14vh]", phone ? "top-[60%]" : "top-[46%]")}
        />
      </SceneLayer>

      {/* mid: the near range and the sea of cloud filling its valleys (slight camera push-in) */}
      <SceneLayer depth="mid" push={1.04} className="origin-[72%_100%]">
        <Ridge
          tier={1}
          seed={9}
          rimAt={0.78}
          edgeHeight={phone ? "20vh" : "30vh"}
          className={cn("absolute -inset-x-8 -bottom-[24vh]", phone ? "top-[70%]" : "top-[56%]")}
        />
        <CloudDeck
          tone="dim"
          rows={3}
          seed={5}
          puff={phone ? "large" : "medium"}
          edgeHeight={phone ? "18vh" : "24vh"}
          className={cn("absolute -inset-x-8 -bottom-[24vh]", phone ? "top-[82%]" : "top-[74%]")}
        />
      </SceneLayer>

      {/* subject: the fox on its cloud bank */}
      <SceneLayer depth="subject">
        <div
          className={cn(
            "absolute",
            wide && "bottom-[9%] right-[5%] w-[33vw] max-w-[600px]",
            tier === "tablet" && "bottom-[6%] right-[3%] w-[46vw]",
            phone && "bottom-[5%] right-[1%] w-[46vw]",
          )}
        >
          <span className="scene-glow scene-glow--violet" style={{ inset: "-6% -8% 4% -8%" }} />
          <FoxFigure className="relative w-full" />
          <CloudIsland tone="lit" rows={2} seed={9} className="absolute left-[-26%] top-[79%] w-[152%]" />
        </div>
      </SceneLayer>

      {/* near: a dark, backlit bank of cloud rising out of the bottom of the frame */}
      <SceneLayer depth="near">
        <CloudWall
          bands={NEAR_BANDS}
          seed={14}
          tone="near"
          edgeHeight={phone ? "20vh" : "24vh"}
          className={cn("absolute -inset-x-8 -bottom-[52vh]", phone ? "top-[92%]" : "top-[87%]")}
        />
      </SceneLayer>
    </>
  );
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

const HERO_CONTRACT_ADDRESS = "0xaecf9909e55f5e98b84a9a737db0238b87393e1a";

function HeroContractAddress() {
  const [status, setStatus] = useState<"ready" | "copied" | "error">("ready");

  useEffect(() => {
    if (status !== "copied") return;
    const timer = window.setTimeout(() => setStatus("ready"), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(HERO_CONTRACT_ADDRESS);
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="mt-5 sm:mt-6">
      <div className="inline-flex max-w-full items-center gap-3 rounded-xl border border-white/15 bg-black/20 py-2 pl-4 pr-2 text-white/80 backdrop-blur-sm">
        <span className="shrink-0 text-sm font-semibold tracking-wider text-white/50" title="Contract address">
          CA
        </span>
        <code className="min-w-0 select-all break-all font-mono text-sm leading-relaxed">
          {HERO_CONTRACT_ADDRESS}
        </code>
        <button
          type="button"
          onClick={copyAddress}
          aria-label={status === "copied" ? "Contract address copied" : "Copy contract address"}
          title={status === "copied" ? "Copied" : "Copy address"}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-white/65 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          {status === "copied" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </button>
      </div>
      <p role="status" className={status === "error" ? "mt-2 text-sm text-white/70" : "sr-only"}>
        {status === "copied" ? "Contract address copied." : status === "error" ? "Copy unavailable. Select the address to copy it." : ""}
      </p>
    </div>
  );
}

/**
 * Status pill, headline, lead, CTAs and the trust row. Static on purpose: no
 * motion, no reveal and no scroll transform, so it paints at once and the
 * Robinhood Chain plate keeps its size and full opacity everywhere.
 */
function HeroCopy() {
  const { state } = usePoolStatus();
  const cta = primaryCta(state);
  return (
    <div className="relative w-full max-w-[34rem] sm:max-w-[38rem] lg:max-w-[40rem] 2xl:max-w-[46rem]">

      <h1 id="hero-title" className={cn("mt-5 sm:mt-7", SCENE_TYPE.headline)}>
        Withdraw ETH with <span className="scene-text-glow">no link back</span> to your deposit.
      </h1>

      <p className={cn("mt-4 max-w-[33rem] sm:mt-6", SCENE_TYPE.lead)}>
        A privacy pool for testnet ETH. A zero-knowledge proof built in your browser hides which deposit paid — both
        transactions stay public.
      </p>

      <div className="mt-6 flex flex-wrap gap-3 sm:mt-9">
        <Button asChild size="lg" className={SCENE_CTA_PRIMARY}>
          <Link href={cta.href}>
            {cta.label}
            <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg" className={SCENE_CTA_SECONDARY}>
          <SectionLink to="pool">
            See how it works
            <ArrowDown className="ml-1 h-3.5 w-3.5" aria-hidden />
          </SectionLink>
        </Button>
      </div>
      <HeroContractAddress />
    </div>
  );
}

/**
 * Where the copy sits in the frame: top-left on phones and tablets, centred
 * on the left from lg. If keyboard focus lands in it while the dive covers it,
 * the page scrolls back to the top so the focused control is visible.
 */
function CopyFrame({ progress }: { progress?: MotionValue<number> }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      onFocus={() => {
        if (!progress || progress.get() < 0.5 || !ref.current) return;
        const top = ref.current.closest("section")?.getBoundingClientRect().top ?? 0;
        window.scrollTo({ top: Math.max(0, window.scrollY + top), behavior: "instant" });
      }}
      className="relative z-10 flex h-full w-full items-start px-6 pt-[92px] sm:px-10 sm:pt-28 lg:items-center lg:pb-14 lg:pt-24"
    >
      <div className="mx-auto w-full max-w-7xl">
        <HeroCopy />
      </div>
    </div>
  );
}

/** "Scroll" with a falling dot; fades out over the first 8% of the pin. From lg, and not on short screens. */
function ScrollCue() {
  const { progress } = useScene();
  const opacity = useRange(progress, [0, CUE_GONE], [1, 0]);
  return (
    <motion.div
      aria-hidden
      style={{ opacity }}
      className="pointer-events-none absolute inset-x-0 bottom-5 z-10 hidden flex-col items-center gap-2 lg:flex [@media(max-height:719px)]:hidden"
    >
      <span className="font-mono text-xs uppercase tracking-[0.24em] text-[color:rgb(201_204_255/0.78)]">Scroll</span>
      <span className="relative block h-9 w-px overflow-hidden bg-white/15">
        <span className="scene-cue-dot absolute left-0 top-0 block h-3 w-px bg-white" />
      </span>
    </motion.div>
  );
}

// ─── Stage ────────────────────────────────────────────────────────────────────

/** Lowest point of the top band's back-row edge, as a share of the band drawing's height (1 when unknown). */
function bandGapDepth(band: SVGSVGElement): number {
  try {
    const edge = band.querySelector<SVGGraphicsElement>("g > path");
    const height = band.viewBox.baseVal.height;
    if (!edge || !height) return 1;
    const box = edge.getBBox();
    return box.height > 0 ? Math.min(1, (box.y + box.height) / height) : 1;
  } catch {
    return 1;
  }
}

/**
 * Performance only: marks the stage while parts of it cannot be seen, and
 * nothing visible changes.
 *   data-covered  the dive's cloud wall covers the whole visible stage: the
 *                 deepest gap between the puffs of its top band (everything
 *                 below that line is solid cloud) has risen above the top of
 *                 the screen. scene.css then stops drawing the art planes,
 *                 drops their layers and stops their loops; the copy stays.
 *   data-cue-off  the scroll cue has faded out, so its dot stops falling.
 * Checked in the same frame, after framer has moved the wall (postRender), and
 * measured on the wall itself, so it holds on any screen shape: on very wide
 * screens the gaps only clear the top once the stage scrolls away after the pin.
 */
function useDiveCover(progress: MotionValue<number>, anchor: RefObject<HTMLElement | null>) {
  const { scrollY } = useScroll();
  useEffect(() => {
    const stage = anchor.current?.parentElement; // the anchor is a direct child of the SceneStage
    if (!stage) return;
    let band: SVGSVGElement | null = null;
    let gap: number | null = null;
    let queued = false;
    const check = () => {
      queued = false;
      const p = progress.get();
      stage.toggleAttribute("data-cue-off", p >= CUE_GONE);
      let covered = false;
      if (p >= WIPE[0]) {
        band ??= stage.querySelector<SVGSVGElement>(`.${WIPE_MARK} svg`);
        if (band) {
          gap ??= bandGapDepth(band);
          const box = band.getBoundingClientRect();
          covered = box.top + gap * box.height <= -COVER_MARGIN_PX;
        }
      }
      stage.toggleAttribute("data-covered", covered);
    };
    const queue = () => {
      if (queued) return;
      queued = true;
      frame.postRender(check);
    };
    queue();
    const stop = scrollY.on("change", queue);
    window.addEventListener("resize", queue);
    return () => {
      stop();
      window.removeEventListener("resize", queue);
      cancelFrame(check);
      stage.removeAttribute("data-covered");
      stage.removeAttribute("data-cue-off");
    };
  }, [progress, scrollY, anchor]);
}

/** The pinned stage. Keyed by tier in <Hero>, so its ranges are fixed per mount. */
function HeroStage({ tier, progress }: { tier: Tier; progress: MotionValue<number> }) {
  const copyRef = useRef<HTMLDivElement>(null);
  useDiveCover(progress, copyRef);
  return (
    <SceneStage progress={progress} factor={FACTOR[tier]} className="h-full w-full">
      <HeroArt tier={tier} />
      <Vignette strength={0.5} />
      <Scrim side={tier === "wide" ? "left" : "top"} />
      <div ref={copyRef} className="absolute inset-0">
        <CopyFrame progress={progress} />
      </div>
      <ScrollCue />
      <CloudWipe range={WIPE} className={WIPE_MARK} />
    </SceneStage>
  );
}

/**
 * The still composition: reduced motion and viewports under 620px tall. Not
 * pinned and at least one screen tall; the copy is in flow (so nothing is
 * clipped) with room under it for the fox on phones and tablets. No wipe and
 * no seam over the next section: the near clouds sink into the night instead.
 * (Grid, not flex, for the min-height: index.css zeroes min-height on .flex.)
 */
function HeroStill({ tier }: { tier: Tier }) {
  return (
    <section id="top" aria-labelledby="hero-title" className="relative z-20">
      <SceneStage mode="static" className="min-h-[100svh]">
        <HeroArt tier={tier} />
        <Vignette strength={0.5} />
        <Scrim side={tier === "wide" ? "left" : "top"} />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[16%] bg-[linear-gradient(to_bottom,transparent,var(--night-1))]"
        />
        <div
          className={cn(
            "relative z-10 px-6 pt-[92px] sm:px-10 sm:pt-28",
            tier === "wide" ? "grid min-h-[100svh] items-center pb-20 lg:pt-24" : "pb-[56vw]",
          )}
        >
          <div className="mx-auto w-full max-w-7xl">
            <HeroCopy />
          </div>
        </div>
      </SceneStage>
    </section>
  );
}

export default function Hero() {
  const wide = useMedia("(min-width: 1024px)");
  const phone = useMedia("(max-width: 639px)");
  // too short for the copy to sit in a pinned frame: use the still composition
  const short = useMedia("(max-height: 619px)");
  const tier: Tier = wide ? "wide" : phone ? "phone" : "tablet";

  if (short) return <HeroStill tier={tier} />;
  return (
    <PinnedScene
      id="top"
      heightVh={PIN_VH[tier]}
      labelledBy="hero-title"
      className="z-20"
      fallback={<HeroStill tier={tier} />}
      outside={<CloudSeam tone="wipe" />}
    >
      {(progress) => <HeroStage key={tier} tier={tier} progress={progress} />}
    </PinnedScene>
  );
}
