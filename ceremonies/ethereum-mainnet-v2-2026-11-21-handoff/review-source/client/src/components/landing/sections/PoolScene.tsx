/**
 * PoolScene v2 — "the pool" (spec §6.2), the second scene of the night journey.
 *
 * The camera comes out of the hero's dive: the top of this scene is the
 * underside of that cloud (two heavy masses in the dive's colours, so the
 * hero's CloudSeam runs straight into them), and they part over the pool while
 * the section scrolls in and over the first 8% of the pin. Below them the pool
 * rises out of a moonlit sea of cloud under a deep starry sky with far ridges:
 * the two violet monoliths of the logo with the gold diamond floating in the
 * gap, inside a soft halo.
 *
 * Pinned for 280vh (250 on tablets, 220 on phones), the story plays in three
 * beats while the copy on the left cross-fades:
 *
 *   01 Deposit   five small gold diamonds fall from the upper-left sky into the
 *                gap, each landing with a soft gold flash; the pool grows brighter
 *   02 Prove     a ring of light closes round the pool (behind the pillars, then
 *                in front of them) and constellation lines link the notes on it to
 *                one hidden note in the gap, which glows
 *   03 Withdraw  one diamond leaves the gap along a path of light to a "fresh
 *                address" star on the right
 *
 * Depth, back to front: NightSky (static) · sky: stars, a faint milky band ·
 * far: sparse stars, sparkles, far ridge · mid: near ridge and a sea of cloud
 * (camera push-in) · subject: the pool, its halo, its cloud floor and every
 * beat (drawn in the monoliths' own viewBox, so they stay locked to the gap) ·
 * near: dark backlit banks framing the bottom corners · night blend, vignette,
 * scrim (static) · front: the parting ceiling · copy · "fresh address" label.
 *
 * The camera eases out (most of the travel happens while the deposits fall),
 * so the scene settles for the proof and the withdrawal. Copy, step indicator,
 * label and tag are never transformed, only cross-faded. Pointer parallax on
 * fine pointers (the kit's). Reduced motion and short viewports get three
 * still frames, stacked. The stage is keyed by tier, so every range is
 * constant per mount. Planes give up their compositing layers while the
 * section is far away (data-idle) or still mostly below the screen (data-pre).
 */
import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useTransform,
  type MotionValue,
} from "framer-motion";
import {
  PinnedScene,
  useMedia,
  useMotionSafe,
  useRange,
  useSectionProgress,
} from "@/components/landing/parallax";
import { FigureTag, SCENE_TYPE } from "@/components/landing/system";
import {
  CloudDeck,
  CloudIsland,
  Constellation,
  DEPTH,
  Monoliths,
  NightSky,
  Ridge,
  SceneLayer,
  SceneSparkles,
  SceneStage,
  Scrim,
  Starfield,
  Vignette,
  useScene,
  type SceneDepth,
  type SceneSparkleSpec,
  type StarNode,
} from "@/components/landing/scene";
import {
  CeilingMass,
  NoteDiamond,
  POOL_ASPECT,
  POOL_EXTEND,
  POOL_GAP,
  POOL_RING_BACK,
  POOL_RING_FRONT,
  POOL_VB,
  POOL_VIEWBOX,
  cubicPath,
  ringPoint,
  sparklePath,
  type CeilingMassProps,
  type PoolPt,
} from "@/components/landing/scene/pool-art";
import { cn } from "@/lib/utils";

// ─── Copy ─────────────────────────────────────────────────────────────────────

const TITLE = "How the pool works: deposit, prove, withdraw";
const TITLE_ID = "pool-title";

interface Beat {
  eyebrow: string;
  title: ReactNode;
  lead: string;
}

const BEATS: Beat[] = [
  {
    eyebrow: "01 · Deposit",
    title: (
      <>
        Deposits flow into <span className="scene-text-glow">one pool</span>.
      </>
    ),
    lead: "Every deposit is public. Inside the pool it becomes a note only your device can open.",
  },
  {
    eyebrow: "02 · Prove",
    title: (
      <>
        Your device <span className="scene-text-glow">proves ownership</span>.
      </>
    ),
    lead: "A zero-knowledge proof says one of these notes is yours and unspent — without saying which.",
  },
  {
    eyebrow: "03 · Withdraw",
    title: (
      <>
        Withdraw with <span className="scene-text-glow">no thread back</span>.
      </>
    ),
    lead: "A relayer pays the gas and sends funds to a fresh address. Withdraw part, and the rest stays as change.",
  },
];

// ─── Layout per tier ──────────────────────────────────────────────────────────

type Tier = "wide" | "tablet" | "phone";

const PIN_VH: Record<Tier, number> = { wide: 280, tablet: 250, phone: 220 };
/** share of the spec's travel each tier uses */
const FACTOR: Record<Tier, number> = { wide: 1, tablet: 0.9, phone: 0.75 };

/**
 * Where the pool stands once the camera has settled, as CSS variables on the
 * stage: --pool-x (centre), --pool-w (the monoliths' width), --pool-top (top of
 * their box). Wide screens step by breakpoint so the ring always clears the
 * copy column and the cloud floor stays below it: lg is short and narrow
 * (smaller pool, set lower), xl the 16:10 laptop, 2xl moves right for the
 * wider column.
 */
const POOL_VARS: Record<Tier, string> = {
  wide: "[--pool-x:72%] [--pool-w:min(46vh,26vw)] [--pool-top:24vh] xl:[--pool-x:69%] xl:[--pool-w:min(46vh,29vw)] xl:[--pool-top:15vh] 2xl:[--pool-x:71.5%] 2xl:[--pool-w:min(44vh,26vw)]",
  tablet: "[--pool-x:50%] [--pool-w:min(44vw,33vh)] [--pool-top:48vh]",
  phone: "[--pool-x:45%] [--pool-w:min(55vw,28vh)] [--pool-top:52vh]",
};

/** Settled tops of the land planes behind the pool (far ridge, near ridge, cloud sea). */
const LAND_AT: Record<Tier, { far: string; mid: string; sea: string }> = {
  wide: { far: "50%", mid: "61%", sea: "71%" },
  tablet: { far: "58%", mid: "67%", sea: "77%" },
  phone: { far: "60%", mid: "69%", sea: "79%" },
};

const COPY_W: Record<Tier, string> = {
  wide: "max-w-[32rem] xl:max-w-[38rem] 2xl:max-w-[46rem]",
  tablet: "max-w-[36rem]",
  phone: "max-w-[34rem]",
};

