/**
 * Landing section "Built in, not promised" (#design) — the first calm band
 * after the fog, still part of the night journey.
 *
 * A pass-through vista: the fog has lifted and the pool stands far away in a
 * valley of a moonlit ridge — the two violet monoliths with their gold
 * diamond, a full moon rising behind them between two peaks — while ranges of
 * ridges and mist step down towards the viewer. Over it float six night-glass
 * cards (one guarantee each, one line), the owner's powers as two short lists
 * and the mid-page call to action. As the band scrolls on, the near range
 * rises in front of the pool and the moon, so the vista never lingers under
 * the next band.
 *
 * Depth, back to front (pass-through rates, spec §3):
 *   sky 0.06   the band sky and the stars
 *   far 0.14   the far ridge with the moon and the pool in its valley, a sparkle
 *   mid 0.28   mist, the middle range, more mist
 *   near 0.6   the near range, sinking into the night at the bottom
 *   static     vignette, scrim, night blends at both edges, the copy and glass
 *
 * Wide screens draw every plane behind the whole band, placed so the vista
 * composes the same at any wide size (see WIDE_TOP). Tablets and phones are
 * much taller than a screen, so there the vista and the header get their own
 * small pass-through stage (VistaWindow) on top of a calmer backdrop.
 *
 * The copy and the glass are never transformed or faded. There is no
 * Robinhood Chain mark in this band. Stages are keyed by tier and reduced
 * motion, so their ranges are constant per mount; with reduced motion the
 * band is the still composition (every plane at rest where it is seen).
 */
import type { CSSProperties, ReactNode } from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  ArrowUpRight,
  DoorOpen,
  FileCheck2,
  FlaskConical,
  Link2,
  Lock,
  ShieldCheck,
  Users,
  X,
  type IconType,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useMedia, useMotionSafe } from "@/components/landing/parallax";
import { Container, SCENE_CTA_PRIMARY, SCENE_CTA_SECONDARY, SCENE_TYPE, SECTION_X } from "@/components/landing/system";
import { FAUCET_URL, ROBINHOOD_NETWORK } from "@/components/landing/links";
import { primaryCta, usePoolStatus } from "@/components/landing/usePoolStatus";
import { formatDelay } from "@shared/privacy/screening";
import {
  Monoliths,
  Moon,
  Ridge,
  SceneLayer,
  SceneSparkles,
  SceneStage,
  Starfield,
  Vignette,
  useScene,
  type SceneSparkleSpec,
} from "@/components/landing/scene";
import { BandSky, MistBand, NightBlend } from "@/components/landing/scene/bands-art";
import { BAND_TYPE, GLASS, GLASS_HOVER, GlassLight, GlassPane, GlyphTile } from "@/components/landing/scene/bands-ui";
import { cn } from "@/lib/utils";

type Tier = "wide" | "tablet" | "phone";

/** How much of the spec's pass-through travel each tier uses (tall stacked layouts travel less). */
const FACTOR: Record<Tier, number> = { wide: 1, tablet: 0.6, phone: 0.3 };

// ─── Copy ─────────────────────────────────────────────────────────────────────

interface Guarantee {
  icon: IconType;
  title: string;
  line: string;
}

/**
 * The six guarantees, one short line each (condensed from the v1 copy; the FAQ
 * carries the detail). Each claims no more than holds: services get proofs and
 * public inputs but can still see your IP (FAQ), and the association set
 * follows the screening policy (/pools/screening): a deposit joins after the
 * network's inclusion delay unless the operator's public exclusion list names
 * it. The delay here is the registry's for Robinhood Chain Testnet (the landing
 * fetches no association-set status).
 */
