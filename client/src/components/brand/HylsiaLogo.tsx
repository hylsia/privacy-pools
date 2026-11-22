/**
 * The Hylsia logo mark, used everywhere the product identifies itself
 * (landing nav and footer, the Pools dashboard, app navigation, login, docs).
 *
 * Source artwork: client/public/logo.png (960×960, transparent). The UI uses
 * /brand/hylsia/mark-256.png, the same artwork trimmed to its edges and squared,
 * so the mark fills its box instead of floating in the original padding.
 * Favicons and the Apple touch icon in client/index.html come from the same file.
 *
 * The mark is decorative by default: every place it appears names "Hylsia"
 * next to it or on the surrounding link. Pass `title` when it stands alone.
 */
import { cn } from "@/lib/utils";

export const HYLSIA_LOGO_SRC = "/logo.png";
export const HYLSIA_MARK_SRC = "/brand/hylsia/mark-256.png";

export function HylsiaMark({ size = 32, title, className }: { size?: number; title?: string; className?: string }) {
  return (
    <img
      src={HYLSIA_MARK_SRC}
      width={size}
      height={size}
      alt={title ?? ""}
      draggable={false}
      className={cn("block shrink-0 select-none object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}
