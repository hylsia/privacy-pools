/**
 * Atmosphere for the scenes: fog bands, the proof constellation, and the three
 * overlays (film grain, vignette, scrim). All aria-hidden; fog and overlays are
 * radial / linear gradients (no filters), the constellation draws its lines
 * with SVG pathLength.
 */
import { useId, type CSSProperties } from "react";
import { motion, motionValue, useTransform, type MotionValue } from "framer-motion";
import { cn } from "@/lib/utils";

/** A motion value that is always 1 (a finished drawing). */
const FULL = motionValue(1);

// ─── Fog ──────────────────────────────────────────────────────────────────────

export interface FogBandSpec {
  /** box of the band (CSS lengths; a band is a wide soft ellipse) */
  top: string;
  height: string;
  left?: string;
  width?: string;
  /** peak opacity of the band, 0.06–0.14 per spec (default 0.1) */
  alpha?: number;
  /** "lavender" (default) or the paler "mist" */
  tone?: "lavender" | "mist";
  /** slow sideways drift (CSS transform; off with reduced motion / idle) */
  drift?: boolean;
  /** drift amplitude as a % of the band's width (default 4) and period in s (default 34) */
  driftPct?: number;
  period?: number;
  className?: string;
}

/** One soft fog band. Put bands in different SceneLayers to move them at different depths. */
export function FogBand({
  top,
  height,
  left = "-30%",
  width = "160%",
  alpha = 0.1,
  tone = "lavender",
  drift = false,
  driftPct = 4,
  period = 34,
  className,
}: FogBandSpec) {
  return (
    <span
      aria-hidden
      className={cn("scene-fog-band", tone === "mist" && "is-mist", drift && "is-drift", className)}
      style={
        {
          top,
          height,
          left,
          width,
          "--fog-a": alpha,
          "--fog-dx": `${driftPct}%`,
          "--fog-t": `${period}s`,
        } as CSSProperties
      }
    />
  );
}

/** Several fog bands in one box (absolute inset-0 by default). */
export function Fog({ bands, className }: { bands: readonly FogBandSpec[]; className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0", className)}>
      {bands.map((b, i) => (
        <FogBand key={i} {...b} />
      ))}
    </div>
  );
}

// ─── Constellation ────────────────────────────────────────────────────────────

export interface StarNode {
  x: number;
  y: number;
  /** core radius in drawing units (default 4) */
  r?: number;
  /** "white" (default), "lavender", or "gold" (your note only) */
  tone?: "white" | "lavender" | "gold";
}

const NODE_FILL = { white: "#f4f3ff", lavender: "#aeb4ff", gold: "#f5d58a" } as const;

export interface ConstellationProps {
  nodes: readonly StarNode[];
  /** pairs of node indexes, drawn in this order */
  links: readonly (readonly [number, number])[];
  /**
   * 0 → 1: draws the links one after another (each gets an equal slice) and
   * lights each node as the first line reaches it. Omit for a finished drawing.
   */
  draw?: MotionValue<number>;
  /** drawing space (default "0 0 1000 600") */
  viewBox?: string;
  preserveAspectRatio?: string;
  /** line colour (default lavender) */
  stroke?: string;
  className?: string;
}

/** Star nodes joined by lines drawn with pathLength (for the proof). aria-hidden. */
export function Constellation({
  nodes,
  links,
  draw,
  viewBox = "0 0 1000 600",
  preserveAspectRatio = "xMidYMid meet",
  stroke = "#aeb4ff",
  className,
}: ConstellationProps) {
  const id = useId().replace(/:/g, "");
  const n = links.length;
  // when does each node light up: at the start of the first link that touches it
  const firstAt = nodes.map((_, i) => {
    const k = links.findIndex(([a, b]) => a === i || b === i);
    return k < 0 ? 0 : k / Math.max(1, n);
  });
  return (
    <svg viewBox={viewBox} preserveAspectRatio={preserveAspectRatio} className={cn("pointer-events-none overflow-visible", className)} aria-hidden>
      <defs>
        {(["white", "lavender", "gold"] as const).map((t) => (
          <radialGradient key={t} id={`${id}-${t}`}>
            <stop offset="0" stopColor={NODE_FILL[t]} stopOpacity="0.55" />
            <stop offset="0.4" stopColor={NODE_FILL[t]} stopOpacity="0.16" />
            <stop offset="1" stopColor={NODE_FILL[t]} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {links.map(([a, b], i) => (
        <ConstellationLine
          key={`${a}-${b}`}
          from={nodes[a]}
          to={nodes[b]}
          draw={draw}
          start={i / Math.max(1, n)}
          end={(i + 1) / Math.max(1, n)}
          stroke={stroke}
        />
      ))}
      {nodes.map((node, i) => (
        <ConstellationNode key={i} node={node} gradient={`url(#${id}-${node.tone ?? "white"})`} draw={draw} at={firstAt[i]} />
      ))}
    </svg>
  );
}

function ConstellationLine({
  from,
  to,
  draw,
  start,
  end,
  stroke,
}: {
  from: StarNode;
  to: StarNode;
  draw?: MotionValue<number>;
  start: number;
  end: number;
  stroke: string;
}) {
  const length = useTransform(draw ?? FULL, (v: number) => (end > start ? Math.min(1, Math.max(0, (v - start) / (end - start))) : 1));
  return (
    <motion.path
      d={`M${from.x} ${from.y}L${to.x} ${to.y}`}
      fill="none"
      stroke={stroke}
      strokeOpacity="0.7"
      strokeWidth="1.5"
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
      style={{ pathLength: length }}
    />
  );
}

function ConstellationNode({
  node,
  gradient,
  draw,
  at,
}: {
  node: StarNode;
  gradient: string;
  draw?: MotionValue<number>;
  at: number;
}) {
  const opacity = useTransform(draw ?? FULL, (v: number) => Math.min(1, Math.max(0.15, (v - at) * 12 + 0.15)));
  const r = node.r ?? 4;
  return (
    <motion.g style={{ opacity }}>
      <circle cx={node.x} cy={node.y} r={r * 5} fill={gradient} />
      <circle cx={node.x} cy={node.y} r={r} fill={NODE_FILL[node.tone ?? "white"]} />
    </motion.g>
  );
}

// ─── Overlays ─────────────────────────────────────────────────────────────────

/**
 * One static film-grain overlay for the whole page (fixed, ~4%, not animated,
 * below the nav). Mount it once, in Landing.tsx.
 */
export function Grain({ opacity, className }: { opacity?: number; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("scene-grain", className)}
      style={opacity == null ? undefined : ({ "--grain": opacity } as CSSProperties)}
    />
  );
}

/** Soft radial darkening of a scene's edges (static; put it above the art, below the copy). */
export function Vignette({ strength = 0.55, className }: { strength?: number; className?: string }) {
  return <div aria-hidden className={cn("scene-vignette", className)} style={{ "--vignette": strength } as CSSProperties} />;
}

/**
 * A gradient behind a text block, for legibility over the art (static).
 * "left": a radial pool behind a left column · "bottom" / "top": a band ·
 * "center": a radial pool in the middle. Position overrides go in className.
 */
export function Scrim({ side = "left", className }: { side?: "left" | "bottom" | "top" | "center"; className?: string }) {
  return <div aria-hidden className={cn("scene-scrim", `scene-scrim--${side}`, className)} />;
}
