/**
 * The scene depth system (spec §3): six depth tokens, back to front, and the
 * motion each one gets.
 *
 *   token     pinned travel*   pass-through speed**   pointer
 *   sky        3vh             0.06                   ±3px
 *   far        8vh             0.14                   ±6px
 *   mid       16vh             0.28                  ±10px
 *   subject   24vh             0.40                  ±16px
 *   near      42vh             0.60                  ±24px
 *   front     70vh             0.90                   —
 *
 *   *  pinned (the stage is fixed): total upward travel over the whole pin
 *   ** pass-through (the stage scrolls with the page): how fast the layer moves
 *      on screen as a fraction of the scroll. Content moves at 1.0, so every art
 *      layer reads as further away than the copy; the sky barely moves.
 *
 * Usage
 *
 *   // pinned: inside PinnedScene's render prop
 *   <PinnedScene id="pool" heightVh={280} fallback={<PoolStill />}>
 *     {(progress) => (
 *       <SceneStage progress={progress} className="h-full">
 *         <NightSky />
 *         <SceneLayer depth="far"><Ridge tier={0} /></SceneLayer>
 *         <SceneLayer depth="mid" push={1.05}>…</SceneLayer>
 *         <div className="relative z-10">copy (static)</div>
 *         <SceneLayer depth="near" className="z-20">…</SceneLayer>
 *       </SceneStage>
 *     )}
 *   </PinnedScene>
 *
 *   // pass-through: the stage is the section and tracks itself
 *   <SceneStage as="section" id="privacy" mode="through" className="h-[140vh]">…</SceneStage>
 *
 *   // reduced motion / still frame: layers sit where they are at `frame`
 *   <SceneStage mode="static" frame={0.2} as="section" id="pool">…</SceneStage>
 *
 * Rules: only art goes in a SceneLayer (it is aria-hidden); content is never
 * scroll-transformed. Key a stage's parent by breakpoint and reduced motion so
 * the travel stays constant per mount. A SceneLayer owns the `translate`
 * property (pointer parallax) and `transform` (scroll): position its children,
 * not the layer, with translate-* utilities. Layers get will-change only while
 * they move, and scene.css takes it away again while their block of the page
 * is idle (Landing marks blocks far off-screen with data-idle) and while the
 * stage carries data-covered (its front CloudWipe hides every plane; the
 * planes are then not drawn at all, see Hero.tsx).
 */
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { motion, motionValue, useMotionValue, useTransform, type MotionValue } from "framer-motion";
import { cn } from "@/lib/utils";
import { usePointerParallax, useSectionProgress } from "@/components/landing/parallax";
import "./scene.css";

// ─── Tokens ───────────────────────────────────────────────────────────────────

export type SceneDepth = "sky" | "far" | "mid" | "subject" | "near" | "front";

/** "pinned": progress of a PinnedScene · "through": the stage scrolls past · "static": a still frame */
export type SceneMode = "pinned" | "through" | "static";

/** Back to front. Speed order equals z-order: render layers in this order. */
export const SCENE_DEPTHS: readonly SceneDepth[] = ["sky", "far", "mid", "subject", "near", "front"];

export interface DepthSpec {
  /** pinned: total upward travel over the pin, in vh */
  travelVh: number;
  /** pass-through: on-screen speed as a fraction of the scroll (content = 1) */
  rate: number;
  /** pointer parallax amplitude in px (fine pointers only) */
  pointerPx: number;
}

export const DEPTH: Record<SceneDepth, DepthSpec> = {
  sky: { travelVh: 3, rate: 0.06, pointerPx: 3 },
  far: { travelVh: 8, rate: 0.14, pointerPx: 6 },
  mid: { travelVh: 16, rate: 0.28, pointerPx: 10 },
  subject: { travelVh: 24, rate: 0.4, pointerPx: 16 },
  near: { travelVh: 42, rate: 0.6, pointerPx: 24 },
  front: { travelVh: 70, rate: 0.9, pointerPx: 0 },
};

// ─── Context ──────────────────────────────────────────────────────────────────

