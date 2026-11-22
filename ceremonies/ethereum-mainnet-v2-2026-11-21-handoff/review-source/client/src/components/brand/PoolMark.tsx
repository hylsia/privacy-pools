/**
 * The pool, as every dashboard row, strip and header draws it: the Hylsia mark
 * (two monoliths with the gold diamond between them, which the landing uses to
 * mean "the pool", scene/Monoliths.tsx) on a quiet tile, with the asset it holds
 * as a small badge (ETH). One component, so size, ring and badge never drift
 * between the Pools table, the quick view, the pool page and the vault strip.
 *
 * Decorative: the pool's name ("ETH Privacy Pool") is always written next to it.
 */
import { Ethereum } from "@/components/icons";
import { HylsiaMark } from "@/components/brand/HylsiaLogo";
import { cn } from "@/lib/utils";

const SIZES = {
  /** 36px: the quick view header */
  sm: { tile: "h-9 w-9 rounded-[10px]", mark: 24, badge: "h-4 w-4", glyph: "h-2.5 w-2.5" },
  /** 40px: table rows and workspace strips */
  md: { tile: "h-10 w-10 rounded-xl", mark: 26, badge: "h-4 w-4", glyph: "h-2.5 w-2.5" },
  /** 48px: the pool page header */
  lg: { tile: "h-12 w-12 rounded-xl", mark: 32, badge: "h-5 w-5", glyph: "h-3 w-3" },
} as const;

export type PoolMarkSize = keyof typeof SIZES;

export function PoolMark({ size = "md", className }: { size?: PoolMarkSize; className?: string }) {
  const s = SIZES[size];
  return (
    <span aria-hidden className={cn("relative inline-flex shrink-0", className)}>
      <span className={cn("inline-flex items-center justify-center bg-background ring-1 ring-border/70", s.tile)}>
        <HylsiaMark size={s.mark} />
      </span>
      {/* the asset the pool holds; bg-popover is the card colour without index.css's forced blur on plain .bg-card */}
      <span
        className={cn(
          "absolute -bottom-1 -right-1 inline-flex items-center justify-center rounded-full bg-popover text-foreground ring-2 ring-background",
          s.badge,
        )}
      >
        <Ethereum className={s.glyph} />
      </span>
    </span>
  );
}