const GUARANTEES: Guarantee[] = [
  {
    icon: Lock,
    title: "Secrets stay on your device",
    line: "Services get proofs and public inputs, never your seed or note secrets.",
  },
  {
    icon: Link2,
    title: "Proofs that cannot be redirected",
    line: "The relayer can delay a withdrawal, never reroute it.",
  },
  {
    icon: Users,
    title: "Association sets, not blind mixing",
    line: `Private withdrawals prove the deposit belongs to a published set. On testnet a deposit becomes eligible ${formatDelay(ROBINHOOD_NETWORK.aspInclusionDelaySeconds)} after its block time, then waits for a root that includes it, unless excluded.`,
  },
  {
    icon: DoorOpen,
    title: "An exit that needs no one",
    line: "The public exit needs no ASP approval: it requires an unspent note, its proof, the depositor wallet and gas. See the known reuse limitation in the docs.",
  },
  {
    icon: FileCheck2,
    title: "Recovery you have already tested",
    line: "Notes, change and recoverable balance are rebuilt from the backup and chain. The full local activity log is not in the backup.",
  },
  {
    icon: FlaskConical,
    title: "Open, tested, honest about limits",
    line: "Real proofs, tested end-to-end on a local chain. Not audited.",
  },
];

/** Administrative powers, as disclosed in docs/privacy-pools/README.md (same facts as v1). */
const OWNER_CAN = [
  "Stop new deposits",
  "Set the minimum deposit",
  "Choose who publishes the association-set root",
  "Transfer ownership",
];
const OWNER_CANNOT = ["Move funds", "Pause withdrawals", "Upgrade the contracts"];
const SETUP_NOTE = "The Groth16 setup is a development setup, suitable for testnet only.";

// ─── Art ──────────────────────────────────────────────────────────────────────

/**
 * A few twinkling sparkles in the open sky (each one is its own compositing
 * layer while it twinkles, so they are few, and drawn above the ridges so no
 * ridge has to be lifted onto a layer of its own).
 */
const SPARKLES: Record<Tier, SceneSparkleSpec[]> = {
  wide: [{ left: "58%", top: "12%", size: 13, tone: "gold", delay: 0.6 }],
  tablet: [{ left: "86%", top: "9%", size: 12, tone: "gold", delay: 0.6 }],
  phone: [{ left: "84%", top: "7%", size: 11, tone: "gold", delay: 0.6 }],
};

/**
 * Where the pool stands. The far ridge (seed 4) has a valley at drawing x 1250
 * (crest y 234 of 400) between two peaks; phones and tablets use its central
 * valley (x 800, y 236). The ridge box is a size container, so the drawing
 * height D (max(edge, box width / 4)) and every position below are written in
 * cqw and stay locked to the drawing at any width.
 */
const VALLEY: Record<Tier, { left: string; d: string; edge: string; moon: string; pool: string }> = {
  // D = 25cqw (width-driven); x = 50% + (1250 − 800) / 1600 of the box
  wide: { left: "78.125%", d: "25cqw", edge: "0px", moon: "34cqw", pool: "5.2cqw" },
  tablet: { left: "50%", d: "max(20vh, 25cqw)", edge: "20vh", moon: "50cqw", pool: "8cqw" },
  phone: { left: "50%", d: "max(17vh, 25cqw)", edge: "17vh", moon: "68cqw", pool: "11cqw" },
};
/** valley floor (crest y / 400) and the share of the pillars' height that stands below it */
const VALLEY_Y = 0.585;
const POOL_SINK = 0.2;
/** height ÷ width of Monoliths with extend 160 ((840 + 160 + 4 − 96) / 660) */
const POOL_RATIO = 1.376;

/**
 * The far plane's subject: the moon rising out of a valley of the far ridge
 * and the pool (the logo's monoliths with their diamond) standing in it. One
 * size container, so the three stay locked together at any width, and all
 * static inside the far plane (no bob: at this distance it would only cost a
 * compositing layer). `className` / `style` place the box (its top edge is the
 * top of the ridge drawing).
 */
