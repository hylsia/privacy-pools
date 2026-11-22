/**
 * The landing page's layout, type and surface system.
 *
 * Every section builds from these constants so the page reads as one system:
 * one 1280px container whose edges the nav pill and the footer share, one type
 * scale (Space Grotesk 600 for h1/h2, Inter for everything people read, 12px
 * floor), one section header, four surface recipes and one padding scale.
 *
 * Every class string is written out in full in this file because Tailwind
 * scans source text: never build a class name from pieces.
 *
 * Global overrides in index.css to keep in mind:
 *   - button[class*="bg-primary"] gets black text and a hover lift, and buttons
 *     whose class contains hover:bg-primary / hover:border-primary get black
 *     text on hover: CTAs are <a>/<Link> rendered through <Button asChild>.
 *   - .hover:bg-primary/10, /15 and /20 force primary text on hover (any element).
 *   - plain .bg-card gets a forced 20px backdrop blur: use bg-card/60 … bg-card/95.
 */
import { useEffect, type ComponentProps, type ReactNode } from "react";
import BlurFade from "@/components/ui/blur-fade";
import { cn } from "@/lib/utils";

// ─── Layout ───────────────────────────────────────────────────────────────────

/** Side gutters of every section: 24px below 640px, 40px from 640px (x=80 at 1440 with Container). */
export const SECTION_X = "px-6 sm:px-10";
/** Vertical padding of a pass-through section: 64 / 80 / 96px. */
export const SECTION_Y = "py-16 sm:py-20 lg:py-24";
/** Space between a section header and the content under it. */
export const HEADER_GAP = "mt-12 md:mt-16";
/** Space between successive blocks inside one section. */
export const BLOCK_GAP = "mt-10 md:mt-12";

/** The 1280px content column every section, the nav pill and the footer line up with. */
export function Container({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div {...rest} className={cn("relative mx-auto w-full max-w-7xl", className)}>
      {children}
    </div>
  );
}

// ─── Type ─────────────────────────────────────────────────────────────────────

/**
 * The type scale. h1/h2 tokens are Space Grotesk 600; everything else is Inter.
 * Nothing that is not aria-hidden goes below 12px (text-xs); aria-hidden
 * diagrams may go down to 10px, never lower.
 */
export const TYPE = {
  /** hero only: 40 / 52 / 56 / 64 / 72px (the largest heading at every breakpoint) */
  h1: "font-display text-balance text-[2.5rem] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[3.25rem] lg:text-[3.5rem] xl:text-[4rem] 2xl:text-[4.5rem]",
  /** section titles: 32 / 40 / 48px */
  h2: "font-display text-balance text-[2rem] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[2.5rem] lg:text-[3rem]",
  /** titles inside a pinned scene (ProofScene): 28 / 32 / 40px */
  h2Pinned:
    "font-display text-balance text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[2rem] xl:text-[2.5rem]",
  /** the closing card (Cta): 36 / 44 / 52px, a step under h1 at every breakpoint */
  h2Closing:
    "font-display text-balance text-[2.25rem] font-semibold leading-[1.06] tracking-[-0.035em] sm:text-[2.75rem] lg:text-[3.25rem]",
  /** card and list titles (Inter 600, 18px) */
  h3: "text-lg font-semibold leading-snug tracking-[-0.01em] text-foreground",
  /** section leads: 16 / 18px, keep within max-w-[38rem] */
  lead: "text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg",
  /** card body text: 14 / 15px */
  body: "text-sm leading-relaxed text-muted-foreground sm:text-[15px]",
  /** one per section, no icons: 12px mono capitals in primary */
  eyebrow: "inline-flex items-center gap-2 font-mono text-xs font-medium uppercase tracking-[0.16em] text-primary",
  /** data labels (values use font-mono text-[13px]) */
  label: "font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground",
  /** scope lines, footnotes, notes: 12px Inter, sentence case */
  caption: "text-xs leading-relaxed text-muted-foreground",
} as const;

// ─── Surfaces ─────────────────────────────────────────────────────────────────