export interface SceneContextValue {
  /** 0 → 1 progress of the stage (constant for "static") */
  progress: MotionValue<number>;
  mode: SceneMode;
  /** travel multiplier (1 = spec; phones use less) */
  factor: number;
  /** "through": px the stage travels through the viewport (viewport + stage height), measured */
  travel: RefObject<number>;
  /** whether the stage runs pointer parallax */
  pointer: boolean;
}

const STILL = motionValue(0);
const SceneContext = createContext<SceneContextValue>({
  progress: STILL,
  mode: "static",
  factor: 1,
  travel: { current: 0 },
  pointer: false,
});

/** The nearest SceneStage's progress, mode and factor (a still frame outside any stage). */
export function useScene(): SceneContextValue {
  return useContext(SceneContext);
}

// ─── Motion ───────────────────────────────────────────────────────────────────

export interface SceneDepthOptions {
  /** defaults to the nearest SceneStage's mode ("pinned" outside a stage) */
  mode?: SceneMode;
  /** travel multiplier; defaults to the stage's factor */
  factor?: number;
  /** pinned: the slice of progress over which the travel happens (default [0, 1]) */
  range?: readonly [number, number];
  /** pinned: override the token's travel (vh) */
  travelVh?: number;
  /** pass-through: override the token's on-screen speed */
  rate?: number;
  /** camera push-in: scale reached at the end of the range (e.g. 1.05; far/mid only). Default 1 */
  push?: number;
}

/**
 * Scroll motion for one depth token: `y` (a "vh" or "px" string) and `scale`
 * (camera push-in) as motion values, plus `moving` (false for still frames and
 * factor 0, i.e. no will-change needed). Use it for custom art groups; most
 * art just goes in a <SceneLayer>.
 */
export function useSceneDepth(
  progress: MotionValue<number>,
  depth: SceneDepth,
  options: SceneDepthOptions = {},
): { y: MotionValue<string>; scale: MotionValue<number>; moving: boolean } {
  const ctx = useContext(SceneContext);
  const mode = options.mode ?? ctx.mode;
  const k = options.factor ?? ctx.factor;
  const [a, b] = options.range ?? [0, 1];
  const spec = DEPTH[depth];
  const travelVh = options.travelVh ?? spec.travelVh;
  const rate = options.rate ?? spec.rate;
  const push = options.push ?? 1;
  const travel = ctx.travel;

  const local = (v: number) => (b > a ? Math.min(1, Math.max(0, (v - a) / (b - a))) : v >= b ? 1 : 0);
  const y = useTransform(progress, (v: number): string => {
    if (mode === "through") {
      // the layer lags its stage so it moves on screen at `rate` × the scroll; natural position mid-pass
      const d = travel.current || (typeof window === "undefined" ? 0 : window.innerHeight * 2);
      return `${(k * (1 - rate) * (v - 0.5) * d).toFixed(2)}px`;
    }
    return `${(-k * travelVh * local(v)).toFixed(3)}vh`;
  });
  const scale = useTransform(progress, (v: number) =>
    push === 1 ? 1 : 1 + (push - 1) * k * (mode === "through" ? v : local(v)),
  );
  return { y, scale, moving: mode !== "static" && k !== 0 };
}

// ─── Stage ────────────────────────────────────────────────────────────────────

export interface SceneStageProps extends Omit<ComponentProps<"div">, "children" | "ref"> {
  /** default: "pinned" when `progress` is given, else "through" */
  mode?: SceneMode;
  /** pinned: PinnedScene's progress. Through: omit and the stage tracks itself */
  progress?: MotionValue<number>;
  /** travel multiplier for every layer (phones 0.6–0.8). Default 1 */
  factor?: number;
  /** static: the progress the still frame is composed at. Default 0 */
  frame?: number;
  /** pointer parallax on fine pointers (never in static mode). Default true */
  pointer?: boolean;
  /** element to render; "section" for a pass-through scene that is its own section */
  as?: "div" | "section";
  children: ReactNode;
}

/**
 * The frame of a scene: a clipped, isolated box that is always night-themed
 * (it carries the `dark` class, so tokens, dark: variants and the sky art use
 * their dark values in both themes) and hands its progress to its layers.
 * Runs pointer parallax (--px / --py on this element) on fine pointers.
 * A stage whose CloudWipe fully hides it may set `data-covered` on this
 * element: its layers then stop drawing (scene.css). Hero.tsx does this.
 */