/** CSS top of an art plane: where it sits once the camera has settled, plus its layer's travel over the pin. */
function rise(settled: string, depth: SceneDepth, f: number): string {
  return `calc(${settled} + ${(DEPTH[depth].travelVh * f).toFixed(2)}vh)`;
}

/** A point in the monoliths' logo units, in stage CSS (settled frame). */
function poolPoint(x: number, y: number): { left: string; top: string } {
  return {
    left: `calc(var(--pool-x) + ${((x - POOL_GAP.x) / POOL_VB.w).toFixed(4)} * var(--pool-w))`,
    top: `calc(var(--pool-top) + ${((y - POOL_VB.y) / POOL_VB.w).toFixed(4)} * var(--pool-w))`,
  };
}

/** A square glow centred on the gap, `k` box-widths across (percentages of the monoliths' box). */
function gapGlow(k: number): CSSProperties {
  const gx = (POOL_GAP.x - POOL_VB.x) / POOL_VB.w;
  const gy = (POOL_GAP.y - POOL_VB.y) / POOL_VB.w;
  return {
    left: `${((gx - k / 2) * 100).toFixed(2)}%`,
    top: `${(((gy - k / 2) / POOL_ASPECT) * 100).toFixed(2)}%`,
    width: `${(k * 100).toFixed(1)}%`,
    aspectRatio: "1",
  };
}

// ─── Timeline (pin progress 0 → 1) ────────────────────────────────────────────

/** The camera eases out: quick while the scene opens and the deposits fall, settled for the proof and the withdrawal. */
const CAM_IN = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const CAM_OUT = CAM_IN.map(t => +(1 - (1 - t) ** 2).toFixed(4));

/**
 * Sequential cross-fades: each beat is gone before the next one starts, so two
 * beats' type never overlaps (the copy is empty for 0.005 of the pin, ~8px).
 */
const BEAT_IN = [
  [0, 0.315, 0.335],
  [0.34, 0.36, 0.625, 0.645],
  [0.65, 0.67, 1],
];
const BEAT_OP = [
  [1, 1, 0],
  [0, 1, 1, 0],
  [0, 1, 1],
];

const STEPS = [
  { label: "Deposit", from: 0, to: 0.34 },
  { label: "Prove", from: 0.34, to: 0.65 },
  { label: "Withdraw", from: 0.65, to: 0.9 },
];

/** Beat 1: each note falls from `from` (logo units) into the gap over `t`. */
interface Note {
  from: PoolPt;
  size: number;
  t: readonly [number, number];
}
const NOTES: Note[] = [
  { from: [70, -330], size: 64, t: [0.06, 0.15] },
  { from: [250, -440], size: 50, t: [0.105, 0.195] },
  { from: [20, -150], size: 74, t: [0.15, 0.24] },
  { from: [330, -360], size: 46, t: [0.195, 0.285] },
  { from: [150, -250], size: 58, t: [0.24, 0.33] },
];
const LANDINGS = NOTES.map(n => n.t[1]);

/** Beat 2: the ring closes, then the links draw one after another. */
const RING_DRAW = [0.37, 0.47];
const LINKS_DRAW = [0.45, 0.58];

/** Beat 3: the path draws ahead of the leaving diamond, which reaches the star at LEAVE[1]. */
const PATH_DRAW = [0.67, 0.8];
const LEAVE = [0.69, 0.84];

interface Withdrawal {
  /** the path's cubic Bézier in logo units: from the gap to the star */
  c: readonly [PoolPt, PoolPt, PoolPt, PoolPt];
  /** where the label sits: centred under the star, or under it towards the pool (narrow screens) */
  label: "below" | "below-left";
}
/** Stacked layouts: a lower arc, so the star stays clear of the copy above the pool. */
const LOW_ARC: Withdrawal = {
  c: [
    [480, 500],
    [500, 330],
    [760, 230],
    [1000, 320],
  ],
  label: "below-left",
};
/** Withdrawal path per tier: wide arcs over the right pillar's tip to a star high on the right. */
const WITHDRAW: Record<Tier, Withdrawal> = {
  wide: {
    c: [
      [480, 500],
      [470, 300],
      [640, 0],
      [990, 150],
    ],
    label: "below",
  },
  tablet: LOW_ARC,
  phone: LOW_ARC,
};

/** Notes on the ring (angles; 0° is its right end, clockwise on screen) and the hidden note in the gap. */
const RING_NOTES = [18, 56, 96, 134, 166, 197, 343];
const PROOF_NODES: StarNode[] = [
  ...RING_NOTES.map(
    (a): StarNode => ({
      ...ringPoint(a),
      r: 3.4,
      tone: a > 180 ? "lavender" : "white",
    })
  ),
  // the hidden note: never drawn (the links fade out before they reach it)
  { x: POOL_GAP.x, y: POOL_GAP.y, r: 0.01, tone: "gold" },
];
const HIDDEN = PROOF_NODES.length - 1;
const PROOF_LINKS: (readonly [number, number])[] = [0, 4, 1, 5, 6, 3].map(
  i => [i, HIDDEN] as const
);

/** Static frames (reduced motion): the progress each one shows. */
const STILL_AT = [0.252, 0.6, 0.815];

// ─── Art ──────────────────────────────────────────────────────────────────────

/**
 * While the section is far off-screen (Landing marks it data-idle) its moving
 * planes give up will-change, so they keep no compositing layer there.
 */
const IDLE = "[[data-idle]_&]:will-change-auto";
/**
 * Planes that stand still until the pin starts: also without their own layer
 * while the section is still scrolling in (the stage carries data-pre until it
 * is about half on screen; only the parting ceiling moves before that).
 */
const STILL_UNTIL_PIN =
  "[[data-idle]_&]:will-change-auto [[data-pre]_&]:will-change-auto";
/**
 * Looping decorations (sparkles, the diamond's bob) also rest until then.
 * Important: the kit's animations are unlayered CSS, which beats any utility.
 */
const PAUSE_PRE = "[[data-pre]_&]:[animation:none]!";
/** Share of the scroll-in after which the stage's planes get their layers back. */
const PRE_UNTIL = 0.55;

const SPARKLES: Record<Tier, SceneSparkleSpec[]> = {
  wide: [
    {
      left: "57%",
      top: "31%",
      size: 11,
      tone: "white",
      delay: 2.2,
      className: PAUSE_PRE,
    },
    {
      left: "96%",
      top: "47%",
      size: 10,
      tone: "white",
      delay: 3.4,
      className: PAUSE_PRE,
    },
  ],
  tablet: [
    {
      left: "88%",
      top: "44%",
      size: 10,
      tone: "white",
      delay: 0.8,
      className: PAUSE_PRE,
    },
  ],
  phone: [
    {
      left: "90%",
      top: "47%",
      size: 9,
      tone: "white",
      delay: 0.8,
      className: PAUSE_PRE,
    },
  ],
};

