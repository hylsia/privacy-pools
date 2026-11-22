"use client";

/**
 * The landing page's one reveal preset (only landing sections import it).
 *
 *   - opacity 0 → 1 and y 16px → 0 over 0.6s, ease [0.22, 1, 0.36, 1], once
 *   - with `inView`, it starts when the block is 10% clear of the viewport bottom
 *   - reduced motion: opacity only, 0.2s
 *   - no filter, and nothing is left on the element afterwards (transform ends
 *     as "none", opacity as 1), so it never becomes a containing block or a
 *     stacking context once revealed
 *
 * Stagger with `delay`: index × 0.06, at most 0.18 (card grids: (idx % 3) × 0.06).
 * Never put a Robinhood Chain logo inside it, never use it on hero copy (which
 * paints immediately), and never combine it with a scroll-scrubbed transform on
 * the same element.
 *
 * The name is historical: the preset no longer blurs.
 */
import { useRef, type ReactNode } from "react";
import { motion, useInView, useReducedMotion, type UseInViewOptions, type Variants } from "framer-motion";

interface BlurFadeProps {
  children: ReactNode;
  className?: string;
  /** custom variants; replace the preset (and its reduced-motion handling) */
  variant?: {
    hidden: Record<string, number | string>;
    visible: Record<string, number | string>;
  };
  /** seconds (default 0.6; 0.2 with reduced motion) */
  duration?: number;
  /** seconds */
  delay?: number;
  /** px the block rises by (default 16) */
  yOffset?: number;
  /** reveal when scrolled into view instead of on mount */
  inView?: boolean;
  /** IntersectionObserver rootMargin (default "0px 0px -10% 0px") */
  inViewMargin?: string;
  /** @deprecated no-op: the preset never blurs */
  blur?: string;
}

const EASE = [0.22, 1, 0.36, 1] as const;

const REDUCED: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

export default function BlurFade({
  children,
  className,
  variant,
  duration = 0.6,
  delay = 0,
  yOffset = 16,
  inView = false,
  inViewMargin = "0px 0px -10% 0px",
}: BlurFadeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref, { once: true, margin: inViewMargin as UseInViewOptions["margin"] });
  const reduce = useReducedMotion() ?? false;
  const show = !inView || seen;
  const variants: Variants =
    variant ??
    (reduce
      ? REDUCED
      : {
          hidden: { opacity: 0, y: yOffset },
          visible: { opacity: 1, y: 0 },
        });

  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={show ? "visible" : "hidden"}
      transition={{ delay, duration: reduce ? 0.2 : duration, ease: EASE }}
      variants={variants}
      className={className}
    >
      {children}
    </motion.div>
  );
}
