/**
 * "Your note" in the dashboard: the landing's gold diamond (scene/Monoliths.tsx),
 * drawn statically (no glow, no float). On the landing gold means "value / your
 * note" only, and the dashboard keeps that meaning: the diamond marks note IDs,
 * your private balance and spendable notes, and the My notes page.
 *
 * Its colours are the scene tokens --gold-logo / --gold-lo / --gold-hi, declared
 * on :root by scene/scene.css (loaded with the landing, which App imports).
 */
import type { IconProps } from "@/components/icons";
import { Diamond } from "@/components/landing/scene/Monoliths";
import { cn } from "@/lib/utils";

/** The diamond at a fixed width in px (height is 1.2×); decorative. */
export function NoteDiamond({ size = 9, className }: { size?: number; className?: string }) {
  return <Diamond size={size} glow={false} className={cn("shrink-0", className)} />;
}

/**
 * The same diamond as an icon (an IconType): it fills the height of the box its
 * className gives it (h-4 w-4 …), like the Font Awesome icons it sits among.
 */
export function NoteDiamondIcon({ className, style, title }: IconProps) {
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={style}
    >
      <Diamond glow={false} style={{ height: "92%", width: "auto", aspectRatio: "5 / 6" }} />
    </span>
  );
}
