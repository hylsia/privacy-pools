/**
 * Art for the calm bands after the fog (Guarantees #design, Network #network):
 * their skies, the night blends at their edges, the inline sparkle of the
 * Network line and the chain lanes (rows of glowing blocks that slide sideways
 * with the scroll). All aria-hidden, deterministic and drawn with gradients
 * only (no filters). Each lane is ONE static SVG that slides as one layer;
 * nothing inside it animates (an animated SVG child would repaint the whole
 * lane every frame).
 */
import { useId, useMemo, type CSSProperties } from "react";
import { motion, type MotionValue } from "framer-motion";
import { useRange } from "@/components/landing/parallax";
import { SceneSparkles, type SceneSparkleSpec } from "./NightSky";
import { cn } from "@/lib/utils";

// ─── Skies ────────────────────────────────────────────────────────────────────

const SKIES = {
  /** Guarantees: a moonlit horizon low on the right, a violet nebula top left */
  vista: [
    "radial-gradient(34% 26% at 16% 18%, rgb(106 75 224 / 0.13), transparent 70%)",
    "radial-gradient(46% 30% at 76% 46%, rgb(174 180 255 / 0.17), transparent 72%)",
    "radial-gradient(100% 24% at 50% 54%, rgb(174 180 255 / 0.12), transparent 74%)",
    "linear-gradient(180deg, #0a0c2a 0%, #0b0e30 16%, #10154a 34%, #1a2060 48%, #262d70 57%, #1d2262 68%, #121646 82%, #0a0c2a 100%)",
  ].join(","),
  /** Network: a violet horizon behind the chain, deep night above and below */
  chain: [
    "radial-gradient(42% 26% at 84% 16%, rgb(106 75 224 / 0.12), transparent 70%)",
    "radial-gradient(36% 24% at 10% 30%, rgb(139 108 246 / 0.1), transparent 70%)",
    "radial-gradient(90% 20% at 50% 44%, rgb(174 180 255 / 0.13), transparent 74%)",
    "linear-gradient(180deg, #0a0c2a 0%, #0c0f33 14%, #12174a 30%, #1e2564 42%, #1a1f5a 52%, #10143f 70%, #0a0c2a 100%)",
  ].join(","),
} as const;

/**
 * The band's sky gradient. Put it in the band's "sky" SceneLayer so it drifts
 * with the stars; it overhangs the layer (className) so the travel never
 * uncovers an edge.
 */
export function BandSky({ variant, className }: { variant: keyof typeof SKIES; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute -inset-x-8 -bottom-[30vh] -top-[30vh]", className)}
      style={{ background: SKIES[variant] }}
    />
  );
}

/** Opacity of the night along a blend, from the band's edge inwards. */
const BLEND_STOPS = {
  /** ~16vh: the usual seam */
  soft: "rgb(10 12 42) 0%, rgb(10 12 42 / 0.9) 18%, rgb(10 12 42 / 0.62) 42%, rgb(10 12 42 / 0.28) 68%, rgb(10 12 42 / 0.08) 88%, rgb(10 12 42 / 0) 100%",
  /** ~22vh, opaque for longer: hides slow ridge crests that straddle the band's edge */
  deep: "rgb(10 12 42) 0%, rgb(10 12 42 / 0.97) 24%, rgb(10 12 42 / 0.84) 44%, rgb(10 12 42 / 0.52) 66%, rgb(10 12 42 / 0.18) 85%, rgb(10 12 42 / 0) 100%",
} as const;

/**
 * Static blend from the page night (--night-1) into the band at its top or
 * bottom edge (~16vh; `deep`: ~22vh and opaque for longer), so bands join
 * their neighbours with no line. Above the art, below the copy.
 */
export function NightBlend({ edge, deep = false, className }: { edge: "top" | "bottom"; deep?: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-x-0", deep ? "h-[22vh]" : "h-[16vh]", edge === "top" ? "top-0" : "bottom-0", className)}
      style={{
        background: `linear-gradient(${edge === "top" ? "to bottom" : "to top"}, ${BLEND_STOPS[deep ? "deep" : "soft"]})`,
      }}
    />
  );
}