/**
 * Every art plane of the scene. `p` is the raw pin progress (beats); the
 * layers move with the stage's (eased) camera. Bottom-anchored planes run on
 * below the stage by more than their travel; full-bleed planes overhang the
 * sides by 32px.
 */
function PoolArt({ tier, p }: { tier: Tier; p: MotionValue<number> }) {
  const f = FACTOR[tier];
  const phone = tier === "phone";
  const land = LAND_AT[tier];
  return (
    <>
      <NightSky variant="deep" />

      {/* sky: the star field and a faint milky band across it */}
      <SceneLayer depth="sky" className={STILL_UNTIL_PIN}>
        <div className="absolute left-[-24%] top-[2%] h-[40%] w-[150%] -rotate-[11deg] bg-[radial-gradient(closest-side,rgb(201_204_255/0.15),rgb(139_108_246/0.08)_50%,transparent)]" />
        <div className="absolute left-[38%] top-[-4%] h-[86%] w-[62%] bg-[radial-gradient(closest-side,rgb(139_108_246/0.2),rgb(106_75_224/0.08)_55%,transparent)]" />
        <Starfield
          count={phone ? 90 : 150}
          seed={47}
          twinkle="none"
          className="absolute -inset-x-4 -top-4 h-[84%]"
        />
      </SceneLayer>

      {/* far: sparse brighter stars, sparkles, the far range */}
      <SceneLayer depth="far" className={STILL_UNTIL_PIN}>
        {!phone && (
          <Starfield
            count={40}
            seed={13}
            twinkle="none"
            className="absolute -inset-x-4 -top-4 h-[60%] opacity-80"
          />
        )}
        <SceneSparkles items={SPARKLES[tier]} />
        <div
          className="absolute -inset-x-8 -bottom-[16vh]"
          style={{ top: rise(land.far, "far", f) }}
        >
          <Ridge
            tier={0}
            seed={3}
            rimAt={0.7}
            edgeHeight={phone ? "22vh" : "32vh"}
            className="absolute inset-0"
          />
        </div>
      </SceneLayer>

      {/* mid: the near range and a sea of cloud in its valleys (slight camera push-in on the pool) */}
      <SceneLayer
        depth="mid"
        push={1.04}
        className={cn("origin-[69%_62%]", STILL_UNTIL_PIN)}
      >
        <div
          className="absolute -inset-x-8 -bottom-[24vh]"
          style={{ top: rise(land.mid, "mid", f) }}
        >
          <Ridge
            tier={1}
            seed={12}
            rimAt={0.68}
            edgeHeight={phone ? "18vh" : "28vh"}
            className="absolute inset-0"
          />
        </div>
        <div
          className="absolute -inset-x-8 -bottom-[24vh]"
          style={{ top: rise(land.sea, "mid", f) }}
        >
          <CloudDeck
            tone="dim"
            rows={3}
            seed={8}
            puff={phone ? "large" : "medium"}
            edgeHeight={phone ? "16vh" : "22vh"}
            className="absolute inset-0"
          />
        </div>
      </SceneLayer>

      {/*
        subject: the pool rising out of its sea of cloud, and every beat. Paint
        order keeps it to one extra layer: the static art first (halo, back of
        the ring, monoliths, floor), the composited beats drawing last, on top.
      */}
      <SceneLayer depth="subject" className={STILL_UNTIL_PIN}>
        <PoolBox
          tier={tier}
          className="[[data-pre]_&_.scene-bob]:[animation:none]!"
        >
          <PoolHalo />
          <span className="scene-glow opacity-60" style={gapGlow(1.25)} />
          <RingBack p={p} />
          <Monoliths extend={POOL_EXTEND} className="w-full" />
        </PoolBox>
        <PoolFloor tier={tier} />
        <PoolBox tier={tier}>
          <PoolBeats tier={tier} p={p} />
        </PoolBox>
      </SceneLayer>

      {/* near: dark, backlit banks of cloud framing the bottom corners */}
      <SceneLayer depth="near" className={STILL_UNTIL_PIN}>
        {NEAR_BANKS[tier].map(b => (
          <div
            key={b.seed}
            className="absolute"
            style={{
              left: b.left,
              width: b.width,
              top: rise(b.top, "near", f),
            }}
          >
            <CloudIsland
              tone="near"
              rows={2}
              seed={b.seed}
              className="w-full"
            />
          </div>
        ))}
      </SceneLayer>
    </>
  );
}

/**
 * Where the floor's deck starts, as a share of the monoliths' box height: low
 * enough to stay under the copy, high enough that the deepest dip of its crest
 * still hides the pillars' feet.
 */
const FLOOR_AT = 0.71;

/**
 * The sea of cloud the pool stands in: a full-width moonlit deck at the
 * pool's depth whose crest hides the pillars' feet, warmed by the pool's light
 * right under the gap. It runs on below the stage by more than its travel.
 */
function PoolFloor({ tier }: { tier: Tier }) {
  const f = FACTOR[tier];
  const phone = tier === "phone";
  const top = `calc(var(--pool-top) + ${(FLOOR_AT * POOL_ASPECT).toFixed(3)} * var(--pool-w) + ${(DEPTH.subject.travelVh * f).toFixed(2)}vh)`;
  return (
    <>
      <div className="absolute -inset-x-8 -bottom-[40vh]" style={{ top }}>
        <CloudDeck
          tone="lit"
          rows={3}
          seed={6}
          puff="medium"
          edgeHeight={phone ? "12vh" : "18vh"}
          palette={{ top: "#b9bcf6", mid: "#6268bb", low: "#262b6e" }}
          className="absolute inset-0"
        />
      </div>
      {/* the pool's light on the cloud right under it */}
      <span
        className="absolute rounded-[50%] bg-[radial-gradient(closest-side,rgb(245_213_138/0.3),rgb(201_184_255/0.16)_45%,transparent)]"
        style={{
          left: "calc(var(--pool-x) - 0.95 * var(--pool-w))",
          width: "calc(1.9 * var(--pool-w))",
          height: "calc(0.6 * var(--pool-w))",
          top: `calc(${top} - 0.12 * var(--pool-w))`,
        }}
      />
    </>
  );
}

