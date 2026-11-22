/**
 * Illustrated cloud decks: rows of round puffs whose tops catch the moon and
 * whose bodies fall into shadow, each row further back a little higher and
 * hazier. Three uses:
 *
 *   CloudDeck  a deck in a layer (a cloud sea between ridges, the fox's seat,
 *              a dark backlit foreground deck, a ceiling seen from below)
 *   CloudWipe  the front deck that rises over the whole stage to move between
 *              scenes (the hero's dive); hidden in still frames
 *   CloudSeam  the underside of that deck, hanging below the section's bottom
 *              edge over the top of the next section, so the hand-off has no
 *              straight seam
 *
 * Crisp vector edges with gradients and a thin rim light; no filters.
 */
import { useId, useMemo } from "react";
import { motion, useTransform, type MotionValue } from "framer-motion";
import { cn } from "@/lib/utils";
import { useRange } from "@/components/landing/parallax";
import { useScene } from "./depth";
import { islandPaths, scallopPaths } from "./geometry";

export type CloudTone = "lit" | "dim" | "near" | "wipe";

interface Tone {
  /** lit crest → shaded body → base */
  top: string;
  mid: string;
  low: string;
  rim: string;
  /** opacity of the soft halo drawn along every row's edge (0 = none) */
  halo: number;
  /** undersides: solid body → shaded billows */
  solid: string;
  under: string;
}

const TONES: Record<CloudTone, Tone> = {
  lit: {
    top: "var(--cloud-lit-top)",
    mid: "var(--cloud-lit-mid)",
    low: "var(--cloud-lit-low)",
    rim: "rgb(255 255 255 / 0.5)",
    halo: 0.22,
    solid: "var(--cloud-lit-low)",
    under: "#30357c",
  },
  dim: {
    top: "var(--cloud-dim-top)",
    mid: "var(--cloud-dim-mid)",
    low: "var(--cloud-dim-low)",
    rim: "rgb(228 230 255 / 0.2)",
    halo: 0.16,
    solid: "var(--cloud-dim-low)",
    under: "#1c2160",
  },
  near: {
    top: "var(--cloud-near-top)",
    mid: "var(--cloud-near-mid)",
    low: "var(--cloud-near-low)",
    rim: "var(--cloud-rim)",
    halo: 0.14,
    solid: "var(--cloud-near-low)",
    under: "#0c0f33",
  },
  wipe: {
    top: "var(--wipe-top)",
    mid: "var(--wipe-body)",
    low: "var(--wipe-body)",
    rim: "rgb(255 255 255 / 0.55)",
    halo: 0.26,
    solid: "var(--wipe-deep)",
    under: "var(--wipe-under)",
  },
};

/** narrowest / widest puff in drawing units (the drawing is `viewWidth` wide) */
const PUFF = { small: [56, 150], medium: [86, 230], large: [130, 320] } as const;
/**
 * Rows are opaque (translucent rows overlap into bubbles); depth comes from
 * colour instead: `k` is 1 for the back row and 0 for the front, and back
 * rows are hazier, their bodies lifted towards the lit crest colour.
 */
function rowTone(t: Tone, k: number): { top: string; mid: string; low: string } {
  if (k <= 0) return { top: t.top, mid: t.mid, low: t.low };
  return {
    top: t.top,
    mid: `color-mix(in srgb, ${t.mid} ${Math.round(100 - k * 42)}%, ${t.top})`,
    low: `color-mix(in srgb, ${t.low} ${Math.round(100 - k * 55)}%, ${t.mid})`,
  };
}

export interface CloudDeckProps {
  seed?: number;
  /** "lit" moonlit deck · "near" dark backlit foreground · "wipe" the dive (default "lit") */
  tone?: CloudTone;
  /** "top": puffs bulge up (a deck seen from above); "bottom": an underside hanging down */
  edge?: "top" | "bottom";
  /** rows of puffs (default 3) */
  rows?: 1 | 2 | 3 | 4;
  /** puff size (default "medium") */
  puff?: keyof typeof PUFF;
  /** thin moonlit rim along the front row (default true) */
  rim?: boolean;
  /** drawing size (default 1600 × 400) */
  viewWidth?: number;
  viewHeight?: number;
  /**
   * edge "top" only. "100%" (default): the drawing is sliced to fill the box.
   * Any other CSS length: the drawing sits at the top of the box, never
   * cropped vertically, at least this tall (and at least its natural height
   * for the box's width); below it the box is filled with the deck's base
   * colour, so a deck can run on below the stage for its layer's travel.
   */
  edgeHeight?: string;
  /** override the tone's crest / body / base colours (CSS colours) */
  palette?: { top: string; mid: string; low: string };
  /** the box: position and size */
  className?: string;
}