function PoolOnRidge({ tier, className, style }: { tier: Tier; className?: string; style?: CSSProperties }) {
  const v = VALLEY[tier];
  return (
    <div className={cn("@container absolute -inset-x-8 -bottom-[40vh]", className)} style={style}>
      <Moon
        seed={7}
        className="absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: v.left, width: v.moon, top: `calc(${v.d} * ${VALLEY_Y} - ${v.moon} * 0.14)` }}
      />
      <Monoliths
        extend={160}
        bob={false}
        className="absolute -translate-x-1/2"
        style={{
          left: v.left,
          width: v.pool,
          top: `calc(${v.d} * ${VALLEY_Y} - ${v.pool} * ${(POOL_RATIO * (1 - POOL_SINK)).toFixed(3)})`,
        }}
      />
      <Ridge tier={0} seed={4} rimAt={tier === "wide" ? 0.8 : 0.56} edgeHeight={v.edge} className="absolute inset-0" />
    </div>
  );
}

/**
 * Wide screens: where each plane is drawn. A pass-through plane at speed r is
 * offset by (1 − r)(V − H)/2 when the band's top reaches the screen top (V the
 * screen, H the band), and the band's height relative to the screen varies a
 * lot across wide screens (1024×768 … 2560×1440). So each top is written as
 * "where it should be on screen at that moment" (vh + px, under the header)
 * plus (1 − r)/2 · (H − V), i.e. `a% − a·vh`: the vista composes the same at
 * every wide size. Calibrated at 1440×900.
 */
const WIDE_TOP = {
  /** the far ridge box: valley floor at 15vh + 200px, minus 0.585 × the drawing height (25vw + 16px) */
  pool: "calc(43% - 28vh + 190.6px - 14.625vw)",
  fogFar: "calc(36% - 21vh + 133px)",
  mid: "calc(36% - 21vh + 77px)",
  fogMid: "calc(36% - 21vh + 256px)",
  near: "calc(20% - 5vh + 246px)",
} as const;
/** The still frame (reduced motion) has no offsets: the same on-screen positions without the compensation. */
const WIDE_TOP_STILL: Record<keyof typeof WIDE_TOP, string> = {
  pool: "calc(15vh + 190.6px - 14.625vw)",
  fogFar: "calc(15vh + 133px)",
  mid: "calc(15vh + 77px)",
  fogMid: "calc(15vh + 256px)",
  near: "calc(15vh + 246px)",
};

/**
 * Wide screens: the vista behind the whole band, back to front. Full-bleed
 * planes overhang the sides by 32px and run on below the stage, so neither
 * the scroll travel nor pointer parallax ever uncovers an edge.
 */
function VistaArt() {
  const top = useScene().mode === "static" ? WIDE_TOP_STILL : WIDE_TOP;
  return (
    <>
      {/* sky: the band sky, the stars and light ribbons drifting high over the pool, as over the hero's moon */}
      <SceneLayer depth="sky">
        <BandSky variant="vista" />
        <Starfield count={120} seed={23} twinkle="none" className="absolute -inset-x-4 top-0 h-[50%]" />
      </SceneLayer>

      {/* far: the moon, the pool and the far ridge as one plane, sparkles above */}
      <SceneLayer depth="far">
        <PoolOnRidge tier="wide" style={{ top: top.pool }} />
        <SceneSparkles items={SPARKLES.wide} />
      </SceneLayer>

      {/* mid: mist over the far ridge's foot, the middle range (low where the pool stands), more mist */}
      <SceneLayer depth="mid">
        <MistBand top={top.fogFar} height="20vh" alpha={0.13} tone="mist" />
        <div className="absolute -inset-x-8 -bottom-[50vh]" style={{ top: top.mid }}>
          <Ridge tier={1} seed={3} rimAt={0.74} className="absolute inset-0" />
        </div>
        <MistBand top={top.fogMid} height="17vh" alpha={0.1} />
      </SceneLayer>

      {/* near: the closest range. It rises in front of the pool as the band scrolls on, and sinks into the night below */}
      <SceneLayer depth="near">
        <div className="absolute -inset-x-8 -bottom-[70vh]" style={{ top: top.near }}>
          <Ridge tier={2} seed={14} rimAt={0.72} className="absolute inset-0" />
        </div>
      </SceneLayer>
    </>
  );
}