/** Dark backlit banks framing the bottom corners (near), per tier: settled top, left, width. */
const NEAR_BANKS: Record<
  Tier,
  { seed: number; left: string; width: string; top: string }[]
> = {
  wide: [
    { seed: 23, left: "-16%", width: "52%", top: "79%" },
    { seed: 31, left: "70%", width: "46%", top: "83%" },
  ],
  tablet: [
    { seed: 23, left: "-30%", width: "72%", top: "85%" },
    { seed: 31, left: "62%", width: "66%", top: "88%" },
  ],
  phone: [
    { seed: 23, left: "-40%", width: "92%", top: "87%" },
    { seed: 31, left: "56%", width: "86%", top: "89%" },
  ],
};

/**
 * The monoliths' box (their width × the drawing's height), placed on the pool:
 * the pool and its light go in one, the beats drawn over it in another.
 */
function PoolBox({
  tier,
  className,
  children,
}: {
  tier: Tier;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("absolute", className)}
      style={{
        left: "calc(var(--pool-x) - var(--pool-w) / 2)",
        width: "var(--pool-w)",
        height: `calc(${POOL_ASPECT.toFixed(4)} * var(--pool-w))`,
        top: rise("var(--pool-top)", "subject", FACTOR[tier]),
      }}
    >
      {children}
    </div>
  );
}

/** The pool's halo: a soft violet light with two faint rings, centred on the gap (static). */
function PoolHalo() {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      aria-hidden
      viewBox="-100 -100 200 200"
      className="pointer-events-none absolute overflow-visible"
      style={gapGlow(3.4)}
    >
      <defs>
        <radialGradient
          id={`${id}-halo`}
          cx="0"
          cy="0"
          r="100"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#d9ccff" stopOpacity="0.3" />
          <stop offset="0.14" stopColor="#a78bfa" stopOpacity="0.22" />
          <stop offset="0.27" stopColor="#8b6cf6" stopOpacity="0.11" />
          <stop offset="0.31" stopColor="#c9ccff" stopOpacity="0.1" />
          <stop offset="0.35" stopColor="#8b6cf6" stopOpacity="0.07" />
          <stop offset="0.5" stopColor="#7c66e8" stopOpacity="0.045" />
          <stop offset="0.54" stopColor="#c9ccff" stopOpacity="0.06" />
          <stop offset="0.58" stopColor="#8b6cf6" stopOpacity="0.03" />
          <stop offset="1" stopColor="#8b6cf6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle r="100" fill={`url(#${id}-halo)`} />
    </svg>
  );
}

// ─── Beats (all drawn in the monoliths' viewBox) ──────────────────────────────

/** Ring stroke: a soft wide glow under a crisp line, both drawn with pathLength. */
function RingStroke({
  d,
  draw,
  stroke,
}: {
  d: string;
  draw: MotionValue<number>;
  stroke: string;
}) {
  return (
    <>
      <motion.path
        d={d}
        fill="none"
        stroke="#aeb4ff"
        strokeOpacity="0.16"
        strokeWidth="9"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={{ pathLength: draw }}
      />
      <motion.path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={{ pathLength: draw }}
      />
    </>
  );
}

function RingGradient({ id }: { id: string }) {
  return (
    <linearGradient
      id={id}
      gradientUnits="userSpaceOnUse"
      x1="48"
      y1="0"
      x2="912"
      y2="0"
    >
      <stop offset="0" stopColor="#aeb4ff" stopOpacity="0.5" />
      <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.95" />
      <stop offset="1" stopColor="#aeb4ff" stopOpacity="0.5" />
    </linearGradient>
  );
}

const RING_SHOW = { at: [0.365, 0.385, 0.66, 0.74], op: [0, 1, 1, 0.45] };

/** The back half of the ring, behind the pillars (hidden, so not drawn, until the prove beat). */
function RingBack({ p }: { p: MotionValue<number> }) {
  const id = useId().replace(/:/g, "");
  const draw = useRange<number>(p, RING_DRAW, [0, 1]);
  const opacity = useRange(p, RING_SHOW.at, RING_SHOW.op);
  const visibility = useTransform(p, (v: number) =>
    v < RING_SHOW.at[0] ? "hidden" : "visible"
  );
  return (
    <motion.svg
      viewBox={POOL_VIEWBOX}
      style={{ opacity, visibility }}
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      aria-hidden
    >
      <defs>
        <RingGradient id={`${id}-ring`} />
      </defs>
      <RingStroke d={POOL_RING_BACK} draw={draw} stroke={`url(#${id}-ring)`} />
    </motion.svg>
  );
}

/** Everything drawn in front of the monoliths: gap light, landings, the ring's front half, notes, the withdrawal. */
function PoolBeats({ tier, p }: { tier: Tier; p: MotionValue<number> }) {
  const id = useId().replace(/:/g, "");
  const w = WITHDRAW[tier];
  // its own layer only where it animates (never in the still frames)
  const live = useScene().mode !== "static";
  return (
    <svg
      viewBox={POOL_VIEWBOX}
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full overflow-visible",
        live && cn("will-change-transform", STILL_UNTIL_PIN)
      )}
      aria-hidden
    >
      <defs>
        <radialGradient
          id={`${id}-spoke`}
          gradientUnits="userSpaceOnUse"
          cx={POOL_GAP.x}
          cy={POOL_GAP.y}
          r="440"
        >
          <stop offset="0" stopColor="#c9ccff" stopOpacity="0" />
          <stop offset="0.3" stopColor="#c9ccff" stopOpacity="0" />
          <stop offset="0.62" stopColor="#dfe1ff" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="1" />
        </radialGradient>
        <radialGradient id={`${id}-gold`}>
          <stop offset="0" stopColor="#fff3cf" stopOpacity="0.85" />
          <stop offset="0.22" stopColor="#f5d58a" stopOpacity="0.5" />
          <stop offset="0.55" stopColor="#d4ac4e" stopOpacity="0.16" />
          <stop offset="1" stopColor="#d4ac4e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-halo`}>
          <stop offset="0" stopColor="#f5d58a" stopOpacity="0.55" />
          <stop offset="0.4" stopColor="#d4ac4e" stopOpacity="0.18" />
          <stop offset="1" stopColor="#d4ac4e" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-star`}>
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="0.25" stopColor="#c9ccff" stopOpacity="0.4" />
          <stop offset="1" stopColor="#aeb4ff" stopOpacity="0" />
        </radialGradient>
        <RingGradient id={`${id}-ring`} />
        <linearGradient
          id={`${id}-path`}
          gradientUnits="userSpaceOnUse"
          x1={w.c[0][0]}
          y1={w.c[0][1]}
          x2={w.c[3][0]}
          y2={w.c[3][1]}
        >
          <stop offset="0" stopColor="#f5d58a" stopOpacity="0.95" />
          <stop offset="0.6" stopColor="#f4e6c0" stopOpacity="0.85" />
          <stop offset="1" stopColor="#dfe1ff" stopOpacity="0.95" />
        </linearGradient>
        {NOTES.map((n, i) => {
          const t = trailOf(n);
          return (
            <linearGradient
              key={i}
              id={`${id}-t${i}`}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2={t.x}
              y2={t.y}
            >
              <stop offset="0" stopColor="#f5d58a" stopOpacity="0.85" />
              <stop offset="1" stopColor="#f5d58a" stopOpacity="0" />
            </linearGradient>
          );
        })}
      </defs>

      <GapGlow p={p} fill={`url(#${id}-gold)`} />
      <LandingFlash p={p} fill={`url(#${id}-gold)`} />
      <Ripple p={p} />
      <RingFront p={p} stroke={`url(#${id}-ring)`} />
      <ProofLinks p={p} stroke={`url(#${id}-spoke)`} />
      <WithdrawPath p={p} c={w.c} stroke={`url(#${id}-path)`} />
      <FreshStar p={p} at={w.c[3]} glow={`url(#${id}-star)`} />
      {NOTES.map((n, i) => (
        <FallingNote
          key={i}
          p={p}
          n={n}
          trail={`url(#${id}-t${i})`}
          halo={`url(#${id}-halo)`}
        />
      ))}
      <Leaver p={p} c={w.c} halo={`url(#${id}-halo)`} />
    </svg>
  );
}