/**
 * Four surface recipes plus the figure panel. Radii: rounded-2xl (24px) outer,
 * rounded-lg (16px) nested, rounded-md (12px) tiles, rounded-full for buttons,
 * pills and tags. Never rounded-3xl, never plain bg-card.
 */
export const SURFACE = {
  /** the default card; pair with CARD_PAD */
  card: "rounded-2xl border border-border/60 bg-card/60",
  /** the page's only elevation (Guarantees, Network facts, Cta card); not on a <button> */
  raised:
    "rounded-2xl border border-border/60 bg-card/60 shadow-[0_24px_60px_-32px_color-mix(in_oklab,var(--primary)_45%,transparent)] transition-colors duration-300 hover:border-primary/40",
  /** at most one per section, e.g. "Hidden by the proof" */
  accent: "rounded-2xl border border-primary/30 bg-primary/[0.06]",
  /** anything nested inside a card or figure (includes its p-4) */
  inset: "rounded-lg border border-border/50 bg-background/60 p-4",
  /** diagram panels and stages */
  figure: "rounded-2xl border border-border/50 bg-card/30",
} as const;

/** Padding of a card: 24 / 28px. */
export const CARD_PAD = "p-6 sm:p-7";

/** 40px icon tile in primary. Icons inside: h-4 w-4 or h-5 w-5. */
export const ICON_TILE =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/20";
/** The same tile, muted (public / neutral facts). */
export const ICON_TILE_MUTED =
  "flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground ring-1 ring-border/60";

/** Status colours that stay legible in both themes. */
export const TONE = {
  /** positive text ("open", "root published", "backup verified") */
  ok: "text-emerald-700 dark:text-emerald-400",
  /** positive chip / badge */
  okChip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  /** warning text */
  warn: "text-red-700 dark:text-destructive",
  /** warning chip (border + tint + text) */
  warnChip:
    "border border-red-700/30 bg-red-700/5 text-red-700 dark:border-destructive/30 dark:bg-destructive/5 dark:text-destructive",
} as const;

// ─── Actions ──────────────────────────────────────────────────────────────────

/** Solid 2px primary focus ring with offset (the shadcn ring is 1.3:1 and too faint). */
export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Primary CTA, 48px. Use with <Button asChild size="lg" className={CTA_PRIMARY}>
 * around a <Link>/<a> (never a <button>). has-[>svg]:px-7 cancels the Button's
 * has-[>svg]:px-4, which would otherwise shrink the padding when an icon follows the label.
 * Trailing arrow: <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />.
 */
export const CTA_PRIMARY =
  "group h-12 rounded-full px-7 text-sm font-semibold has-[>svg]:px-7 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/**
 * Secondary CTA, 48px. Use with <Button asChild variant="outline" size="lg" className={CTA_SECONDARY}>.
 * Replaces the outline variant's hover (primary background with dark text, 2.4:1 in light).
 */
export const CTA_SECONDARY =
  "group h-12 rounded-full px-7 text-sm font-semibold has-[>svg]:px-7 hover:bg-secondary hover:text-secondary-foreground dark:hover:bg-input/50 dark:hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Compact 40px CTA for the nav pill and the menu. Use with <Button asChild className={CTA_PILL}>. */
export const CTA_PILL =
  "h-10 shrink-0 rounded-full px-4 text-[13px] font-semibold sm:px-5 has-[>svg]:px-4 sm:has-[>svg]:px-5 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// ─── Scenes (v2) ──────────────────────────────────────────────────────────────

/**
 * Type over the illustrated scenes (spec §4). Scenes are night art in both
 * themes, so these are fixed light colours, not theme tokens. Pair a block of
 * scene text with a <Scrim> from the scene kit when it sits over busy art.
 */