// ─── Mist ─────────────────────────────────────────────────────────────────────

/**
 * A wide band of mist, static inside its plane (put it in a SceneLayer to give
 * it a depth). Like the kit's FogBand, but it stays inside the plane's 32px
 * overhang: a band reaching far past its plane (FogBand's −30% / 160%) is
 * lifted onto a compositing layer of its own, and so is everything drawn over
 * it in that plane. The ellipse is wider than the box, so the mist still
 * reaches the screen edges.
 */
export function MistBand({
  top,
  height,
  alpha = 0.1,
  tone = "lavender",
  className,
}: {
  /** CSS lengths */
  top: string;
  height: string;
  /** peak opacity (0.06–0.14) */
  alpha?: number;
  tone?: "lavender" | "mist";
  className?: string;
}) {
  const c = tone === "mist" ? "201 204 255" : "174 180 255";
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none absolute -inset-x-8", className)}
      style={{
        top,
        height,
        background: `radial-gradient(74% 50% at 50% 50%, rgb(${c} / ${alpha}), rgb(${c} / ${(alpha * 0.42).toFixed(3)}) 56%, transparent 100%)`,
      }}
    />
  );
}

// ─── Inline sparkle ───────────────────────────────────────────────────────────

const SPARKLE_PATH =
  "M12 0C12.9 7.3 16.7 11.1 24 12C16.7 12.9 12.9 16.7 12 24C11.1 16.7 7.3 12.9 0 12C7.3 11.1 11.1 7.3 12 0Z";

/** The four-point sparkle set inline in a line of display type (0.52em, gold with a drawn glow). */
export function SparkGlyph({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      aria-hidden
      viewBox="-12 -12 48 48"
      className={cn("inline-block h-[0.62em] w-[0.62em] overflow-visible align-[0.06em]", className)}
    >
      <defs>
        <radialGradient id={`${id}-g`}>
          <stop offset="0" stopColor="#f5d58a" stopOpacity="0.5" />
          <stop offset="0.4" stopColor="#d4ac4e" stopOpacity="0.16" />
          <stop offset="1" stopColor="#d4ac4e" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="24" fill={`url(#${id}-g)`} />
      <path d={SPARKLE_PATH} fill="#f5d58a" />
    </svg>
  );
}

// ─── Chain lanes ──────────────────────────────────────────────────────────────

export type LaneDepth = "far" | "mid" | "near";
export type LaneMark = "deposit" | "withdraw";

/** Block box (front face w × h), the receding top/side (dx, dy), the gap to the next block and the corner radius. */
interface LaneSize {
  w: number;
  h: number;
  dx: number;
  dy: number;
  gap: number;
  r: number;
}

const SIZE: Record<LaneDepth, LaneSize> = {
  far: { w: 36, h: 26, dx: 8, dy: 7, gap: 22, r: 3 },
  mid: { w: 62, h: 44, dx: 13, dy: 11, gap: 30, r: 5 },
  near: { w: 104, h: 72, dx: 22, dy: 18, gap: 42, r: 8 },
};

/** Far lanes are hazier and dimmer, near lanes crisper (atmospheric perspective). */
const TONE: Record<LaneDepth, { front: [string, string]; top: [string, string]; side: string; edge: number; link: number; alpha: number; ledger: number }> = {
  far: { front: ["#323883", "#272d6c"], top: ["#646ab8", "#4b51a0"], side: "#1f2563", edge: 0.22, link: 0.26, alpha: 0.62, ledger: 0 },
  mid: { front: ["#373d8e", "#21276a"], top: ["#777dcc", "#5257ac"], side: "#191e57", edge: 0.32, link: 0.34, alpha: 0.86, ledger: 2 },
  near: { front: ["#3e4498", "#1d2262"], top: ["#9095e2", "#5f64bc"], side: "#141849", edge: 0.42, link: 0.42, alpha: 1, ledger: 3 },
};

/** Label metrics of a marked block (fixed px so the text never drops under 10–11px). */
interface MarkSpec {
  w: number;
  iconX: number;
  iconR: number;
  textX: number;
  title: number;
  /** "public tx" under the title (not on phones) */
  sub: number | null;
}