/** Stacked layouts: height of the vista window above the header. */
const WINDOW: Record<Exclude<Tier, "wide">, string> = { tablet: "34vh", phone: "33vh" };

/**
 * Stacked layouts, the vista window: the far ridge's valley floor sits on the
 * bottom of the window, the moon rising behind the pool, and the middle range
 * behind the header. Drawn inside VistaWindow's own stage.
 */
function WindowArt({ tier }: { tier: Exclude<Tier, "wide"> }) {
  const v = VALLEY[tier];
  const win = WINDOW[tier];
  // the far ridge box's width is 100vw + 64px, so D = max(edge, 25vw + 16px)
  const d = tier === "phone" ? "max(17vh, 25vw + 16px)" : "max(20vh, 25vw + 16px)";
  return (
    <>
      <SceneLayer depth="sky">
        <BandSky variant="vista" className="-bottom-[60vh] -top-[60vh]" />
        <Starfield count={tier === "phone" ? 60 : 90} seed={23} twinkle="none" className="absolute -inset-x-4 top-0 h-[42%]" />
      </SceneLayer>
      <SceneLayer depth="far">
        {/* the valley floor 6vh above the header */}
        <PoolOnRidge tier={tier} style={{ top: `calc(${win} - 6vh - ${d} * ${VALLEY_Y})` }} />
        <SceneSparkles items={SPARKLES[tier]} />
      </SceneLayer>
      <SceneLayer depth="mid">
        <MistBand top={`calc(${win} - 11vh)`} height="12vh" alpha={0.13} tone="mist" />
        <div className="absolute -inset-x-8 -bottom-[50vh]" style={{ top: `calc(${win} - 2vh)` }}>
          <Ridge tier={1} seed={3} rimAt={0.6} edgeHeight={tier === "phone" ? "15vh" : "18vh"} className="absolute inset-0" />
        </div>
      </SceneLayer>
    </>
  );
}

/**
 * Stacked layouts, behind the glass: the band sky, stars, mist and two dark
 * ranges, the nearer one sinking into the night at the bottom.
 */
function BackdropArt({ tier }: { tier: Exclude<Tier, "wide"> }) {
  const phone = tier === "phone";
  return (
    <>
      <SceneLayer depth="sky">
        <BandSky variant="vista" className="-top-[10vh]" />
        <Starfield count={phone ? 50 : 80} seed={31} twinkle="none" className="absolute -inset-x-4 top-[30%] h-[40%] opacity-70" />
      </SceneLayer>
      <SceneLayer depth="mid">
        <MistBand top="40%" height="12%" alpha={0.1} tone="mist" />
        <Ridge tier={1} seed={11} rimAt={0.3} edgeHeight={phone ? "15vh" : "18vh"} className="absolute -inset-x-8 -bottom-[50vh] top-[46%]" />
      </SceneLayer>
      <SceneLayer depth="near">
        <Ridge tier={2} seed={14} rimAt={0.7} edgeHeight={phone ? "13vh" : "16vh"} className="absolute -inset-x-8 -bottom-[70vh] top-[68%]" />
      </SceneLayer>
    </>
  );
}

/**
 * Stacked layouts: the vista and the header in their own small pass-through
 * stage, so the moon and the pool sit right above the header whatever the
 * band's height. Transparent (the band shows through) and masked at both ends,
 * so it melts into the band with no edge.
 */