export const SCENE_TYPE = {
  /** hero h1 and scene h2s: Space Grotesk 600, 44 / 56 / 72 / 88px (lg and 2xl capped by viewport height), ink */
  headline:
    "font-display text-balance text-[2.75rem] font-semibold leading-[1.03] tracking-[-0.035em] text-[color:var(--ink)] [text-shadow:0_2px_32px_rgb(4_5_26/0.55)] sm:text-[3.5rem] lg:text-[length:min(4.5rem,8vh)] 2xl:text-[length:min(5.5rem,8.6vh)]",
  /** 12px mono capitals, lavender */
  eyebrow: "font-mono text-xs font-medium uppercase tracking-[0.2em] text-[color:var(--lavender)]",
  /** supporting line: Inter 16 / 18 / 20px in mist at ~86%; keep to 2–3 lines (~30 words) */
  lead: "text-pretty text-base leading-relaxed text-[color:rgb(201_204_255/0.86)] sm:text-lg xl:text-xl",
  /** small print over a scene (≥12px) */
  caption: "text-xs leading-relaxed text-[color:rgb(201_204_255/0.74)]",
} as const;

/**
 * Primary CTA over a scene (48px, lavender with a soft glow). Scenes carry the
 * `dark` class, so bg-primary is lavender in both themes. Use with
 * <Button asChild size="lg" className={SCENE_CTA_PRIMARY}> around a <Link>/<a>.
 */
export const SCENE_CTA_PRIMARY =
  "group h-12 rounded-full px-7 text-sm font-semibold has-[>svg]:px-7 shadow-[0_14px_44px_-14px_rgb(174_180_255/0.75)] hover:bg-[#c9ccff] outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Secondary CTA over a scene: night glass with a hairline border. Use with <Button asChild variant="outline" size="lg">. */
export const SCENE_CTA_SECONDARY =
  "group h-12 rounded-full px-7 text-sm font-semibold has-[>svg]:px-7 border-white/20 bg-[#0a0c2a]/45 text-[color:var(--ink)] shadow-none hover:border-white/35 hover:bg-white/10 hover:text-[color:var(--ink)] dark:border-white/20 dark:bg-[#0a0c2a]/45 dark:hover:bg-white/10 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// ─── Section header ───────────────────────────────────────────────────────────

export interface SectionHeaderProps {
  /** mono eyebrow; one per section, no icons */
  eyebrow: ReactNode;
  /** the h2 */
  title: ReactNode;
  /** optional lead paragraph (inline content only: it renders inside a <p>) */
  lead?: ReactNode;
  /** fixed at every breakpoint; default "start" */
  align?: "start" | "center";
  /** id of the h2, for the section's aria-labelledby */
  titleId?: string;
  /** replaces TYPE.h2 on the h2 (e.g. TYPE.h2Pinned, TYPE.h2Closing); merged after "mt-4" */
  titleClassName?: string;
  /** merged (cn) onto the lead's classes, e.g. "mt-4 hidden sm:block" */
  leadClassName?: string;
  /**
   * static content beside the header from lg (stacked below it on smaller
   * screens), e.g. the Robinhood Chain logo plate. It sits outside the reveal,
   * so it never fades or moves.
   */
  aside?: ReactNode;
  /** wrap the header in the reveal preset (default true) */
  reveal?: boolean;
  /** classes for the outermost element */
  className?: string;
}

/** Eyebrow → h2 (mt-4) → lead (mt-5, max 38rem). */
export function SectionHeader({
  eyebrow,
  title,
  lead,
  align = "start",
  titleId,
  titleClassName,
  leadClassName,
  aside,
  reveal = true,
  className,
}: SectionHeaderProps) {
  const center = align === "center";
  const body = (
    <>
      <p className={cn(TYPE.eyebrow, "flex", center && "justify-center")}>{eyebrow}</p>
      <h2 id={titleId} className={cn("mt-4", titleClassName ?? TYPE.h2)}>
        {title}
      </h2>
      {lead != null && lead !== false && (
        <p className={cn("mt-5 max-w-[38rem]", TYPE.lead, center && "mx-auto", leadClassName)}>{lead}</p>
      )}
    </>
  );
  const frame = center ? "mx-auto max-w-3xl text-center" : "max-w-3xl";

  // the outermost element carries `className`
  const header = reveal ? (
    <BlurFade inView className={aside ? undefined : className}>
      <div className={frame}>{body}</div>
    </BlurFade>
  ) : (
    <div className={cn(frame, !aside && className)}>{body}</div>
  );

  if (!aside) return header;
  return (
    <div className={cn("flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between lg:gap-16", className)}>
      <div className="min-w-0">{header}</div>
      <div className="shrink-0">{aside}</div>
    </div>
  );
}