function markSpec(mark: LaneMark, compact: boolean): MarkSpec {
  if (mark === "deposit") {
    return compact
      ? { w: 84, iconX: 13, iconR: 7.5, textX: 26, title: 11, sub: null }
      : { w: 112, iconX: 18, iconR: 10.5, textX: 35, title: 12, sub: 10 };
  }
  return compact
    ? { w: 112, iconX: 17, iconR: 9.5, textX: 33, title: 11.5, sub: null }
    : { w: 152, iconX: 27, iconR: 14, textX: 50, title: 13, sub: 10.5 };
}

const MARK_LABEL: Record<LaneMark, string> = { deposit: "Deposit", withdraw: "Withdrawal" };

interface PlacedBlock {
  x: number;
  w: number;
  mark?: LaneMark;
}

export interface LaneLayout {
  blocks: PlacedBlock[];
  /** lane width and height in px */
  width: number;
  height: number;
  /** x of the centre block's centre: the lane is placed so this sits mid-screen at rest */
  centre: number;
  size: LaneSize;
  /** top of the front faces */
  y: number;
}

/**
 * Lays out one lane: `count` blocks (scaled by `scale`), the marks at their
 * index offsets from the centre block.
 */
export function layoutLane(
  depth: LaneDepth,
  count: number,
  scale: number,
  marks: Partial<Record<number, LaneMark>>,
  compact: boolean,
): LaneLayout {
  const base = SIZE[depth];
  const size: LaneSize = {
    w: Math.round(base.w * scale),
    h: Math.round(base.h * scale),
    dx: Math.round(base.dx * scale),
    dy: Math.round(base.dy * scale),
    gap: Math.round(base.gap * scale),
    r: Math.max(2, Math.round(base.r * scale)),
  };
  const mid = Math.floor(count / 2);
  const blocks: PlacedBlock[] = [];
  let x = 6;
  for (let i = 0; i < count; i++) {
    const mark = marks[i - mid];
    const w = mark ? markSpec(mark, compact).w : size.w;
    blocks.push({ x, w, mark });
    x += w + size.dx + size.gap;
  }
  const c = blocks[mid];
  return {
    blocks,
    width: Math.round(x - size.gap + 6),
    height: size.dy + size.h + 18,
    centre: c.x + c.w / 2,
    size,
    y: size.dy + 2,
  };
}

/** Deterministic widths for the "ledger" lines on a block's face. */
const LEDGER = [0.62, 0.38, 0.5, 0.72, 0.44, 0.56, 0.34];