/** The pool's own light: brighter with every deposit, brightest when the proof lands on the hidden note. */
function GapGlow({ p, fill }: { p: MotionValue<number>; fill: string }) {
  const opacity = useRange(
    p,
    [0.06, ...LANDINGS, 0.47, 0.57, 0.64, 0.74],
    [0.16, 0.26, 0.36, 0.46, 0.56, 0.64, 0.66, 1, 1, 0.6]
  );
  return (
    <motion.circle
      cx={POOL_GAP.x}
      cy={POOL_GAP.y}
      r={250}
      fill={fill}
      style={{ opacity }}
    />
  );
}

/** One soft gold flash per landing (one element, one peak per note). */
function LandingFlash({ p, fill }: { p: MotionValue<number>; fill: string }) {
  const at: number[] = [];
  const op: number[] = [];
  for (const b of LANDINGS) {
    at.push(b - 0.008, b, b + 0.03);
    op.push(0, 1, 0);
  }
  const opacity = useRange(p, at, op);
  return (
    <motion.circle
      cx={POOL_GAP.x}
      cy={POOL_GAP.y}
      r={190}
      fill={fill}
      style={{ opacity }}
    />
  );
}

/** A ring of light that spreads from the gap as each note lands. */
function Ripple({ p }: { p: MotionValue<number> }) {
  const at: number[] = [];
  const sc: number[] = [];
  const oat: number[] = [];
  const op: number[] = [];
  LANDINGS.forEach((b, i) => {
    if (i > 0) {
      at.push(b - 0.0005);
      sc.push(1.6);
    }
    at.push(b, b + 0.032);
    sc.push(0.3, 1.6);
    oat.push(b - 0.002, b, b + 0.032);
    op.push(0, 0.75, 0);
  });
  const scale = useRange(p, at, sc);
  const opacity = useRange(p, oat, op);
  return (
    <g transform={`translate(${POOL_GAP.x} ${POOL_GAP.y})`}>
      <motion.ellipse
        rx={170}
        ry={64}
        fill="none"
        stroke="#f5d58a"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        style={{ scale, opacity }}
      />
    </g>
  );
}

/** The trail of a falling note points back to where it came from. */
function trailOf(n: Note): { x: number; y: number } {
  const dx = n.from[0] - POOL_GAP.x;
  const dy = n.from[1] - POOL_GAP.y;
  const len = Math.hypot(dx, dy) || 1;
  const L = 150 + n.size;
  return { x: +((dx / len) * L).toFixed(1), y: +((dy / len) * L).toFixed(1) };
}

/** Beat 1: one deposit falls from the upper-left sky into the gap, faster as it falls, and melts into the pool. */
function FallingNote({
  p,
  n,
  trail,
  halo,
}: {
  p: MotionValue<number>;
  n: Note;
  trail: string;
  halo: string;
}) {
  const [a, b] = n.t;
  const d = b - a;
  const dx = n.from[0] - POOL_GAP.x;
  const dy = n.from[1] - POOL_GAP.y;
  const at = [a, a + d * 0.25, a + d * 0.5, a + d * 0.75, b];
  // remaining share of the fall (ease-in: it accelerates)
  const left = [1, 0.905, 0.69, 0.39, 0];
  const x = useRange(
    p,
    at,
    left.map(v => +(dx * v).toFixed(1))
  );
  const y = useRange(
    p,
    at,
    left.map(v => +(dy * v).toFixed(1))
  );
  const opacity = useRange(p, [a, a + d * 0.16, b - d * 0.05, b], [0, 1, 1, 0]);
  const scale = useRange(p, [b - d * 0.22, b], [1, 0.45]);
  const t = trailOf(n);
  return (
    <g transform={`translate(${POOL_GAP.x} ${POOL_GAP.y})`}>
      <motion.g style={{ x, y, opacity }}>
        <line
          x1="0"
          y1="0"
          x2={t.x}
          y2={t.y}
          stroke={trail}
          strokeWidth="5"
          strokeLinecap="round"
        />
        <motion.g style={{ scale }}>
          <circle r={n.size * 1.25} fill={halo} />
          <NoteDiamond size={n.size} />
        </motion.g>
      </motion.g>
    </g>
  );
}

/** The front half of the ring (in front of the pillars). */
function RingFront({ p, stroke }: { p: MotionValue<number>; stroke: string }) {
  const draw = useRange<number>(p, RING_DRAW, [0, 1]);
  const opacity = useRange(p, RING_SHOW.at, RING_SHOW.op);
  return (
    <motion.g style={{ opacity }}>
      <RingStroke d={POOL_RING_FRONT} draw={draw} stroke={stroke} />
    </motion.g>
  );
}

/**
 * Beat 2: lines from the notes on the ring converge on the hidden note in the
 * gap. Their stroke (`stroke`, a radial gradient round the gap) fades out
 * towards it, so they vanish into the light instead of pointing at one spot.
 * A nested <svg> in the beats' own drawing, placed on the same viewBox.
 */