// ─── Figure tag ───────────────────────────────────────────────────────────────

/** The one tag style for every illustrative figure: "Example", "Illustration", "Diagram, simplified". 12px. */
export function FigureTag({ children = "Example", className }: { children?: ReactNode; className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full border border-border bg-background/80 px-2 py-0.5 text-xs font-medium leading-4 text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ─── Scope ────────────────────────────────────────────────────────────────────

/** Full honesty line (the landing footer's bottom bar, the dashboard footer). */
export const SCOPE_LINE =
  "Testnet only. Not audited. Development trusted setup. Do not use real funds.";

// ─── In-page navigation ───────────────────────────────────────────────────────

/** Height the fixed nav pill needs above a section heading (px). */
export const NAV_OFFSET = 80;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Scrolls to the element with this id and writes "#id" into the address bar
 * (replaceState, no history entry; "top" clears the hash). Pinned scenes
 * (data-pinned) and "top" land flush with the viewport top, everything else
 * 80px lower so the heading clears the nav pill. The jump is instant with
 * `instant`, with reduced motion, or when the target is more than two viewport
 * heights away (a long smooth scroll would play the pinned choreography in fast
 * forward); otherwise smooth. Returns false when no such element exists.
 */
export function scrollToSection(id: string, opts: { instant?: boolean } = {}): boolean {
  if (typeof document === "undefined") return false;
  const el = document.getElementById(id);
  if (!el) return false;
  const offset = id === "top" || el.hasAttribute("data-pinned") ? 0 : NAV_OFFSET;
  const top = Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - offset));
  const far = Math.abs(top - window.scrollY) > 2 * window.innerHeight;
  const behavior: ScrollBehavior = opts.instant || far || prefersReducedMotion() ? "instant" : "smooth";
  window.scrollTo({ top, behavior });
  const { pathname, search } = window.location;
  window.history.replaceState(window.history.state, "", id === "top" ? pathname + search : `#${id}`);
  return true;
}

/** Moves keyboard focus to a section without scrolling (gives it tabIndex -1 when it has none). */
function focusSection(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

export type SectionLinkProps = Omit<ComponentProps<"a">, "href"> & {
  /** target section id, without "#" ("top", "pool", "faq", …) */
  to: string;
  /** runs after a handled click, e.g. to close a menu */
  onNavigate?: () => void;
};

/**
 * In-page link to a section: <a href="#to"> that scrolls with scrollToSection()
 * and moves focus to the section, so keyboard and screen-reader users continue
 * from there. Modified clicks (new tab, …) keep the browser's behaviour.
 * Your own onClick runs first; call preventDefault() in it to cancel.
 */
export function SectionLink({ to, onNavigate, onClick, children, ...rest }: SectionLinkProps) {
  return (
    <a
      {...rest}
      href={`#${to}`}
      onClick={e => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (scrollToSection(to)) {
          e.preventDefault();
          focusSection(to);
        }
        onNavigate?.();
      }}
    >
      {children}
    </a>
  );
}

/**
 * Lands a deep link (/#network) once the page has rendered: reads the hash on
 * mount, waits two frames, then retries every frame (up to 30) until the target
 * exists and jumps there instantly. When web fonts finish loading it lands once
 * more, unless the reader has scrolled in the meantime. Call it once, in Landing.
 */
export function useHashLanding(): void {
  useEffect(() => {
    let id = "";
    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }
    if (!id) return;

    let frame = 0;
    let tries = 0;
    let cancelled = false;
    const land = () => {
      if (cancelled) return;
      if (!document.getElementById(id)) {
        if (++tries < 30) frame = requestAnimationFrame(land);
        return;
      }
      scrollToSection(id, { instant: true });
      const landedAt = window.scrollY;
      void document.fonts?.ready.then(() => {
        if (!cancelled && Math.abs(window.scrollY - landedAt) < 2) scrollToSection(id, { instant: true });
      });
    };
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(land);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, []);
}
