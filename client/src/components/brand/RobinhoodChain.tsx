/**
 * Robinhood Chain marks, served unmodified from /brand/robinhood-chain
 * (official asset pack v1, https://docs.robinhood.com/chain/brand-guidelines/).
 *
 * The components encode the usage rules so call sites cannot break them:
 *   - only the Robinhood Chain logo is used, never the Robinhood master logo
 *   - approved pairings only: white on black, black on white, black on Robin Neon
 *   - clear space on every side equal to the width of the wordmark's "R"
 *     (0.466 × the logo height) — the plate's padding, ceil(height / 2), covers it
 *   - never below 20px tall, never recoloured, cropped, rotated or given effects
 *
 * Do not wrap these in transforms that rotate, skew or tilt them, never fade or
 * animate them, and keep them out of containers that do (animated menus, sheets,
 * dialogs, disabled controls). Do not put other text or imagery inside the plate.
 *
 * Hylsia is built for one network, Robinhood Chain Testnet:
 *   - the plate stands alone: never put another mark or name inside it, and
 *     never form a lockup (no +, ×, & or shared badge with another mark or name);
 *   - keep at least one R width (0.466 × the logo height) between the plate and
 *     any other mark;
 *   - write "Robinhood Chain Testnet" in full in copy ("Robinhood" alone never
 *     names the network);
 *   - say "built for", never "deployed on": the logo names the network, it does
 *     not imply endorsement.
 * NetworkMark and NetworkAttribution (same folder) follow these rules.
 *
 * In development, RobinhoodChainLogo checks its ancestors one frame after mount
 * and warns in the console ("[RobinhoodChainLogo] …") when one of them rotates,
 * scales or skews it, filters it or fades it (opacity below 1).
 */
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const LOGO_WHITE = "/brand/robinhood-chain/Robinhood_Chain_Logo_White.svg";
const LOGO_BLACK = "/brand/robinhood-chain/Robinhood_Chain_Logo_Black.svg";
const FEATHER = "/brand/robinhood-chain/Robinhood_Feather_Symbol.jpg";

/** Width ÷ height of the logo artwork (viewBox 1576 × 207). */
const LOGO_RATIO = 1576 / 207;
const MIN_HEIGHT = 20;

export const ROBINHOOD_CHAIN_DOCS_URL = "https://docs.robinhood.com/chain/";

type Tone = "auto" | "black" | "white" | "neon";

const PLATE: Record<Tone, string> = {
  auto: "bg-white dark:bg-black",
  black: "bg-black",
  white: "bg-white",
  neon: "bg-[#ccff00]",
};

// ─── Development guard ────────────────────────────────────────────────────────

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** true for "none" and for matrices that only translate (a=1, b=0, c=0, d=1 and no 3D rotation, scale or perspective). */
function isPureTranslate(transform: string): boolean {
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

/** The individual `rotate` / `scale` properties (Tailwind v4 rotate-* and scale-* utilities use them). */
function isIdentityRotate(rotate: string): boolean {
  if (!rotate || rotate === "none") return true;
  const angle = rotate.trim().split(/\s+/).pop() ?? "0";
  return near(parseFloat(angle) || 0, 0);
}
function isIdentityScale(scale: string): boolean {
  if (!scale || scale === "none") return true;
  return scale
    .trim()
    .split(/\s+/)
    .every((v) => near(parseFloat(v), v.endsWith("%") ? 100 : 1));
}

function describe(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const classes = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [];
  const shown = classes.slice(0, 6).map((c) => `.${c}`).join("");
  return `<${el.tagName.toLowerCase()}${id}${shown}${classes.length > 6 ? "…" : ""}>`;
}

/** Every ancestor that moves the mark out of shape, filters it or fades it, with the reason. */
function brandViolations(logo: HTMLElement): string[] {
  const found: string[] = [];
  for (let node = logo.parentElement; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    const why: string[] = [];
    if (!isPureTranslate(cs.transform)) why.push(`transform: ${cs.transform}`);
    // an inline rotate/scale/skew that happens to rest at identity right now (a tilt card, a scroll scale)
    else if (/rotate|scale|skew/i.test(node.style.transform)) why.push(`inline transform: ${node.style.transform}`);
    if (!isIdentityRotate(cs.rotate)) why.push(`rotate: ${cs.rotate}`);
    if (!isIdentityScale(cs.scale)) why.push(`scale: ${cs.scale}`);
    if (cs.filter && cs.filter !== "none") why.push(`filter: ${cs.filter}`);
    if (parseFloat(cs.opacity) < 1) why.push(`opacity: ${cs.opacity}`);
    if (why.length) found.push(`${describe(node)} → ${why.join("; ")}`);
  }
  return found;
}

/**
 * The full Robinhood Chain logo on an approved background plate.
 * `tone="auto"` follows the theme: white on black in dark mode, black on white in light mode.
 */
export function RobinhoodChainLogo({
  height = 24,
  tone = "auto",
  className,
}: {
  /** logo height in px (the plate adds the clear space around it); clamped to the 20px minimum */
  height?: number;
  tone?: Tone;
  className?: string;
}) {
  const h = Math.max(MIN_HEIGHT, height);
  const w = Math.round(h * LOGO_RATIO);
  const clear = Math.ceil(h / 2);
  const img = "block max-w-none select-none";
  const plateRef = useRef<HTMLSpanElement>(null);

  // development only: warn when an ancestor rotates, scales, skews, filters or fades the mark
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const frame = requestAnimationFrame(() => {
      const el = plateRef.current;
      if (!el || el.getClientRects().length === 0) return; // not rendered (e.g. the other breakpoint's plate)
      const found = brandViolations(el);
      if (found.length) {
        console.warn(
          `[RobinhoodChainLogo] brand marks must never be rotated, scaled, skewed, filtered or faded; offending ancestor(s):\n  ${found.join("\n  ")}`,
          el,
        );
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <span
      ref={plateRef}
      role="img"
      aria-label="Robinhood Chain"
      className={cn("inline-flex shrink-0 rounded-xl", PLATE[tone], className)}
      style={{ padding: clear }}
    >
      {(tone === "auto" || tone === "black") && (
        <img
          src={LOGO_WHITE}
          alt=""
          width={w}
          height={h}
          draggable={false}
          className={cn(img, tone === "auto" && "hidden dark:block")}
        />
      )}
      {tone !== "black" && (
        <img
          src={LOGO_BLACK}
          alt=""
          width={w}
          height={h}
          draggable={false}
          className={cn(img, tone === "auto" && "dark:hidden")}
        />
      )}
    </span>
  );
}

/**
 * The feather symbol, for compact symbol spaces only (the network chip in a
 * dense toolbar, at its 20px minimum). It never replaces the full logo where
 * there is room for it, and it is never dimmed, tinted or drawn over.
 */
export function RobinhoodFeather({
  size = 28,
  decorative = true,
  className,
}: {
  size?: number;
  /** true when the network name is written next to it (the usual case); false gives it the name as alt text */
  decorative?: boolean;
  className?: string;
}) {
  const s = Math.max(MIN_HEIGHT, size);
  return (
    <img
      src={FEATHER}
      alt={decorative ? "" : "Robinhood Chain"}
      width={s}
      height={s}
      draggable={false}
      className={cn("block shrink-0 select-none rounded-[22%]", className)}
    />
  );
}
