/**
 * Surfaces for the calm bands after the fog (Guarantees #design, Network
 * #network): night glass panes, violet glyph tiles and the band type. They
 * sit on illustrated scenes, so every colour is a fixed night colour (the
 * stages carry `.dark` in both themes).
 *
 * The glass is faked: a translucent violet-navy gradient with a hairline
 * border, a lit top edge and a soft corner sheen. No backdrop-filter: the art
 * behind it moves, and a backdrop blur would repaint on every frame. It is
 * ~88% opaque where text sits, so body text keeps ≥ 4.5:1 even with the full
 * moon right behind a pane.
 */
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

// ─── Type ─────────────────────────────────────────────────────────────────────

export const BAND_TYPE = {
  /** band h2: Space Grotesk 600, 40 / 52 / 64 / 72px, ink with a soft shadow (leading after the size: tailwind-merge) */
  title:
    "font-display text-balance text-[2.5rem] leading-[1.04] font-semibold tracking-[-0.035em] text-[color:var(--ink)] [text-shadow:0_2px_28px_rgb(4_5_26/0.6)] sm:text-[3.25rem] sm:leading-[1.03] lg:text-[4rem] 2xl:text-[4.5rem]",
  /** the Network band line, one line from sm: 44px on phones, then 5.4vw up to 96px */
  display:
    "font-display text-balance text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.04em] text-[color:var(--ink)] [text-shadow:0_2px_36px_rgb(4_5_26/0.7)] sm:text-[length:max(3rem,min(5.4vw,6rem))] sm:leading-[1]",
  /** card titles: Inter 600, 17 / 18px, ink */
  cardTitle: "text-[17px] leading-snug font-semibold tracking-[-0.01em] text-[color:var(--ink)] sm:text-lg sm:leading-snug",
  /** the one line under a card title: 14 / 15px mist */
  cardLine: "text-pretty text-sm leading-relaxed text-[color:rgb(201_204_255/0.86)] sm:text-[15px] sm:leading-relaxed",
  /** mono labels on glass: 12px capitals, lavender */
  label: "font-mono text-xs uppercase tracking-[0.14em] text-[color:rgb(174_180_255/0.9)]",
  /** values on glass (mono) */
  value: "font-mono text-[13px] font-medium text-[color:var(--ink)]",
} as const;

// ─── Glass ────────────────────────────────────────────────────────────────────

/** The pane itself (border, gradient, depth). Children of GlassPane sit above the sheen. */
export const GLASS =
  "relative isolate overflow-hidden rounded-2xl border border-[rgb(174_180_255/0.15)] bg-[linear-gradient(165deg,rgb(42_48_120/0.84)_0%,rgb(23_28_80/0.89)_40%,rgb(12_14_46/0.93)_100%)] shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_34px_70px_-36px_rgb(2_3_16/0.95)]";

/** Hover for glass that is (or wraps) a link: the border lights up. Never on a <button> with primary colours. */
export const GLASS_HOVER = "transition-[border-color,box-shadow] duration-300 hover:border-[rgb(201_204_255/0.34)]";

/**
 * A night-glass pane: hairline border, a lit top edge and a faint violet sheen
 * in one corner. `glow` warms the sheen (the CTA plate).
 */
export function GlassPane({
  className,
  children,
  glow = "violet",
  ...rest
}: ComponentProps<"div"> & { glow?: "violet" | "gold" | "none" }) {
  return (
    <div {...rest} className={cn(GLASS, className)}>
      <GlassLight glow={glow} />
      {children}
    </div>
  );
}

/** The pane's static lighting, for panes that are another element (a link, a list item). */
export function GlassLight({ glow = "violet" }: { glow?: "violet" | "gold" | "none" }) {
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 -z-10 h-px bg-[linear-gradient(90deg,transparent,rgb(226_227_255/0.55),transparent)]"
      />
      {glow !== "none" && (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute -left-16 -top-20 -z-10 h-48 w-64 rounded-full",
            glow === "gold"
              ? "bg-[radial-gradient(closest-side,rgb(245_213_138/0.16),transparent)]"
              : "bg-[radial-gradient(closest-side,rgb(139_108_246/0.2),transparent)]",
          )}
        />
      )}
    </>
  );
}

// ─── Glyph tile ───────────────────────────────────────────────────────────────

/**
 * A 44px tile cut from the logo's pillars: violet gradient (--violet-hi →
 * --violet-lo), a lit top edge and a violet glow. Icons inside: h-[18px] w-[18px].
 */
export function GlyphTile({ children, className, size = "md" }: { children: ReactNode; className?: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center text-white",
        "bg-[linear-gradient(155deg,var(--violet-hi)_0%,var(--violet)_52%,var(--violet-lo)_100%)]",
        "shadow-[inset_0_1px_0_rgb(255_255_255/0.32),inset_0_-8px_14px_-8px_rgb(28_20_102/0.7),0_12px_28px_-12px_rgb(106_75_224/0.95)]",
        size === "md" ? "h-11 w-11 rounded-xl" : "h-9 w-9 rounded-[10px]",
        className,
      )}
    >
      {children}
    </span>
  );
}
