/**
 * Closing scene (#start) — "Dawn", the last scene of the night journey.
 *
 * A pass-through scene (about 110vh, taller on phones where the copy stacks):
 * the night thins into dawn. Stars fade towards a warm lavender and gold glow
 * on the horizon, a low full moon sets behind the far range, a sea of cloud
 * catches the first light between the ridges, and the fox sits small on a
 * cloud bank at the edge of the range, looking up. The footer's dark hills
 * (Chrome.tsx, HorizonEdge) rise over the bottom edge: the page ends on solid
 * ground.
 *
 * Depth, back to front (pass-through speeds as a fraction of the scroll, with
 * the stage's factor; content moves at 1):
 *   NightSky dawn (static) · sky: stars, moon · far: sparkles, horizon glow,
 *   far ridge · mid: near ridge, cloud sea · subject: the fox on its cloud ·
 *   near: the cloud floor · front: low mist · vignette, scrim, top fade
 *   (static) · copy (static)
 * Every plane is slower than the copy, so the landscape settles under the copy
 * as it arrives, and the moon sets while the footer rises. The horizon glow
 * brightens over the pass (opacity only): the sun comes up as the page ends.
 *
 * The copy is centred and static: eyebrow, the status-aware headline, one
 * line, three glass steps (introduced with "Once it is live:" before launch),
 * the actions (the status-aware primary action and the faucet) and the honesty
 * footnote. Bright art (moon, fox, lit clouds)
 * stays out of the copy's column on wide screens and well below it on stacked
 * layouts, so the copy keeps its contrast through the whole pass.
 *
 * Reduced motion: the still frame of the same composition (no travel, no
 * pointer parallax, the glow at full strength). The stage body is keyed by
 * tier and motion, so every range is constant per mount.
 */
import { Link } from "wouter";
import { motion } from "framer-motion";
import { ArrowDownToLine, ArrowRight, ArrowUpRight, FlaskConical, KeyRound, Send, type IconType } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useMedia, useMotionSafe, useRange } from "@/components/landing/parallax";
import { SCENE_CTA_PRIMARY, SCENE_CTA_SECONDARY, SCENE_TYPE } from "@/components/landing/system";
import { CHAIN_ID, FAUCET_URL } from "@/components/landing/links";
import { primaryCta, usePoolStatus } from "@/components/landing/usePoolStatus";
import {
  CloudDeck,
  CloudIsland,
  Fog,
  Moon,
  NightSky,
  Ridge,
  SceneLayer,
  SceneSparkles,
  SceneStage,
  Scrim,
  Starfield,
  Vignette,
  useScene,
  type FogBandSpec,
  type SceneSparkleSpec,
} from "@/components/landing/scene";
import { DAWN_FLOOR, DAWN_SEA, DawnGlow, DawnRays, DawnWisps } from "@/components/landing/scene/closing-dawn";
import { cn } from "@/lib/utils";

type Tier = "wide" | "tablet" | "phone";

/**
 * Travel multiplier per tier. The scene is the last before the footer, so the
 * page ends about a quarter of the way past its natural frame; at full travel
 * the far planes would have sunk out of sight by then.
 */
const FACTOR: Record<Tier, number> = { wide: 0.45, tablet: 0.4, phone: 0.35 };

// ─── Copy ─────────────────────────────────────────────────────────────────────

const STEPS: readonly { icon: IconType; title: string }[] = [
  { icon: KeyRound, title: "Create a vault and verify the backup" },
  { icon: ArrowDownToLine, title: "Deposit testnet ETH" },
  { icon: Send, title: "Withdraw through the relayer" },
];

/**
 * Glass over the night sky: a faint lavender sheen, a hairline and a lit top
 * edge. Faked, with no backdrop-filter: the sky behind the steps moves, so a
 * blur would repaint every frame and give each step a compositing layer. The
 * gradient is the blurred look baked in (the tint over the sky's average
 * colour) and nearly opaque, so no star shows through.
 */
const GLASS =
  "rounded-2xl border border-white/[0.13] bg-[linear-gradient(160deg,rgb(37_41_84/0.92),rgb(19_23_62/0.92)_46%,rgb(13_16_51/0.93))] shadow-[inset_0_1px_0_rgb(255_255_255/0.09),0_22px_48px_-28px_rgb(4_5_26/0.95)]";