export function SceneStage(props: SceneStageProps) {
  const mode = props.mode ?? (props.progress ? "pinned" : "through");
  if (mode === "through" && !props.progress) return <SelfTrackingStage {...props} mode="through" />;
  return <StageFrame {...props} mode={mode} />;
}

function SelfTrackingStage(props: SceneStageProps) {
  const ref = useRef<HTMLElement>(null);
  const progress = useSectionProgress(ref, "through");
  return <StageFrame {...props} progress={progress} stageRef={ref} />;
}

const NO_POINTER: RefObject<HTMLElement | null> = { current: null };

function StageFrame({
  mode = "pinned",
  progress,
  factor = 1,
  frame = 0,
  pointer = true,
  as = "div",
  className,
  children,
  stageRef,
  ...rest
}: SceneStageProps & { stageRef?: RefObject<HTMLElement | null> }) {
  const ownRef = useRef<HTMLElement>(null);
  const ref = stageRef ?? ownRef;
  const still = useMotionValue(frame);
  const p = mode === "static" || !progress ? still : progress;
  const live = pointer && mode !== "static";
  usePointerParallax(live ? ref : NO_POINTER);

  // pass-through: measure how far the stage travels through the viewport. The
  // measured value is also state, so the layers re-render (and recompute their
  // offset) when it changes, not only on the next scroll.
  const travel = useRef(0);
  const [measured, setMeasured] = useState(0);
  useLayoutEffect(() => {
    if (mode !== "through") return;
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      travel.current = window.innerHeight + el.offsetHeight;
      setMeasured(travel.current);
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [mode, ref]);

  const value = useMemo<SceneContextValue>(
    () => ({ progress: p, mode, factor, travel, pointer: live }),
    // `measured` is read through `travel`; it is a dependency so consumers update when it changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p, mode, factor, live, measured],
  );
  const shared = {
    ...rest,
    "data-scene": mode,
    "data-pointer": live ? "" : undefined,
    className: cn("scene dark relative isolate overflow-hidden", className),
  };
  const body = <SceneContext.Provider value={value}>{children}</SceneContext.Provider>;
  return as === "section" ? (
    <section ref={ref as RefObject<HTMLElement>} {...shared}>
      {body}
    </section>
  ) : (
    <div ref={ref as RefObject<HTMLDivElement>} {...shared}>
      {body}
    </div>
  );
}

// ─── Layer ────────────────────────────────────────────────────────────────────

export interface SceneLayerProps {
  depth: SceneDepth;
  /** positioning/size; default box is absolute inset-0 */
  className?: string;
  style?: CSSProperties;
  /** pinned: the slice of progress over which this layer travels */
  range?: readonly [number, number];
  /** pinned: override the token's travel (vh) */
  travelVh?: number;
  /** camera push-in end scale (far/mid only), e.g. 1.05; set the origin with an origin-* class */
  push?: number;
  /** follow the pointer (default true) */
  pointer?: boolean;
  children?: ReactNode;
}

/**
 * One art plane at a depth token: scroll travel (transform) + pointer parallax
 * (translate) on a single element, so each plane is one compositing layer
 * while it moves and none while its block is idle or its stage is covered
 * (`.scene-layer` rules in scene.css; "covered" applies to layers rendered
 * directly in the stage). aria-hidden and pointer-events none: art only.
 */
export function SceneLayer({ depth, className, style, range, travelVh, push, pointer = true, children }: SceneLayerProps) {
  const ctx = useContext(SceneContext);
  const { y, scale, moving } = useSceneDepth(ctx.progress, depth, { range, travelVh, push });
  return (
    <motion.div
      aria-hidden
      data-depth={depth}
      className={cn(
        "scene-layer pointer-events-none absolute inset-0",
        pointer && ctx.pointer && `scene-depth-${depth}`,
        (moving || (pointer && ctx.pointer)) && "will-change-transform",
        className,
      )}
      style={push && push !== 1 ? { ...style, y, scale } : { ...style, y }}
    >
      {children}
    </motion.div>
  );
}
