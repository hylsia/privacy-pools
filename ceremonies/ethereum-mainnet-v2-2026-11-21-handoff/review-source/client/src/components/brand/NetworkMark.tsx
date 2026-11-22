/**
 * A network's symbol for compact spaces (a chip, a menu row, a table cell). It is decorative: the network's name is
 * always written beside it (NetworkLabel does both).
 *
 * - Robinhood Chain Testnet: the official feather (RobinhoodFeather), unmodified, at 20px or more.
 * - The local development chains: a neutral monogram in the app's own colours, their letter ("A", "B"). Never
 *   another chain's logo: the ETH glyph already means the asset (PoolMark, the deposit form).
 *
 * Keep marks out of animated or disabled containers (sheets, dialogs, menus that zoom or fade, disabled buttons): the
 * feather must never be faded, filtered or transformed (RobinhoodChain.tsx). Menus use NetworkMenu, whose content
 * does not animate. In development the feather checks itself and its ancestors one frame after mount and warns in
 * the console ("[NetworkMark] …") when one of them rotates, scales, skews, filters or fades it.
 */
import { useEffect, useRef } from "react";
import { RobinhoodFeather } from "@/components/brand/RobinhoodChain";
import { cn } from "@/lib/utils";
import type { NetworkInfo } from "@shared/privacy/networks";

const MIN_SIZE = 20;

/** The monogram's letter: a local chain's letter, "A" for "Local A", "B" for "Local B". */
export function networkMonogram(network: Pick<NetworkInfo, "shortName">): string {
  const words = network.shortName.trim().split(/\s+/);
  return (words[words.length - 1]?.charAt(0) || "?").toUpperCase();
}

// ─── development guard (the feather only) ─────────────────────────────────────

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function isTranslateOnly(transform: string): boolean {
  if (!transform || transform === "none") return true;
  try {
    const m = new DOMMatrixReadOnly(transform);
    return (
      near(m.m11, 1) && near(m.m12, 0) && near(m.m13, 0) && near(m.m14, 0) &&
      near(m.m21, 0) && near(m.m22, 1) && near(m.m23, 0) && near(m.m24, 0) &&
      near(m.m31, 0) && near(m.m32, 0) && near(m.m33, 1) && near(m.m34, 0) &&
      near(m.m44, 1)
    );
  } catch {
    return true;
  }
}

/** The element and every ancestor that rotates, scales, skews, filters or fades what it holds, with the reason. */
function alteringAncestors(start: HTMLElement): string[] {
  const found: string[] = [];
  for (let node: HTMLElement | null = start; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    const why: string[] = [];
    if (!isTranslateOnly(cs.transform)) why.push(`transform: ${cs.transform}`);
    else if (/rotate|scale|skew/i.test(node.style.transform)) why.push(`inline transform: ${node.style.transform}`);
    if (cs.rotate && cs.rotate !== "none" && !near(parseFloat(cs.rotate.trim().split(/\s+/).pop() ?? "0") || 0, 0)) {
      why.push(`rotate: ${cs.rotate}`);
    }
    if (cs.scale && cs.scale !== "none" && !cs.scale.trim().split(/\s+/).every((v) => near(parseFloat(v), v.endsWith("%") ? 100 : 1))) {
      why.push(`scale: ${cs.scale}`);
    }
    if (cs.filter && cs.filter !== "none") why.push(`filter: ${cs.filter}`);
    if (parseFloat(cs.opacity) < 1) why.push(`opacity: ${cs.opacity}`);
    if (why.length) {
      const classes = typeof node.className === "string" ? node.className.trim().split(/\s+/).filter(Boolean).slice(0, 6) : [];
      found.push(`<${node.tagName.toLowerCase()}${classes.map((c) => `.${c}`).join("")}> → ${why.join("; ")}`);
    }
  }
  return found;
}

// ─── marks ────────────────────────────────────────────────────────────────────

export function NetworkMark({
  network,
  size = MIN_SIZE,
  className,
}: {
  network: Pick<NetworkInfo, "mark" | "kind" | "shortName">;
  /** px; never below 20 */
  size?: number;
  className?: string;
}) {
  const s = Math.max(MIN_SIZE, size);
  const feather = network.mark === "robinhood";
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!import.meta.env.DEV || !feather) return;
    const frame = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el || el.getClientRects().length === 0) return; // not rendered (e.g. the other breakpoint's copy)
      const found = alteringAncestors(el);
      if (found.length) {
        console.warn(
          `[NetworkMark] the Robinhood Chain feather must never be rotated, scaled, skewed, filtered or faded; offending element(s):\n  ${found.join("\n  ")}`,
          el,
        );
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [feather]);

  if (feather) {
    return (
      <span ref={ref} className={cn("inline-flex shrink-0", className)}>
        <RobinhoodFeather size={s} decorative />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-primary/20 font-mono font-bold leading-none text-primary",
        className,
      )}
      style={{ width: s, height: s, fontSize: Math.max(12, Math.round(s * 0.55)) }}
    >
      {networkMonogram(network)}
    </span>
  );
}

/** The mark with the network's name beside it: the name carries the meaning. `short` writes the short name ("Local A"). */
export function NetworkLabel({
  network,
  short = false,
  size = MIN_SIZE,
  className,
}: {
  network: Pick<NetworkInfo, "mark" | "kind" | "shortName" | "name">;
  short?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <NetworkMark network={network} size={size} />
      <span>{short ? network.shortName : network.name}</span>
    </span>
  );
}