function Steps({ labelledBy }: { labelledBy?: string }) {
  return (
    <ol aria-labelledby={labelledBy} className="mx-auto grid w-full max-w-[22rem] gap-2.5 text-left sm:max-w-[52rem] sm:grid-cols-3 sm:gap-7">
      {STEPS.map((step, i) => (
        <li key={step.title} className={cn("relative flex items-center gap-3.5 p-3.5 sm:p-4", GLASS)}>
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[rgb(174_180_255/0.12)] text-[color:var(--lavender)] ring-1 ring-[rgb(174_180_255/0.28)]"
          >
            <step.icon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            {/* the list already numbers the steps for assistive tech */}
            <span aria-hidden className="block font-mono text-xs tracking-[0.16em] text-[color:rgb(174_180_255/0.9)]">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="mt-0.5 block text-[15px] font-medium leading-snug text-[color:var(--ink)]">{step.title}</span>
          </span>
          {/* the path between steps: a small chevron in the gutter (from sm), a hairline between stacked cards (phones) */}
          {i < STEPS.length - 1 && (
            <>
              <span
                aria-hidden
                className="absolute -right-[22px] top-1/2 hidden h-4 w-4 -translate-y-1/2 place-items-center text-[color:rgb(174_180_255/0.7)] sm:grid"
              >
                <ArrowRight className="h-3 w-3" />
              </span>
              <span
                aria-hidden
                className="absolute -bottom-2.5 left-[2.15rem] h-2.5 w-px bg-[linear-gradient(to_bottom,rgb(174_180_255/0.45),rgb(174_180_255/0.1))] sm:hidden"
              />
            </>
          )}
        </li>
      ))}
    </ol>
  );
}

function ClosingCopy() {
  const { state } = usePoolStatus();
  const live = state === "live";
  const pending = state === "pending";
  const cta = primaryCta(state);
  return (
    <div className="mx-auto flex w-full max-w-[60rem] flex-col items-center text-center">
      <p className={SCENE_TYPE.eyebrow}>Get started</p>
      <h2 id="start-title" className={cn("mt-4 sm:mt-5", SCENE_TYPE.headline)}>
        {live ? (
          <>
            Try it with <span className="scene-text-glow">testnet ETH.</span>
          </>
        ) : pending ? (
          <>
            Explore the app <span className="scene-text-glow">before launch.</span>
          </>
        ) : (
          <>Explore <span className="scene-text-glow">Hylsia.</span></>
        )}
      </h2>
      <p className={cn("mt-4 max-w-[38rem] sm:mt-6", SCENE_TYPE.lead)}>
        {live
          ? "Watch a proof get built on your own device, then check the explorer yourself."
          : pending
            ? "The pool is not deployed yet. Look around the dashboard and your vault, and get testnet ETH ready for when it goes live."
            : state === "loading"
              ? "Checking the pool's live status. Explore the dashboard while it loads. Use testnet ETH only."
              : "The pool's live status is unavailable right now. Check the dashboard for the latest information. Use testnet ETH only."}
      </p>

      <div className="mt-8 w-full sm:mt-10">
        {/* before launch the steps are what comes once the pool is live, not things to do now */}
        {!live && (
          <p id="start-steps-label" className="mb-3 text-sm font-medium text-[color:rgb(201_204_255/0.86)] sm:mb-4">
            {pending ? "Once it is live:" : "When the pool is available:"}
          </p>
        )}
        <Steps labelledBy={live ? undefined : "start-steps-label"} />
      </div>

      <div className="mt-8 flex w-full max-w-[22rem] flex-col gap-3 sm:mt-10 sm:w-auto sm:max-w-none sm:flex-row sm:justify-center">
        <Button asChild size="lg" className={cn(SCENE_CTA_PRIMARY, "w-full sm:w-auto")}>
          <Link href={cta.href}>
            {cta.label}
            <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg" className={cn(SCENE_CTA_SECONDARY, "w-full sm:w-auto")}>
          <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
            Get testnet ETH
            {/* size-3.5, not h/w: the Button sizes any svg without a size-* class to 16px */}
            <ArrowUpRight className="ml-1 size-3.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Button>
      </div>

      <p className={cn("mt-6 flex max-w-[34rem] items-start justify-center gap-2 sm:mt-7 sm:items-center", SCENE_TYPE.caption)}>
        <FlaskConical className="mt-0.5 h-3.5 w-3.5 shrink-0 sm:mt-0" aria-hidden />
        <span>
          Built for <span className="whitespace-nowrap">Robinhood Chain Testnet</span>{" "}
          <span className="whitespace-nowrap">(chain {CHAIN_ID}) ·</span>{" "}
          <span className="whitespace-nowrap">testnet ETH only ·</span> <span className="whitespace-nowrap">not audited</span>
        </span>
      </p>
    </div>
  );
}

// ─── Art ──────────────────────────────────────────────────────────────────────

const SPARKLES: Record<Tier, SceneSparkleSpec[]> = {
  wide: [
    { left: "11%", top: "16%", size: 15, tone: "gold", delay: 0.6 },
    { left: "88%", top: "12%", size: 9, tone: "white", delay: 2.2 },
    { left: "84%", top: "38%", size: 12, tone: "white", delay: 3.6 },
    { left: "16%", top: "44%", size: 8, tone: "white", delay: 1.4 },
  ],
  tablet: [
    { left: "8%", top: "9%", size: 12, tone: "gold", delay: 0.6 },
    { left: "92%", top: "20%", size: 9, tone: "white", delay: 2.2 },
  ],
  phone: [
    { left: "88%", top: "6%", size: 11, tone: "gold", delay: 0.6 },
    { left: "7%", top: "30%", size: 8, tone: "white", delay: 2.2 },
  ],
};