function ProofLinks({ p, stroke }: { p: MotionValue<number>; stroke: string }) {
  const draw = useRange<number>(p, LINKS_DRAW, [0, 1]);
  const opacity = useRange(p, [0.42, 0.46, 0.66, 0.74], [0, 1, 1, 0.3]);
  return (
    <motion.g style={{ opacity }}>
      <g transform={`translate(${POOL_VB.x} ${POOL_VB.y})`}>
        <Constellation
          nodes={PROOF_NODES}
          links={PROOF_LINKS}
          draw={draw}
          viewBox={POOL_VIEWBOX}
          stroke={stroke}
        />
      </g>
    </motion.g>
  );
}

/** Beat 3: the path of light, drawn just ahead of the leaving diamond. */
function WithdrawPath({
  p,
  c,
  stroke,
}: {
  p: MotionValue<number>;
  c: readonly [PoolPt, PoolPt, PoolPt, PoolPt];
  stroke: string;
}) {
  const draw = useRange<number>(p, PATH_DRAW, [0, 1]);
  const opacity = useRange(p, [PATH_DRAW[0], PATH_DRAW[0] + 0.015], [0, 1]);
  const d = cubicPath(c);
  return (
    <motion.g style={{ opacity }}>
      <motion.path
        d={d}
        fill="none"
        stroke="#f5d58a"
        strokeOpacity="0.18"
        strokeWidth="10"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={{ pathLength: draw }}
      />
      <motion.path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={{ pathLength: draw }}
      />
    </motion.g>
  );
}

/** A point on the withdrawal curve. */
function bezierAt(
  c: readonly [PoolPt, PoolPt, PoolPt, PoolPt],
  t: number
): PoolPt {
  const u = 1 - t;
  const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [
    k[0] * c[0][0] + k[1] * c[1][0] + k[2] * c[2][0] + k[3] * c[3][0],
    k[0] * c[0][1] + k[1] * c[1][1] + k[2] * c[2][1] + k[3] * c[3][1],
  ];
}

/** Beat 3: one diamond rises out of the gap and follows the path to the star (slow out, slow in). */
function Leaver({
  p,
  c,
  halo,
}: {
  p: MotionValue<number>;
  c: readonly [PoolPt, PoolPt, PoolPt, PoolPt];
  halo: string;
}) {
  const [a, b] = LEAVE;
  const n = 10;
  const at = Array.from(
    { length: n + 1 },
    (_, k) => +(a + ((b - a) * k) / n).toFixed(4)
  );
  const pts = at.map((_, k) => {
    const s = k / n;
    return bezierAt(c, s * s * (3 - 2 * s));
  });
  const x = useRange(
    p,
    at,
    pts.map(q => +(q[0] - c[0][0]).toFixed(1))
  );
  const y = useRange(
    p,
    at,
    pts.map(q => +(q[1] - c[0][1]).toFixed(1))
  );
  const opacity = useRange(
    p,
    [a, a + 0.012, b - 0.012, b + 0.004],
    [0, 1, 1, 0]
  );
  const scale = useRange(p, [a, a + 0.03, b - 0.03, b], [0.5, 1, 1, 0.55]);
  return (
    <g transform={`translate(${c[0][0]} ${c[0][1]})`}>
      <motion.g style={{ x, y, opacity }}>
        <motion.g style={{ scale }}>
          <circle r={95} fill={halo} />
          <NoteDiamond size={70} />
        </motion.g>
      </motion.g>
    </g>
  );
}

/** Beat 3: the "fresh address" star: dim while the path draws, flaring when the diamond reaches it. */
function FreshStar({
  p,
  at,
  glow,
}: {
  p: MotionValue<number>;
  at: PoolPt;
  glow: string;
}) {
  const opacity = useRange(
    p,
    [0.64, 0.7, LEAVE[1] - 0.01, LEAVE[1] + 0.008],
    [0, 0.55, 0.55, 1]
  );
  const scale = useRange(
    p,
    [LEAVE[1] - 0.01, LEAVE[1] + 0.012, LEAVE[1] + 0.05],
    [0.8, 1.5, 1.1]
  );
  const flare = useRange(
    p,
    [LEAVE[1] - 0.005, LEAVE[1] + 0.015, LEAVE[1] + 0.08],
    [0, 0.9, 0]
  );
  const flareScale = useRange(
    p,
    [LEAVE[1] - 0.005, LEAVE[1] + 0.08],
    [0.3, 1.7]
  );
  return (
    <g transform={`translate(${at[0]} ${at[1]})`}>
      <motion.circle
        r={120}
        fill={glow}
        style={{ opacity: flare, scale: flareScale }}
      />
      <motion.g style={{ opacity, scale }}>
        <circle r={70} fill={glow} />
        <path d={sparklePath(34)} fill="#f4f3ff" />
        <circle r={5} fill="#ffffff" />
      </motion.g>
    </g>
  );
}

// ─── The cloud ceiling (front) ────────────────────────────────────────────────

interface MassAt {
  box: CSSProperties;
  to: { x: string; y: string };
  mass: CeilingMassProps;
}

/** The two masses of the ceiling per tier: their boxes at rest, where they part to, and their drawings. */
const CEILING: Record<Tier, { left: MassAt; right: MassAt }> = {
  wide: {
    left: {
      box: { left: "-16vw", width: "88vw", top: "-14vh", height: "54vh" },
      to: { x: "-28vw", y: "-8vh" },
      mass: {
        side: "left",
        seed: 5,
        width: 1300,
        height: 500,
        base: 0.8,
        end: 0.76,
        reach: 0.16,
      },
    },
    right: {
      box: { left: "30vw", width: "88vw", top: "-14vh", height: "50vh" },
      to: { x: "40vw", y: "-10vh" },
      mass: {
        side: "right",
        seed: 11,
        width: 1300,
        height: 480,
        base: 0.8,
        end: 0.76,
        reach: 0.17,
      },
    },
  },
  tablet: {
    left: {
      box: { left: "-30vw", width: "104vw", top: "-8vh", height: "44vh" },
      to: { x: "-38vw", y: "-7vh" },
      mass: {
        side: "left",
        seed: 5,
        width: 1000,
        height: 520,
        base: 0.8,
        end: 0.74,
        reach: 0.18,
        puff: [70, 140],
      },
    },
    right: {
      box: { left: "6vw", width: "104vw", top: "-8vh", height: "40vh" },
      to: { x: "50vw", y: "-9vh" },
      mass: {
        side: "right",
        seed: 11,
        width: 960,
        height: 500,
        base: 0.8,
        end: 0.74,
        reach: 0.2,
        puff: [70, 140],
      },
    },
  },
  phone: {
    left: {
      box: { left: "-34vw", width: "112vw", top: "-6vh", height: "40vh" },
      to: { x: "-42vw", y: "-6vh" },
      mass: {
        side: "left",
        seed: 5,
        width: 900,
        height: 520,
        base: 0.8,
        end: 0.74,
        reach: 0.18,
        puff: [70, 140],
      },
    },
    right: {
      box: { left: "0vw", width: "112vw", top: "-6vh", height: "36vh" },
      to: { x: "56vw", y: "-8vh" },
      mass: {
        side: "right",
        seed: 11,
        width: 900,
        height: 480,
        base: 0.8,
        end: 0.74,
        reach: 0.2,
        puff: [70, 140],
      },
    },
  },
};