function VistaWindow({ tier, still, children }: { tier: Exclude<Tier, "wide">; still: boolean; children: ReactNode }) {
  const mask = "linear-gradient(to bottom, transparent, #000 10vh, #000 calc(100% - 15vh), transparent)";
  return (
    <SceneStage
      mode={still ? "static" : "through"}
      factor={tier === "phone" ? 0.4 : 0.5}
      className="-mx-6 sm:-mx-10"
      style={{ background: "transparent", maskImage: mask, WebkitMaskImage: mask }}
    >
      <WindowArt tier={tier} />
      {/* scrim behind the header (static) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0"
        style={{
          top: `calc(${WINDOW[tier]} - 4vh)`,
          background: "linear-gradient(to bottom, transparent, rgb(4 5 26 / 0.46) 18%, rgb(4 5 26 / 0.4) 70%, transparent)",
        }}
      />
      <div className="relative z-10 px-6 pb-[17vh] sm:px-10" style={{ paddingTop: WINDOW[tier] }}>
        {children}
      </div>
    </SceneStage>
  );
}

// ─── Glass ────────────────────────────────────────────────────────────────────

/** One guarantee: a night-glass card with a violet glyph tile, a title and one line. Static. */
function GuaranteeCard({ item }: { item: Guarantee }) {
  const Icon = item.icon;
  return (
    <li className={cn(GLASS, GLASS_HOVER, "p-5 sm:p-6 lg:p-5")}>
      <GlassLight />
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4">
        <GlyphTile>
          <Icon className="h-[18px] w-[18px]" />
        </GlyphTile>
        <div className="min-w-0">
          <h3 className={cn("text-balance", BAND_TYPE.cardTitle)}>{item.title}</h3>
          <p className={cn("mt-1.5", BAND_TYPE.cardLine)}>{item.line}</p>
        </div>
      </div>
    </li>
  );
}

/** What the owner can and cannot do, as two short lists. */
function OwnerPanel({ className }: { className?: string }) {
  return (
    <GlassPane className={cn("p-6", className)}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3.5">
        <GlyphTile size="sm">
          <ShieldCheck className="h-4 w-4" />
        </GlyphTile>
        <h3 className={cn("text-balance", BAND_TYPE.cardTitle)}>What the owner can and cannot do</h3>
      </div>
      <div className="mt-4 grid gap-x-10 gap-y-6 sm:grid-cols-2">
        <div>
          <h4 id="owner-can" className={BAND_TYPE.label}>
            The owner can
          </h4>
          <ul aria-labelledby="owner-can" className="mt-3 space-y-1.5">
            {OWNER_CAN.map((line) => (
              <li
                key={line}
                className="grid grid-cols-[14px_minmax(0,1fr)] gap-2.5 text-sm leading-relaxed text-[color:rgb(201_204_255/0.82)] sm:text-[15px] sm:leading-relaxed"
              >
                <span aria-hidden className="inline-flex h-[1lh] items-center justify-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-[rgb(174_180_255/0.6)]" />
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 id="owner-cannot" className={BAND_TYPE.label}>
            The owner cannot
          </h4>
          <ul aria-labelledby="owner-cannot" className="mt-3 space-y-1.5">
            {OWNER_CANNOT.map((line) => (
              <li
                key={line}
                className="grid grid-cols-[14px_minmax(0,1fr)] gap-2.5 text-sm leading-relaxed font-medium text-[color:var(--ink)] sm:text-[15px] sm:leading-relaxed"
              >
                <span aria-hidden className="inline-flex h-[1lh] items-center justify-center text-[color:var(--lavender)]">
                  <X className="h-3 w-3" />
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </GlassPane>
  );
}

/**
 * The page's first call to action after the hero: status-aware, never a dead
 * end, under the honesty line and the proving-setup note.
 */
function CtaPlate({ className }: { className?: string }) {
  const { state } = usePoolStatus();
  const cta = primaryCta(state);
  return (
    <GlassPane className={cn("grid content-center gap-3 p-6", className)}>
      <p className={BAND_TYPE.label}>Testnet ETH only · not audited</p>
      <p className="text-pretty text-[13px] leading-relaxed text-[color:rgb(201_204_255/0.8)]">{SETUP_NOTE}</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        <Button asChild size="lg" className={cn(SCENE_CTA_PRIMARY, "w-full")}>
          <Link href={cta.href}>
            {cta.label}
            <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg" className={cn(SCENE_CTA_SECONDARY, "w-full")}>
          <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
            Get testnet ETH
            <ArrowUpRight className="ml-0.5 h-3 w-3" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </Button>
      </div>
    </GlassPane>
  );
}

// ─── Stage ────────────────────────────────────────────────────────────────────

/** Eyebrow, h2 and lead. Static. */
function Header() {
  return (
    <div className="max-w-[40rem] xl:max-w-[44rem]">
      <p className={SCENE_TYPE.eyebrow}>Built in, not promised</p>
      <h2 id="design-title" className={cn("mt-4", BAND_TYPE.title)}>
        <span className="scene-text-glow">Non-custodial</span> from the first deposit.
      </h2>
      <p className={cn("mt-5 max-w-[34rem]", SCENE_TYPE.lead)}>
        No service in the path can spend your funds, and every administrative power is disclosed below.
      </p>
    </div>
  );
}

function GuaranteesStage({ tier, still }: { tier: Tier; still: boolean }) {
  return (
    <SceneStage
      as="section"
      id="design"
      aria-labelledby="design-title"
      mode={still ? "static" : "through"}
      factor={FACTOR[tier]}
      className="min-h-[110vh]"
    >
      {tier === "wide" ? <VistaArt /> : <BackdropArt tier={tier} />}
      <Vignette strength={0.42} />
      {tier === "wide" && (
        // scrim behind the header (static; drawn here because the kit's Scrim boxes are fixed)
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[64%]"
          style={{ background: "radial-gradient(50% 58% at 22% 44%, rgb(4 5 26 / 0.56), rgb(4 5 26 / 0.24) 56%, transparent 80%)" }}
        />
      )}
      {/*
        Wide screens: a deeper top blend. The middle and near ranges are slow planes, so at the band's entry their
        crests straddle its top edge; a 16vh blend let the valleys show as a row of upside-down arcs.
      */}
      <NightBlend edge="top" deep={tier === "wide"} />
      <NightBlend edge="bottom" />

      {/* content sets the height (about 114vh at 1440×900); the top padding is part of the vista's calibration (WIDE_TOP) */}
      <div className={cn("relative z-10", SECTION_X, tier === "wide" ? "pb-[8vh] pt-[15vh]" : "pb-[10vh] pt-[4vh]")}>
        <Container>
          {tier === "wide" ? (
            <Header />
          ) : (
            <VistaWindow tier={tier} still={still}>
              <Header />
            </VistaWindow>
          )}

          <ul className="relative mt-[-9vh] grid gap-4 sm:grid-cols-2 lg:mt-10 lg:grid-cols-3 lg:gap-5">
            {GUARANTEES.map((item) => (
              <GuaranteeCard key={item.title} item={item} />
            ))}
          </ul>

          <div className="mt-4 grid gap-4 lg:mt-5 lg:grid-cols-12 lg:gap-5">
            <OwnerPanel className="lg:col-span-8" />
            <CtaPlate className="lg:col-span-4" />
          </div>
        </Container>
      </div>
    </SceneStage>
  );
}

export default function Guarantees() {
  const wide = useMedia("(min-width: 1024px)");
  const phone = useMedia("(max-width: 639px)");
  const safe = useMotionSafe();
  const tier: Tier = wide ? "wide" : phone ? "phone" : "tablet";
  return <GuaranteesStage key={`${tier}-${safe ? "move" : "still"}`} tier={tier} still={!safe} />;
}