/** Low mist over the cloud floor (front plane). */
const MIST: FogBandSpec[] = [
  { top: "calc(100% - 12vh)", height: "16vh", alpha: 0.12, tone: "mist" },
  { top: "calc(100% - 7vh)", height: "12vh", left: "-10%", width: "120%", alpha: 0.1 },
];

/**
 * The glow that brightens as the page ends (opacity only). Reads the stage's
 * progress; in a still frame it is simply at full strength. It keeps its own
 * layer only while it can change: not in a still frame, and not while Landing
 * marks the block idle (data-idle, far from the screen).
 */
function Sunrise({ className }: { className: string }) {
  const { progress, mode } = useScene();
  const opacity = useRange(progress, [0.3, 0.78], mode === "static" ? [1, 1] : [0.35, 1]);
  return (
    <motion.div
      aria-hidden
      style={{ opacity }}
      className={cn("absolute", mode !== "static" && "will-change-[opacity] [[data-idle]_&]:will-change-auto", className)}
    >
      <DawnGlow className="inset-0" />
    </motion.div>
  );
}

/**
 * Where each plane sits per tier, measured up from the stage's bottom edge (the
 * copy above is in flow, so a taller copy simply pushes the land down). The
 * moon and the fox stay out of the copy's column on wide screens, and far
 * enough below it on stacked layouts that they never pass behind it.
 */
const PLACE: Record<
  Tier,
  { moon: string; rays: string; wisps: string; bloom: string; sunrise: string; far: string; mid: string; sea: string; fox: string; floor: string }
> = {
  wide: {
    moon: "left-[87%] top-[calc(100%-27vh)] w-[25vw] max-w-[480px]",
    rays: "left-[-10%] w-[120%] top-[calc(100%-96vh)] h-[68vh]",
    wisps: "inset-x-0 top-[calc(100%-53vh)] h-[19vh]",
    bloom: "top-[calc(100%-52vh)] h-[44vh]",
    sunrise: "top-[calc(100%-43vh)] h-[30vh]",
    far: "top-[calc(100%-45vh)]",
    mid: "top-[calc(100%-36vh)]",
    sea: "top-[calc(100%-25vh)]",
    fox: "left-[3%] top-[calc(100%-31vh)] w-[11vw] max-w-[210px]",
    floor: "top-[calc(100%-13vh)]",
  },
  tablet: {
    moon: "left-[86%] top-[calc(100%-27vh)] w-[30vw] max-w-[360px]",
    rays: "left-[-10%] w-[120%] top-[calc(100%-80vh)] h-[58vh]",
    wisps: "inset-x-0 top-[calc(100%-40vh)] h-[14vh]",
    bloom: "top-[calc(100%-40vh)] h-[34vh]",
    sunrise: "top-[calc(100%-34vh)] h-[24vh]",
    far: "top-[calc(100%-33vh)]",
    mid: "top-[calc(100%-25vh)]",
    sea: "top-[calc(100%-18vh)]",
    fox: "left-[5%] top-[calc(100%-27vh)] w-[17vw] max-w-[200px]",
    floor: "top-[calc(100%-10vh)]",
  },
  phone: {
    moon: "left-[79%] top-[calc(100%-31vh)] w-[50vw]",
    rays: "left-[-40%] w-[180%] top-[calc(100%-70vh)] h-[52vh]",
    wisps: "-inset-x-[30%] top-[calc(100%-36vh)] h-[10vh]",
    bloom: "top-[calc(100%-36vh)] h-[30vh]",
    sunrise: "top-[calc(100%-31vh)] h-[20vh]",
    far: "top-[calc(100%-30vh)]",
    mid: "top-[calc(100%-22vh)]",
    sea: "top-[calc(100%-15vh)]",
    fox: "left-[4%] top-[calc(100%-25vh)] w-[30vw]",
    floor: "top-[calc(100%-8vh)]",
  },
};