/**
 * The underside of the hero's cloud, which the scene emerges from. The masses
 * part while the section scrolls in (`approach`: its top crossing the viewport)
 * and finish over the first 8% of the pin; then they are hidden.
 */
function Ceiling({
  tier,
  p,
  approach,
}: {
  tier: Tier;
  p: MotionValue<number>;
  approach: MotionValue<number>;
}) {
  // -1 while the section is still below the screen (nothing to draw), then 0 → 0.7 as it scrolls in
  const a = useRange<number>(approach, [0, 0.002, 0.45, 1], [-1, 0, 0, 0.7]);
  const b = useRange<number>(p, [0, 0.08], [0, 0.3]);
  const part = useTransform([a, b], ([x, y]: number[]) => x + y);
  const c = CEILING[tier];
  const lx = useRange(part, [0, 1], ["0vw", c.left.to.x]);
  const ly = useRange(part, [0, 1], ["0vh", c.left.to.y]);
  const rx = useRange(part, [0, 1], ["0vw", c.right.to.x]);
  const ry = useRange(part, [0, 1], ["0vh", c.right.to.y]);
  const opacity = useRange(part, [0.55, 1], [1, 0]);
  // not drawn before the section approaches nor once parted (no layers for them then)
  const visibility = useTransform(part, (v: number) =>
    v < -0.5 || v > 0.995 ? "hidden" : "visible"
  );
  return (
    <>
      <motion.div
        aria-hidden
        style={{ ...c.left.box, x: lx, y: ly, opacity, visibility }}
        className={cn(
          "pointer-events-none absolute will-change-transform",
          IDLE
        )}
      >
        <CeilingMass {...c.left.mass} className="absolute inset-0" />
      </motion.div>
      <motion.div
        aria-hidden
        style={{ ...c.right.box, x: rx, y: ry, opacity, visibility }}
        className={cn(
          "pointer-events-none absolute will-change-transform",
          IDLE
        )}
      >
        <CeilingMass {...c.right.mass} className="absolute inset-0" />
      </motion.div>
    </>
  );
}

/**
 * The bottom edge sinks into the night, so the stage hands over to the proof
 * scene on --night-1 (static). Painted over the vignette and the scrim, so its
 * last rows are exactly --night-1 edge to edge, like the proof scene's top.
 */
function NightBlend() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[18vh] bg-[linear-gradient(to_bottom,transparent,var(--night-1)_90%)]"
    />
  );
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

function BeatCopy({ beat }: { beat: Beat }) {
  return (
    <>
      <p className={SCENE_TYPE.eyebrow}>{beat.eyebrow}</p>
      <h3 className={cn("mt-4 sm:mt-5", SCENE_TYPE.headline)}>{beat.title}</h3>
      <p className={cn("mt-4 max-w-[31rem] sm:mt-6", SCENE_TYPE.lead)}>
        {beat.lead}
      </p>
    </>
  );
}

function FadingBeat({ p, i }: { p: MotionValue<number>; i: number }) {
  const opacity = useRange(p, BEAT_IN[i], BEAT_OP[i]);
  return (
    <motion.div style={{ opacity }} className="col-start-1 row-start-1">
      <BeatCopy beat={BEATS[i]} />
    </motion.div>
  );
}

/** One step of the indicator: its label lights up when the beat starts, its bar fills through the beat. */
function Step({ p, i }: { p: MotionValue<number>; i: number }) {
  const s = STEPS[i];
  const fill = useRange(p, [s.from, s.to], [0, 1]);
  const lit = useRange(
    p,
    i === 0 ? [0, 1] : [s.from - 0.03, s.from],
    i === 0 ? [1, 1] : [0.62, 1]
  );
  return (
    <div className="w-[5.5rem] sm:w-24">
      <motion.p
        style={{ opacity: lit }}
        className="font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--mist)]"
      >
        {s.label}
      </motion.p>
      <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/15">
        <motion.div
          style={{ scaleX: fill }}
          className="h-full origin-left rounded-full bg-[linear-gradient(90deg,var(--lavender),#ffffff)]"
        />
      </div>
    </div>
  );
}

/** The slim 3-step indicator (decorative: the copy carries the content). */
function Steps({
  p,
  className,
}: {
  p: MotionValue<number>;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("grid w-max grid-cols-3 gap-3", className)}>
      {STEPS.map((s, i) => (
        <Step key={s.label} p={p} i={i} />
      ))}
    </div>
  );
}

function IllustrationTag({ className }: { className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute z-10", className)}>
      <FigureTag className="border-white/15 bg-[#0a0c2a]/60 text-[color:rgb(201_204_255/0.86)]">
        Illustration
      </FigureTag>
    </div>
  );
}

/** "Fresh address": static (never moved), placed where the star settles; it fades in when the diamond arrives. */
function FreshLabel({
  tier,
  p,
  still = false,
}: {
  tier: Tier;
  p: MotionValue<number>;
  still?: boolean;
}) {
  const w = WITHDRAW[tier];
  const opacity = useRange(
    p,
    [LEAVE[1] + 0.004, LEAVE[1] + 0.035],
    [still ? 1 : 0, 1]
  );
  const at = poolPoint(w.c[3][0], w.c[3][1]);
  return (
    <motion.p
      aria-hidden
      style={{ ...at, opacity }}
      className={cn(
        // a night-glass pill, so it reads (≥ 4.5:1) over the sky or a pillar alike
        "pointer-events-none absolute z-10 whitespace-nowrap rounded-full border border-white/12 bg-[#0a0c2a]/70 px-2.5 py-1 font-mono text-xs uppercase tracking-[0.16em] text-[color:var(--ink)]",
        w.label === "below"
          ? "mt-6 -translate-x-1/2"
          : "mt-5 -translate-x-[80%]"
      )}
    >
      Fresh address
    </motion.p>
  );
}

