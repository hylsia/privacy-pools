/**
 * Shared scroll/pointer parallax primitives for the landing page.
 *
 * Motion language (keep every section consistent):
 *   - animate transform + opacity only (and SVG pathLength); never layout properties
 *   - far layers move little and with the scroll, near layers move more / against it
 *   - every scroll range goes through useRange() so offsets are always valid [0, 1]
 *   - ranges are constant for the life of a mount: key bodies by breakpoint / reduced motion
 *   - prefers-reduced-motion → no movement, static fallbacks for pinned scenes
 *   - content (text, cards, data, logos) is never scroll-transformed; it only gets the reveal
 *   - one clock per choreography: linked beats read raw progress; useSmooth is for backdrops only
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import {
  motion,
  transform,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
  type MotionValue,
} from "framer-motion";

/** true when movement is allowed (user has not asked for reduced motion). */
export function useMotionSafe(): boolean {
  return !useReducedMotion();
}

/**
 * matchMedia as a boolean, e.g. useMedia("(max-width: 767px)"). Updates when
 * the query flips, never on scroll. False on the server. Use it to key bodies
 * whose scroll ranges depend on the breakpoint.
 */
export function useMedia(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/**
 * Map scroll progress through a piecewise-linear range (clamped at the ends).
 *
 * Deliberately uses the FUNCTION form of useTransform. With the array form,
 * framer-motion 12 may hand opacity to a native ScrollTimeline that tracks
 * the page rather than this section's progress — inside pinned scenes that
 * froze captions at their first state, and partial ranges threw
 * "Offsets must be null or in the range [0,1]". The function form is always
 * evaluated in JS from the exact progress value it is given.
 */
export function useRange<T extends string | number>(
  progress: MotionValue<number>,
  input: number[],
  output: T[],
): MotionValue<T> {
  const i = input.map((v) => Math.min(1, Math.max(0, v)));
  for (let n = 1; n < i.length; n++) if (i[n] < i[n - 1]) i[n] = i[n - 1];
  const o = [...output];
  if (i[0] > 0) {
    i.unshift(0);
    o.unshift(o[0]);
  }
  if (i[i.length - 1] < 1) {
    i.push(1);
    o.push(o[o.length - 1]);
  }
  const mapper = useMemo(() => transform(i, o, { clamp: true }) as (v: number) => T, [i.join(","), o.join(",")]);
  return useTransform(progress, (v: number) => mapper(v));
}

/**
 * Scroll progress (0 → 1) of an element.
 *   "through": from the moment its top enters the bottom of the viewport until
 *              its bottom leaves the top — for layers drifting past.
 *   "pinned":  from its top hitting the top of the viewport until its bottom
 *              hits the bottom — for tall sections with a sticky child.
 *   "enter":   from its top entering the viewport until its top reaches the
 *              top — for reveal-on-arrival effects.
 */
export function useSectionProgress(
  ref: RefObject<HTMLElement | null>,
  mode: "through" | "pinned" | "enter" = "through",
): MotionValue<number> {
  const offset =
    mode === "pinned"
      ? (["start start", "end end"] as const)
      : mode === "enter"
        ? (["start end", "start start"] as const)
        : (["start end", "end start"] as const);
  const { scrollYProgress } = useScroll({ target: ref, offset: offset as never });
  return scrollYProgress;
}

/** Progress of the whole page (0 at top, 1 at bottom). */
export function usePageProgress(): MotionValue<number> {
  return useScroll().scrollYProgress;
}

/** Spring-smoothed copy of a progress value, for elements that should glide rather than track 1:1. */
export function useSmooth(value: MotionValue<number>, stiffness = 120, damping = 24): MotionValue<number> {
  return useSpring(value, { stiffness, damping, mass: 0.4 });
}

/**
 * Moves its children vertically as the wrapper scrolls through the viewport.
 * speed > 0 drifts with the scroll (feels far away), speed < 0 against it (feels near).
 * The wrapper is decorative (aria-hidden); do not put content in it.
 */
export function ParallaxLayer({
  speed = 0.3,
  className,
  style,
  children,
}: {
  speed?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const safe = useMotionSafe();
  const progress = useSectionProgress(ref, "through");
  const range = safe ? speed * 160 : 0;
  const y = useRange(progress, [0, 1], [-range, range]);
  return (
    <div ref={ref} className={className} style={style} aria-hidden>
      <motion.div style={{ y }} className={range !== 0 ? "h-full w-full will-change-transform" : "h-full w-full"}>
        {children}
      </motion.div>
    </div>
  );
}

/**
 * Like ParallaxLayer but for real content (not aria-hidden): the block drifts a
 * few px relative to the page as it passes, giving cards/columns different depths.
 */
export function Drift({
  amount = 40,
  className,
  children,
}: {
  /** px travelled over the pass; positive runs ahead of the scroll (reads near), negative lags behind (reads far) */
  amount?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const safe = useMotionSafe();
  const progress = useSectionProgress(ref, "through");
  const a = safe ? amount : 0;
  const y = useRange(progress, [0, 1], [a, -a]);
  return (
    <div ref={ref} className={className}>
      <motion.div style={{ y }} className={a !== 0 ? "h-full will-change-transform" : "h-full"}>
        {children}
      </motion.div>
    </div>
  );
}

/**
 * A tall section whose content stays pinned to the viewport while the user
 * scrolls through it. `children` receives the 0 → 1 progress of the pin.
 * With reduced motion the `fallback` is rendered instead (no pin, no movement).
 *
 * Do NOT wrap this in an element with overflow hidden/auto/scroll — that breaks
 * position: sticky. Use `overflow-x-clip` on ancestors if clipping is needed.
 *
 * The section carries `data-pinned`, so scrollToSection() lands it flush with
 * the viewport top (the scene draws its own room for the nav pill).
 *
 * `outside` renders inside the section but after the sticky stage, e.g. a
 * CloudSeam hanging below the section's bottom edge (absolute, top: 100%).
 */
export function PinnedScene({
  id,
  heightVh = 300,
  className,
  stickyClassName,
  labelledBy,
  fallback,
  outside,
  children,
}: {
  id?: string;
  /** total scroll length of the scene in viewport heights (>= 150; the hero uses 130–170) */
  heightVh?: number;
  className?: string;
  stickyClassName?: string;
  /** id of the scene's heading → aria-labelledby on the section */
  labelledBy?: string;
  fallback: ReactNode;
  /** extra nodes in the section, outside the sticky stage (art hanging past the section's edges) */
  outside?: ReactNode;
  children: (progress: MotionValue<number>) => ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const safe = useMotionSafe();
  const progress = useSectionProgress(ref, "pinned");
  if (!safe) return <>{fallback}</>;
  return (
    <section
      ref={ref}
      id={id}
      data-pinned=""
      aria-labelledby={labelledBy}
      className={`relative ${className ?? ""}`}
      style={{ height: `${heightVh}vh` }}
    >
      <div className={`sticky top-0 h-screen supports-[height:100svh]:h-[100svh] overflow-hidden ${stickyClassName ?? ""}`}>
        {children(progress)}
      </div>
      {outside}
    </section>
  );
}

/**
 * Pointer parallax: eases CSS variables --px / --py (each in [-1, 1]) on the
 * element towards the pointer position. Combine with the .sky-depth-far /
 * -mid / -fox / -near classes from sky.css, or read the variables in your own
 * transforms. No-op for touch devices and reduced motion. While the element is
 * off-screen (IntersectionObserver) pointer moves are ignored and no frame
 * loop runs.
 */
export function usePointerParallax(ref: RefObject<HTMLElement | null>): void {
  const safe = useMotionSafe();
  useEffect(() => {
    const el = ref.current;
    if (!el || !safe) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let raf = 0;
    const stop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    // on screen? Without IntersectionObserver, assume so.
    let visible = typeof IntersectionObserver === "undefined";
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver((entries) => {
            visible = entries[entries.length - 1].isIntersecting;
            if (!visible) stop();
          });
    io?.observe(el);
    const onMove = (e: PointerEvent) => {
      if (!visible) return;
      const r = el.getBoundingClientRect();
      tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const tick = () => {
      x += (tx - x) * 0.08;
      y += (ty - y) * 0.08;
      el.style.setProperty("--px", x.toFixed(4));
      el.style.setProperty("--py", y.toFixed(4));
      raf = visible && (Math.abs(tx - x) > 0.001 || Math.abs(ty - y) > 0.001) ? requestAnimationFrame(tick) : 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      io?.disconnect();
      stop();
    };
  }, [ref, safe]);
}

/**
 * How fast the page is being scrolled, as a spring-smoothed value in [-1, 1]
 * (negative while scrolling up). For lean/skew effects that should relax back
 * to rest when the scroll stops. Always 0 with reduced motion.
 */
export function useScrollLean(): MotionValue<number> {
  const safe = useMotionSafe();
  const { scrollY } = useScroll();
  const velocity = useVelocity(scrollY);
  const lean = useTransform(velocity, (v: number) => (safe ? Math.max(-1, Math.min(1, v / 2400)) : 0));
  return useSpring(lean, { stiffness: 140, damping: 26, mass: 0.5 });
}

/**
 * A card that leans a few degrees towards the pointer, with a soft light that
 * follows it — interactive depth for content cards. Sets --tilt-x / --tilt-y
 * (each in [-1, 1]) and --tilt-on (0 | 1) on the wrapper; the pane reads them.
 * Fine pointers only; no-op for touch and reduced motion.
 *
 * Do not use it around brand marks (logos must never be rotated or skewed).
 */
export function Tilt({
  max = 5,
  className,
  radiusClassName = "rounded-2xl",
  children,
}: {
  /** largest lean in degrees */
  max?: number;
  className?: string;
  /** corner radius of the light overlay; match the card inside */
  radiusClassName?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const safe = useMotionSafe();
  useEffect(() => {
    const el = ref.current;
    if (!el || !safe) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let raf = 0;
    const tick = () => {
      x += (tx - x) * 0.14;
      y += (ty - y) * 0.14;
      el.style.setProperty("--tilt-x", x.toFixed(4));
      el.style.setProperty("--tilt-y", y.toFixed(4));
      raf = Math.abs(tx - x) > 0.002 || Math.abs(ty - y) > 0.002 ? requestAnimationFrame(tick) : 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      el.style.setProperty("--tilt-on", "1");
      kick();
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      el.style.setProperty("--tilt-on", "0");
      kick();
    };
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [safe]);

  return (
    <div ref={ref} className={className} style={{ perspective: 1000 }}>
      <div
        className="relative h-full"
        style={{
          transform: `rotateX(calc(var(--tilt-y, 0) * ${-max}deg)) rotateY(calc(var(--tilt-x, 0) * ${max}deg))`,
        }}
      >
        {children}
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${radiusClassName}`}
          style={{
            opacity: "var(--tilt-on, 0)",
            background:
              "radial-gradient(260px circle at calc(50% + var(--tilt-x, 0) * 50%) calc(50% + var(--tilt-y, 0) * 50%), color-mix(in oklab, var(--primary) 16%, transparent), transparent 70%)",
          }}
        />
      </div>
    </div>
  );
}