/** Every plane of the scene, back to front. */
function DawnArt({ tier }: { tier: Tier }) {
  const phone = tier === "phone";
  const at = PLACE[tier];
  return (
    <>
      <NightSky variant="dawn" />

      {/* sky: stars thinning towards the dawn, and the low moon setting behind the far range */}
      <SceneLayer depth="sky">
        <div className="absolute -inset-x-4 top-0 h-[74%] [mask-image:linear-gradient(to_bottom,#000_0%,#000_45%,transparent_100%)]">
          <Starfield count={phone ? 70 : 130} seed={41} twinkle="one" className="absolute inset-0 h-full w-full" />
        </div>
        <div className="absolute inset-0 opacity-90">
          <Moon seed={5} className={cn("absolute -translate-x-1/2 -translate-y-1/2", at.moon)} />
        </div>
      </SceneLayer>

      {/* far: sparkles, the dawn on the horizon (a steady bloom + the sunrise that brightens), the far range */}
      <SceneLayer depth="far">
        <DawnRays className={at.rays} />
        <SceneSparkles items={SPARKLES[tier]} />
        <DawnWisps className={at.wisps} />
        <DawnGlow className={cn("left-[-10%] w-[120%]", at.bloom)} style={{ opacity: 0.55 }} />
        <Sunrise className={cn("left-[8%] w-[84%]", at.sunrise)} />
        <Ridge
          tier={0}
          seed={12}
          peaks={phone ? 3 : 4}
          rimAt={0.52}
          edgeHeight={phone ? "18vh" : "22vh"}
          className={cn("absolute -inset-x-8 -bottom-[12vh]", at.far)}
        />
      </SceneLayer>

      {/* mid: the nearer range and the sea of cloud in its valleys, catching the light */}
      <SceneLayer depth="mid">
        <Ridge
          tier={1}
          seed={3}
          peaks={phone ? 4 : 5}
          rimAt={0.5}
          edgeHeight={phone ? "15vh" : "18vh"}
          className={cn("absolute -inset-x-8 -bottom-[12vh]", at.mid)}
        />
        <CloudDeck
          palette={DAWN_SEA}
          rows={phone ? 3 : 4}
          seed={8}
          puff={phone ? "medium" : "small"}
          edgeHeight={phone ? "11vh" : "15vh"}
          className={cn("absolute -inset-x-8 -bottom-[12vh]", at.sea)}
        />
      </SceneLayer>

      {/* subject: the fox, small on a cloud bank at the edge of the range, looking up at the sky */}
      <SceneLayer depth="subject">
        <div className={cn("absolute", at.fox)}>
          <span className="scene-glow scene-glow--violet" style={{ inset: "-10% -14% 6% -14%" }} />
          <img
            src="/hypechan/fox-full.webp"
            alt=""
            width={1233}
            height={1236}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="relative block h-auto w-full select-none"
          />
          <CloudIsland tone="lit" rows={2} seed={4} className="absolute left-[-34%] top-[80%] w-[168%]" />
        </div>
      </SceneLayer>

      {/* near: the cloud floor, backlit by the dawn */}
      <SceneLayer depth="near">
        <CloudDeck
          palette={DAWN_FLOOR}
          tone="near"
          rows={3}
          seed={17}
          puff="large"
          edgeHeight={phone ? "9vh" : "12vh"}
          className={cn("absolute -inset-x-8 -bottom-[14vh]", at.floor)}
        />
      </SceneLayer>

      {/* front: low mist drifting over the floor */}
      <SceneLayer depth="front">
        <Fog bands={MIST} />
      </SceneLayer>
    </>
  );
}

// ─── Stage ────────────────────────────────────────────────────────────────────

/**
 * The scene. The copy is in flow at the top; the bottom padding is the land
 * the art is anchored to, and min-h keeps the scene about 110vh tall.
 */
function DawnStage({ tier, still }: { tier: Tier; still: boolean }) {
  return (
    <SceneStage
      as="section"
      id="start"
      aria-labelledby="start-title"
      mode={still ? "static" : "through"}
      factor={FACTOR[tier]}
      className="relative min-h-[110vh]"
    >
      <DawnArt tier={tier} />
      <Vignette strength={0.42} />
      {/* legibility pool behind the copy (the scrim fills its box), and the hand-off from the page's night at the top edge */}
      <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0", tier === "phone" ? "h-[76%]" : "h-[70%]")}>
        <Scrim side="center" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[16vh] bg-[linear-gradient(to_bottom,var(--night-1),rgb(10_12_42/0.6)_45%,transparent)]"
      />
      <div
        className={cn(
          "relative z-10 px-6 sm:px-10",
          tier === "wide" && "pb-[44vh] pt-[max(12vh,6.75rem)]",
          tier === "tablet" && "pb-[40vh] pt-[max(12vh,6.75rem)]",
          tier === "phone" && "pb-[40vh] pt-24",
        )}
      >
        <ClosingCopy />
      </div>
    </SceneStage>
  );
}

export default function Cta() {
  const safe = useMotionSafe();
  const wide = useMedia("(min-width: 1280px)");
  const phone = useMedia("(max-width: 639px)");
  const tier: Tier = wide ? "wide" : phone ? "phone" : "tablet";
  return <DawnStage key={`${tier}${safe ? "" : "-still"}`} tier={tier} still={!safe} />;
}