/** The pinned copy: three beats cross-fading in one grid cell; the step indicator under them from lg. */
function PinnedCopy({ tier, p }: { tier: Tier; p: MotionValue<number> }) {
  const wide = tier === "wide";
  return (
    <div
      className={cn(
        "relative z-10 flex h-full w-full px-6 sm:px-10",
        wide ? "items-center pb-40 pt-16" : "items-start pt-[92px] sm:pt-28"
      )}
    >
      <div className="mx-auto w-full max-w-7xl">
        <div className={COPY_W[tier]}>
          <h2 id={TITLE_ID} className="sr-only">
            {TITLE}
          </h2>
          <div className="grid">
            {BEATS.map((b, i) => (
              <FadingBeat key={b.eyebrow} p={p} i={i} />
            ))}
          </div>
          {wide && <Steps p={p} className="mt-10" />}
        </div>
      </div>
    </div>
  );
}

// ─── Pinned stage ─────────────────────────────────────────────────────────────

function PoolStage({
  tier,
  progress,
  approach,
}: {
  tier: Tier;
  progress: MotionValue<number>;
  approach: MotionValue<number>;
}) {
  const camera = useRange(progress, CAM_IN, CAM_OUT);
  const wide = tier === "wide";
  // data-pre while the section is still mostly below the screen (see STILL_UNTIL_PIN)
  const frame = useRef<HTMLDivElement>(null);
  useMotionValueEvent(approach, "change", v =>
    frame.current?.toggleAttribute("data-pre", v < PRE_UNTIL)
  );
  useEffect(() => {
    frame.current?.toggleAttribute("data-pre", approach.get() < PRE_UNTIL);
  }, [approach]);
  return (
    <div ref={frame} className="h-full w-full">
      <SceneStage
        progress={camera}
        factor={FACTOR[tier]}
        className={cn("h-full w-full", POOL_VARS[tier])}
      >
        <PoolArt tier={tier} p={progress} />
        <Vignette strength={0.5} />
        <Scrim
          side={wide ? "left" : "top"}
          className={wide ? undefined : "h-[60%]"}
        />
        <NightBlend />
        {/* the front-most cloud: over the scrim, so it keeps the dive's colours (the copy stays legible on it) */}
        <Ceiling tier={tier} p={progress} approach={approach} />
        {/* everything readable: static (only cross-faded), above the art */}
        <div className="pointer-events-none absolute inset-0 z-10">
          <div className="pointer-events-auto absolute inset-0">
            <PinnedCopy tier={tier} p={progress} />
          </div>
          <FreshLabel tier={tier} p={progress} />
          {!wide && (
            <Steps
              p={progress}
              className="absolute bottom-6 left-6 z-10 sm:bottom-8 sm:left-10"
            />
          )}
          <IllustrationTag
            className={
              wide
                ? "bottom-8 right-10"
                : "right-6 top-[84px] sm:right-10 sm:top-24"
            }
          />
        </div>
      </SceneStage>
    </div>
  );
}

function PoolPinned({ tier }: { tier: Tier }) {
  // the section's top edge: drives the ceiling while the section scrolls in, before the pin starts
  const marker = useRef<HTMLDivElement>(null);
  const approach = useSectionProgress(marker, "enter");
  return (
    <PinnedScene
      id="pool"
      heightVh={PIN_VH[tier]}
      labelledBy={TITLE_ID}
      fallback={<PoolStill tier={tier} />}
      outside={
        <div
          ref={marker}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
        />
      }
    >
      {progress => (
        <PoolStage
          key={tier}
          tier={tier}
          progress={progress}
          approach={approach}
        />
      )}
    </PinnedScene>
  );
}

// ─── Still frames (reduced motion, short viewports) ───────────────────────────

/** One beat as a still, complete composition: the settled camera, the beat frozen at its telling moment. */
function StillFrame({ tier, beat }: { tier: Tier; beat: number }) {
  const p = useMotionValue(STILL_AT[beat]);
  const wide = tier === "wide";
  return (
    <SceneStage
      mode="static"
      frame={1}
      factor={FACTOR[tier]}
      className={cn("min-h-[100svh]", POOL_VARS[tier])}
    >
      <PoolArt tier={tier} p={p} />
      <Vignette strength={0.5} />
      <Scrim
        side={wide ? "left" : "top"}
        className={wide ? undefined : "h-[60%]"}
      />
      {/*
        Night at both edges, painted over the vignette and the scrim, so every
        edge is exactly --night-1: the frames join each other, the hero's still
        frame and the proof scene with no line (under the top scrim, a frame's
        top edge was darker than the frame above it ended).
      */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[16vh] bg-[linear-gradient(to_top,transparent,var(--night-1))]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[16vh] bg-[linear-gradient(to_bottom,transparent,var(--night-1))]"
      />
      {beat === 2 && <FreshLabel tier={tier} p={p} still />}
      <div
        className={cn(
          "relative z-10 grid min-h-[100svh] px-6 sm:px-10",
          wide ? "items-center py-24" : "content-start pb-[56vh] pt-24 sm:pt-28"
        )}
      >
        <div className="mx-auto w-full max-w-7xl">
          <div className={COPY_W[tier]}>
            <BeatCopy beat={BEATS[beat]} />
          </div>
        </div>
      </div>
      {beat === 0 && (
        <IllustrationTag
          className={
            wide ? "bottom-8 right-10" : "right-6 top-24 sm:right-10 sm:top-28"
          }
        />
      )}
    </SceneStage>
  );
}

function PoolStill({ tier }: { tier: Tier }) {
  return (
    <section id="pool" aria-labelledby={TITLE_ID} className="relative">
      <h2 id={TITLE_ID} className="sr-only">
        {TITLE}
      </h2>
      {BEATS.map((b, i) => (
        <StillFrame key={b.eyebrow} tier={tier} beat={i} />
      ))}
    </section>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

export default function PoolScene() {
  const safe = useMotionSafe();
  const wide = useMedia("(min-width: 1024px)");
  const phone = useMedia("(max-width: 639px)");
  // too short to pin the copy over the scene: the still frames
  const short = useMedia("(max-height: 619px)");
  const tier: Tier = wide ? "wide" : phone ? "phone" : "tablet";
  if (!safe || short) return <PoolStill tier={tier} />;
  return <PoolPinned tier={tier} />;
}