/** One lane as one SVG: rail, glows, links and the blocks with their marks. */
function LaneDrawing({ depth, layout, compact }: { depth: LaneDepth; layout: LaneLayout; compact: boolean }) {
  const id = useId().replace(/:/g, "");
  const tone = TONE[depth];
  const { blocks, width, height, size, y } = layout;
  const { h, dx, dy, r } = size;
  const linkY = y + h * 0.56;
  const railY = y + h + 7;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={`${id}-front`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tone.front[0]} />
          <stop offset="1" stopColor={tone.front[1]} />
        </linearGradient>
        <linearGradient id={`${id}-top`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={tone.top[0]} />
          <stop offset="1" stopColor={tone.top[1]} />
        </linearGradient>
        <linearGradient id={`${id}-mfront`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8b6cf6" />
          <stop offset="0.55" stopColor="#5b3fd6" />
          <stop offset="1" stopColor="#3b22b8" />
        </linearGradient>
        <linearGradient id={`${id}-mtop`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#cfc4ff" />
          <stop offset="1" stopColor="#9d8af2" />
        </linearGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" stopColor="#aeb4ff" stopOpacity="0.3" />
          <stop offset="1" stopColor="#aeb4ff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-mglow`}>
          <stop offset="0" stopColor="#b9a8ff" stopOpacity="0.55" />
          <stop offset="0.45" stopColor="#8b6cf6" stopOpacity="0.2" />
          <stop offset="1" stopColor="#8b6cf6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-rail`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#aeb4ff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#aeb4ff" stopOpacity="0.32" />
          <stop offset="1" stopColor="#aeb4ff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g opacity={tone.alpha}>
        {/* the rail the blocks ride on, and the light each block throws on it */}
        <rect x="0" y={railY} width={width} height="1" fill={`url(#${id}-rail)`} />
        {blocks.map((b, i) => (
          <ellipse
            key={`g${i}`}
            cx={b.x + b.w / 2 + dx / 2}
            cy={railY}
            rx={b.mark ? b.w * 0.95 : b.w * 0.66}
            ry={b.mark ? h * 0.42 : h * 0.16}
            fill={`url(#${id}-${b.mark ? "mglow" : "glow"})`}
          />
        ))}

        {/* links: a thread between blocks with a node in the middle */}
        {blocks.slice(0, -1).map((b, i) => {
          const x1 = b.x + b.w + dx * 0.6;
          const x2 = blocks[i + 1].x;
          return (
            <g key={`l${i}`}>
              <line x1={x1} y1={linkY} x2={x2} y2={linkY} stroke="#aeb4ff" strokeOpacity={tone.link} strokeWidth={depth === "near" ? 1.4 : 1} />
              <circle cx={(x1 + x2) / 2} cy={linkY} r={depth === "near" ? 2.6 : depth === "mid" ? 1.9 : 1.4} fill="#c9ccff" fillOpacity={tone.link + 0.2} />
            </g>
          );
        })}

        {blocks.map((b, i) => (
          <Block key={i} id={id} b={b} i={i} y={y} h={h} dx={dx} dy={dy} r={r} depth={depth} compact={compact} />
        ))}
      </g>
    </svg>
  );
}

function Block({
  id,
  b,
  i,
  y,
  h,
  dx,
  dy,
  r,
  depth,
  compact,
}: {
  id: string;
  b: PlacedBlock;
  i: number;
  y: number;
  h: number;
  dx: number;
  dy: number;
  r: number;
  depth: LaneDepth;
  compact: boolean;
}) {
  const tone = TONE[depth];
  const { x, w, mark } = b;
  // receding faces first; the front face (rounded) covers their joints
  const top = `M${x + r * 0.6} ${y}L${x + dx + r * 0.4} ${y - dy}L${x + w + dx} ${y - dy}L${x + w} ${y}Z`;
  const side = `M${x + w} ${y}L${x + w + dx} ${y - dy}L${x + w + dx} ${y + h - dy - r * 0.4}L${x + w - r * 0.4} ${y + h}Z`;
  const ledger = mark ? 0 : tone.ledger;
  return (
    <g>
      <path d={side} fill={mark ? "#2a1a8a" : tone.side} />
      <path d={top} fill={`url(#${id}-${mark ? "mtop" : "top"})`} />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={r}
        fill={`url(#${id}-${mark ? "mfront" : "front"})`}
        stroke={mark ? "#e2e3ff" : "#c9ccff"}
        strokeOpacity={mark ? 0.62 : tone.edge}
        strokeWidth={mark ? 1.2 : 1}
      />
      {/* the lit edge where the top meets the front */}
      <path
        d={`M${x + r} ${y + 0.5}L${x + w - r * 0.5} ${y + 0.5}`}
        stroke="#eceaff"
        strokeOpacity={mark ? 0.9 : tone.edge + 0.25}
        strokeWidth={depth === "far" ? 0.8 : 1.2}
        strokeLinecap="round"
      />
      {Array.from({ length: ledger }, (_, k) => (
        <rect
          key={k}
          x={x + w * 0.16}
          y={y + h * (0.3 + k * 0.2)}
          width={w * 0.68 * LEDGER[(i * 3 + k) % LEDGER.length]}
          height={depth === "near" ? 2.2 : 1.6}
          rx="1"
          fill="#aeb4ff"
          fillOpacity={0.26 - k * 0.04}
        />
      ))}
      {mark && <MarkFace mark={mark} x={x} y={y} h={h} compact={compact} />}
    </g>
  );
}

/** The label of a marked block: an arrow in a ring, the transaction kind and "public tx". 11–13px, aria-hidden. */
function MarkFace({ mark, x, y, h, compact }: { mark: LaneMark; x: number; y: number; h: number; compact: boolean }) {
  const s = markSpec(mark, compact);
  const cx = x + s.iconX;
  const cy = y + h / 2;
  const a = s.iconR * 0.48;
  // arrow down into the pool (deposit) or up and out (withdrawal)
  const arrow =
    mark === "deposit"
      ? `M${cx} ${cy - a}L${cx} ${cy + a}M${cx - a * 0.62} ${cy + a * 0.36}L${cx} ${cy + a}L${cx + a * 0.62} ${cy + a * 0.36}`
      : `M${cx} ${cy + a}L${cx} ${cy - a}M${cx - a * 0.62} ${cy - a * 0.36}L${cx} ${cy - a}L${cx + a * 0.62} ${cy - a * 0.36}`;
  const textX = x + s.textX;
  return (
    <g>
      <circle cx={cx} cy={cy} r={s.iconR} fill="#f4f3ff" fillOpacity="0.16" stroke="#f4f3ff" strokeOpacity="0.5" strokeWidth="1" />
      <path d={arrow} fill="none" stroke="#ffffff" strokeWidth={compact ? 1.4 : 1.7} strokeLinecap="round" strokeLinejoin="round" />
      {s.sub == null ? (
        <text x={textX} y={cy + s.title * 0.36} fill="#ffffff" fontSize={s.title} fontWeight={600} style={{ fontFamily: "var(--font-sans)" }}>
          {MARK_LABEL[mark]}
        </text>
      ) : (
        <>
          <text x={textX} y={cy - 1.5} fill="#ffffff" fontSize={s.title} fontWeight={600} style={{ fontFamily: "var(--font-sans)" }}>
            {MARK_LABEL[mark]}
          </text>
          <text
            x={textX}
            y={cy + s.sub + 2.5}
            fill="#e2e3ff"
            fillOpacity="0.86"
            fontSize={s.sub}
            letterSpacing="0.06em"
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
          >
            PUBLIC TX
          </text>
        </>
      )}
    </g>
  );
}

export interface ChainLaneProps {
  depth: LaneDepth;
  layout: LaneLayout;
  compact: boolean;
  /** the stage's progress */
  progress: MotionValue<number>;
  /** horizontal travel in vw per unit of progress (0 = still) */
  speed: number;
  /** progress at which the lane rests at its centred position (the band mid-screen) */
  restAt: number;
  /** top of the lane in the band (CSS length) */
  top: string;
  /** a twinkling sparkle on each marked block */
  sparkles?: boolean;
  className?: string;
}

/**
 * One lane, centred on the band and sliding sideways with the scroll: the
 * lane sits centred when progress = restAt and moves `speed` vw per unit of
 * progress (every lane the same way; nearer lanes further). `speed` must be
 * constant per mount (key the band by breakpoint and reduced motion).
 */
export function ChainLane({ depth, layout, compact, progress, speed, restAt, top, sparkles = true, className }: ChainLaneProps) {
  const x = useRange(progress, [0, 1], [`${(-speed * restAt).toFixed(3)}vw`, `${(speed * (1 - restAt)).toFixed(3)}vw`]);
  const moving = speed !== 0;
  const marks = useMemo<SceneSparkleSpec[]>(
    () =>
      sparkles
        ? layout.blocks
            .filter((b) => b.mark)
            .map((b, i) => ({
              left: `${b.x + b.w + layout.size.dx * 0.5}px`,
              top: `${layout.y - layout.size.dy * 0.4}px`,
              size: depth === "near" ? 15 : 12,
              tone: "white" as const,
              delay: i * 2.2 + (depth === "near" ? 1.1 : 0),
            }))
        : [],
    [layout, depth, sparkles],
  );
  const box: CSSProperties = { top, left: `calc(50% - ${layout.centre}px)`, width: layout.width, height: layout.height };
  return (
    <div aria-hidden className={cn("pointer-events-none absolute", className)} style={box}>
      <motion.div style={moving ? { x } : undefined} className={cn("relative h-full w-full", moving && "will-change-transform")}>
        <LaneDrawing depth={depth} layout={layout} compact={compact} />
        {marks.length > 0 && <SceneSparkles items={marks} />}
      </motion.div>
    </div>
  );
}