/** A deck of cloud puffs (aria-hidden). */
export function CloudDeck({
  seed = 3,
  tone = "lit",
  edge = "top",
  rows = 3,
  puff = "medium",
  rim = true,
  viewWidth = 1600,
  viewHeight = 400,
  edgeHeight = "100%",
  palette,
  className,
}: CloudDeckProps) {
  const id = useId().replace(/:/g, "");
  const t: Tone = palette ? { ...TONES[tone], ...palette, solid: palette.low } : TONES[tone];
  const H = viewHeight;
  const [minW, maxW] = PUFF[puff];

  const shapes = useMemo(() => {
    const swell = H * 0.06;
    const reach = maxW * 0.5 + swell + 8; // tallest bulge plus the swell, kept inside the drawing
    const span = (edge === "top" ? H * 0.66 : H * 0.62) - reach;
    const gap = rows > 1 ? Math.min(span / (rows - 1), maxW * 0.42) : 0;
    return Array.from({ length: rows }, (_, i) => {
      // back rows sit further from the deck body: higher for a top edge, lower for an underside
      const y = edge === "top" ? reach + i * gap : H - reach - i * gap;
      const p = scallopPaths(
        seed * 17 + i * 101,
        { y, swell, minW, maxW, width: viewWidth },
        edge,
        edge === "top" ? H + 4 : -4,
      );
      return { ...p, y, swell, k: rows > 1 ? (rows - 1 - i) / (rows - 1) : 0 };
    });
  }, [seed, edge, rows, minW, maxW, H, viewWidth]);

  const fit = edge === "bottom" || edgeHeight === "100%";
  const svg = (
    <svg
      viewBox={`0 0 ${viewWidth} ${H}`}
      preserveAspectRatio={edge === "top" ? "xMidYMin slice" : "xMidYMax slice"}
      className={cn("pointer-events-none block w-full", fit ? "h-full" : "shrink-0")}
      style={fit ? undefined : { aspectRatio: `${viewWidth} / ${H}`, minHeight: edgeHeight }}
      aria-hidden
    >
      <defs>
        {shapes.map((s, i) => {
          if (edge === "top") {
            const c = rowTone(t, s.k);
            return (
              <linearGradient
                key={i}
                id={`${id}-r${i}`}
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1={s.y - s.swell - maxW * 0.42}
                x2="0"
                // settles on the base colour by 80% of the drawing, so a sliced-off bottom never shows a seam
                y2={Math.min(H * 0.8, s.y + H * 0.36)}
              >
                <stop offset="0" style={{ stopColor: c.top }} />
                <stop offset="0.36" style={{ stopColor: c.mid }} />
                <stop offset="1" style={{ stopColor: c.low }} />
              </linearGradient>
            );
          }
          // undersides: the back row (hanging lowest) is the palest
          const under = s.k > 0 ? `color-mix(in srgb, ${t.under} ${Math.round(100 - s.k * 45)}%, ${t.solid})` : t.under;
          return (
            <linearGradient
              key={i}
              id={`${id}-r${i}`}
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2="0"
              y2={s.y + s.swell + maxW * 0.45}
            >
              <stop offset="0" style={{ stopColor: t.solid }} />
              <stop offset="0.5" style={{ stopColor: t.solid }} />
              <stop offset="1" style={{ stopColor: under }} />
            </linearGradient>
          );
        })}
      </defs>
      {shapes.map((s, i) => {
        const front = i === shapes.length - 1;
        return (
          <g key={i}>
            {/* a soft halo along the puffs' edge fakes vapour without a filter */}
            {t.halo > 0 && (
              <path
                d={s.edge}
                fill="none"
                style={{ stroke: edge === "top" ? t.top : t.under }}
                strokeOpacity={t.halo}
                strokeWidth="9"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <path d={s.fill} fill={`url(#${id}-r${i})`} />
            {rim && front && (
              <path
                d={s.edge}
                fill="none"
                style={{ stroke: t.rim }}
                strokeWidth="1.2"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        );
      })}
    </svg>
  );

  if (fit) {
    return (
      <div aria-hidden className={cn("pointer-events-none", className)}>
        {svg}
      </div>
    );
  }
  return (
    <div aria-hidden className={cn("pointer-events-none flex flex-col", className)}>
      {svg}
      <div className="w-full flex-1" style={{ background: t.low }} />
    </div>
  );
}

// ─── Island ───────────────────────────────────────────────────────────────────

/**
 * A floating cloud bank (puffs heaped on top, billows underneath, tapering at
 * both ends): a seat for the fox, or a drifting bank in the sky. Drawn
 * 1000 × 360 and fitted to its box (width sets the size); it may paint a
 * little outside the box. aria-hidden.
 */
export function CloudIsland({
  seed = 9,
  tone = "lit",
  rows = 2,
  rim = true,
  className,
}: {
  seed?: number;
  tone?: CloudTone;
  rows?: 1 | 2 | 3;
  rim?: boolean;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const t = TONES[tone];
  const shapes = useMemo(
    () =>
      Array.from({ length: rows }, (_, i) => {
        const back = rows - 1 - i; // 0 = the front row
        return {
          ...islandPaths(seed * 13 + i * 57, {
            cx: 500 + (back === 0 ? 0 : back % 2 ? -34 : 30),
            cy: 214 - back * 30,
            rx: 470 - back * 46,
            top: 118 + back * 8,
            bottom: 66 - back * 14,
            minW: 86,
            maxW: 168,
          }),
          k: rows > 1 ? back / (rows - 1) : 0,
        };
      }),
    [seed, rows],
  );
  return (
    <svg viewBox="0 0 1000 360" className={cn("pointer-events-none block overflow-visible", className)} aria-hidden>
      <defs>
        {shapes.map((s, i) => {
          const c = rowTone(t, s.k);
          return (
            <linearGradient key={i} id={`${id}-g${i}`} gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="0" y2="300">
              <stop offset="0" style={{ stopColor: c.top }} />
              <stop offset="0.42" style={{ stopColor: c.mid }} />
              <stop offset="0.78" style={{ stopColor: c.low }} />
              <stop offset="1" style={{ stopColor: t.under }} />
            </linearGradient>
          );
        })}
      </defs>
      {shapes.map((s, i) => (
        <g key={i}>
          {t.halo > 0 && (
            <path
              d={s.edge}
              fill="none"
              style={{ stroke: t.top }}
              strokeOpacity={t.halo}
              strokeWidth="9"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <path d={s.fill} fill={`url(#${id}-g${i})`} />
          {rim && i === shapes.length - 1 && (
            <path
              d={s.edge}
              fill="none"
              style={{ stroke: t.rim }}
              strokeWidth="1.4"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      ))}
    </svg>
  );
}

// ─── The dive ─────────────────────────────────────────────────────────────────

export interface CloudWipeProps {
  /** progress window of the rise; covered from its end (default [0.72, 1]) */
  range?: readonly [number, number];
  seed?: number;
  /** defaults to the nearest SceneStage's progress */
  progress?: MotionValue<number>;
  className?: string;
}

// ─── Wall ─────────────────────────────────────────────────────────────────────

export interface CloudBand {
  /** crest, body and base colours of this band (CSS colours) */
  top: string;
  mid: string;
  low: string;
  rows?: 1 | 2 | 3 | 4;
}

/**
 * A tall mass of cloud: bands of billows stacked downwards, each band's lit
 * crests heaped over the shadowed body of the band above, so the mass has
 * volume all the way down instead of a flat fill. Below the last band the box
 * is filled with that band's base colour. Bands are max(edgeHeight, width / 4)
 * tall and overlap two thirds, which hides each band's crest valleys.
 */
export function CloudWall({
  bands,
  seed = 1,
  tone = "wipe",
  puff = "large",
  edgeHeight = "36vh",
  rim = true,
  className,
}: {
  bands: readonly CloudBand[];
  seed?: number;
  /** the tone's halo and rim are used; its colours come from `bands` */
  tone?: CloudTone;
  puff?: keyof typeof PUFF;
  edgeHeight?: string;
  /** rim light along the first band's front row */
  rim?: boolean;
  className?: string;
}) {
  const overlap = `calc(-1 * max(${edgeHeight} * 0.66, 15%))`;
  return (
    <div aria-hidden className={cn("pointer-events-none flex flex-col", className)}>
      {bands.map((band, i) => (
        <div key={i} className="w-full shrink-0" style={i > 0 ? { marginTop: overlap } : undefined}>
          <CloudDeck
            seed={seed + i * 7}
            tone={tone}
            rows={band.rows ?? 3}
            puff={puff}
            rim={rim && i === 0}
            palette={band}
            edgeHeight={edgeHeight}
            className="w-full"
          />
        </div>
      ))}
      <div className="min-h-0 w-full flex-1" style={{ background: bands[bands.length - 1]?.low }} />
    </div>
  );
}

/** Three bands of dark, backlit foreground cloud (a "near" deck with volume). */
export const NEAR_BANDS: readonly CloudBand[] = [
  { top: "var(--cloud-near-top)", mid: "var(--cloud-near-mid)", low: "#181c4f" },
  { top: "#30357d", mid: "#1a1e54", low: "#151946" },
  { top: "#282d70", mid: "#161a4b", low: "var(--cloud-near-low)" },
];

/**
 * The wall of cloud the camera dives into: four bands, each deeper in colour,
 * ending in solid --wipe-deep.
 */
export const WIPE_BANDS: readonly CloudBand[] = [
  { top: "var(--wipe-top)", mid: "#9398e2", low: "#6d72c6", rows: 4 },
  { top: "#babef6", mid: "#7176c8", low: "#5a5fb4" },
  { top: "#9ea3eb", mid: "#575cae", low: "#454a9b" },
  { top: "#8389d9", mid: "#41468f", low: "var(--wipe-deep)" },
];

/**
 * The front deck that rises over the whole stage: its billowing top comes up
 * from below the frame, sweeps it, and from about 90% of `range` the stage is
 * all cloud, billows deepening down to --wipe-deep at the bottom edge (where a
 * CloudSeam tone="wipe" continues it). Renders nothing in a still frame (no
 * wipes with reduced motion). Put it last in the stage.
 */
export function CloudWipe({ range = [0.72, 1], seed = 21, progress, className }: CloudWipeProps) {
  const scene = useScene();
  const p = progress ?? scene.progress;
  const [a, b] = range;
  const at = (f: number) => a + (b - a) * f;
  // eases in: slow while the crest peeks over the bottom edge, fast as it sweeps the frame
  const y = useRange(p, [a, at(0.35), at(0.72), b], ["100vh", "50vh", "-8vh", "-32vh"]);
  // off-screen until the rise starts: hidden, so its tall layer is not drawn
  const visibility = useTransform(p, (v: number) => (v < a - 0.005 ? "hidden" : "visible"));
  if (scene.mode === "static") return null;
  return (
    <motion.div
      aria-hidden
      style={{ y, visibility }}
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-30 flex h-[220vh] flex-col will-change-transform",
        className,
      )}
    >
      <CloudWall bands={WIPE_BANDS} seed={seed} tone="wipe" edgeHeight="36vh" className="w-full shrink-0" />
      {/* moonlight diffusing inside the cloud, gone before the stage's bottom edge (the seam stays flat --wipe-deep) */}
      <div className="w-full flex-1 bg-[linear-gradient(to_bottom,transparent,rgb(150_156_230/0.16)_16vh,transparent_34vh),linear-gradient(var(--wipe-deep),var(--wipe-deep))]" />
    </motion.div>
  );
}

/**
 * The underside of a cloud layer, hanging below the bottom edge of its section
 * (absolute, top: 100%) and over the top of the next one. Its top is solid
 * `tone` (wipe: --wipe-deep, what the stage shows at the end of a CloudWipe;
 * near: the base of a "near" deck) and its billows thin out below. Keeps the
 * drawing's proportions (phones get a narrower drawing, so puffs stay round).
 * The section must stack above the next one (e.g. relative z-20).
 */
export function CloudSeam({
  tone = "wipe",
  seed = 31,
  className,
}: {
  tone?: CloudTone;
  seed?: number;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-full", className)}>
      <CloudDeck
        seed={seed}
        tone={tone}
        edge="bottom"
        rows={2}
        puff="medium"
        rim={tone !== "near"}
        viewWidth={1600}
        viewHeight={190}
        className="hidden aspect-[1600/190] w-full sm:block"
      />
      <CloudDeck
        seed={seed}
        tone={tone}
        edge="bottom"
        rows={2}
        puff="medium"
        rim={tone !== "near"}
        viewWidth={760}
        viewHeight={190}
        className="aspect-[760/190] w-full sm:hidden"
      />
    </div>
  );
}
