/**
 * Landing chrome: the floating nav pill and the footer.
 *
 * The landing is a night journey in both themes, so the chrome is night glass
 * in both themes too, and the landing nav has no theme toggle (the app pages
 * keep theirs).
 *
 * The nav is an instrument, not a parallax object. It never moves; it only
 *   - fades its glass plate in as the descent starts (opacity bound to page progress),
 *   - fills a 1px primary hairline along the pill's bottom edge with the page progress,
 *   - marks the chapter you are in (IntersectionObserver, discrete state only).
 * The pill is the 1280px content column plus its own 24px padding, so the logo
 * and the CTA sit on the page's content edges. From lg it shows five anchors;
 * below lg they live in a disclosure menu under the pill (no portal and no
 * dialog role, so it never meets the global [role=dialog] overrides and never
 * becomes an ancestor of a sticky scene).
 *
 * The footer is static and is where the journey lands: dark hills with a faint
 * line of light along their crest rise over the bottom of the dawn scene
 * (HorizonEdge), then four link columns, the Robinhood Chain plate on its
 * approved background, and the honest scope line.
 *
 * Every in-page link goes through SectionLink (system.tsx): pinned scenes land
 * flush, everything else lands clear of the pill, and focus moves to the section.
 */
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { motion, type MotionValue } from "framer-motion";
import { Link } from "wouter";
import { ArrowUp, ArrowUpRight, ChevronDown, Menu, X, XTwitter } from "@/components/icons";
import { HylsiaMark } from "@/components/brand/HylsiaLogo";
import { NETWORK_TRADEMARK_LINE } from "@/components/brand/NetworkAttribution";
import { RobinhoodChainLogo } from "@/components/brand/RobinhoodChain";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  EXPLORER_URL,
  FAUCET_URL,
  NOTES_PATH,
  POOL_PATH,
  POOLS_PATH,
  WALLET_DOCS_URL,
  X_URL,
} from "@/components/landing/links";
import { useMedia, useMotionSafe, usePageProgress, useRange, useSmooth } from "@/components/landing/parallax";
import {
  Container,
  CTA_PILL,
  FOCUS_RING,
  SCOPE_LINE,
  SECTION_X,
  SectionLink,
  scrollToSection,
} from "@/components/landing/system";
import { primaryCta, usePoolStatus } from "@/components/landing/usePoolStatus";
import { HorizonEdge } from "@/components/landing/scene/closing-dawn";

// ─── Sections ─────────────────────────────────────────────────────────────────

/** Section ids in page order. Reduced-motion fallbacks of the pinned scenes keep the same ids. */
const SECTION_IDS = [
  "top",
  "pool",
  "how-it-works",
  "proof",
  "privacy",
  "design",
  "network",
  "status",
  "faq",
  "start",
] as const;
type SectionId = (typeof SECTION_IDS)[number];

interface NavItem {
  /** the section the anchor scrolls to */
  id: SectionId;
  label: string;
  /** the sections in which this item is marked as current */
  covers: readonly SectionId[];
}

/** The pill's anchors (lg and up) and the menu's rows. Nothing is marked on top or start. */
const NAV: readonly NavItem[] = [
  { id: "pool", label: "How it works", covers: ["pool", "how-it-works", "proof"] },
  { id: "privacy", label: "Privacy", covers: ["privacy"] },
  { id: "design", label: "Guarantees", covers: ["design"] },
  { id: "network", label: "Network", covers: ["network", "status"] },
  { id: "faq", label: "FAQ", covers: ["faq"] },
];

/**
 * Skip link: hidden until focused. Written as plain CSS so the hidden state
 * does not depend on utility ordering; the visible state is styled with tokens.
 * The menu panel fades and slides 6px in (transform and opacity only), and only
 * when motion is allowed.
 */
const CHROME_CSS = `
.hylsia-chrome-skip:not(:focus) {
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border-width: 0;
  box-shadow: none;
}
@keyframes hylsia-chrome-menu-in {
  from { opacity: 0; transform: translateY(-6px); }
}
@media (prefers-reduced-motion: no-preference) {
  .hylsia-chrome-menu { animation: hylsia-chrome-menu-in 0.18s cubic-bezier(0.22, 1, 0.36, 1); }
}
`;

// ─── Active section ───────────────────────────────────────────────────────────

/**
 * The section crossing a thin band at 35 to 40% of the viewport height, where
 * the eye reads. A section takes over once its top has passed that band, i.e.
 * once its heading sits around mid-screen and the previous section's content
 * has mostly left (with the band at the middle, FAQ was marked while the
 * Status card still filled the upper half). Discrete state: it changes when a
 * section boundary crosses the band, never per scroll frame. The two pinned
 * scenes are tall, so they stay active for their whole pin.
 */
function useActiveSection(): SectionId {
  const [active, setActive] = useState<SectionId>("top");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const inBand = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) inBand.add(entry.target.id);
          else inBand.delete(entry.target.id);
        }
        // at a seam two sections can touch the band at once: the later one wins
        let next: SectionId | null = null;
        for (const id of SECTION_IDS) if (inBand.has(id)) next = id;
        if (next === null) return;
        const resolved: SectionId = next;
        setActive((prev) => (prev === resolved ? prev : resolved));
      },
      { rootMargin: "-35% 0px -60% 0px", threshold: 0 },
    );

    // Sections are looked up after mount; missing ones are skipped. A pinned
    // scene can swap to its static fallback (new element, same id) when the
    // viewport gets short or reduced motion is switched on, so re-scan then.
    let observed: HTMLElement[] = [];
    const scan = () => {
      const found: HTMLElement[] = [];
      for (const id of SECTION_IDS) {
        const el = document.getElementById(id);
        if (el) found.push(el);
      }
      if (found.length === observed.length && found.every((el, i) => el === observed[i])) return;
      observer.disconnect();
      inBand.clear();
      observed = found;
      for (const el of found) observer.observe(el);
    };
    scan();

    let timer = 0;
    const rescan = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(scan, 200);
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    window.addEventListener("resize", rescan, { passive: true });
    reduced.addEventListener("change", rescan);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", rescan);
      reduced.removeEventListener("change", rescan);
      observer.disconnect();
    };
  }, []);

  return active;
}

// ─── Shared bits ──────────────────────────────────────────────────────────────

/**
 * The home links (nav and footer) point at "/" so they work as ordinary links
 * (new tab, copy link). The landing is already home, so a plain click goes
 * back to the top instead of re-navigating to the same route.
 */
function backToTop(e: MouseEvent<HTMLAnchorElement>) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (scrollToSection("top")) e.preventDefault();
}

/** The Hylsia logo mark (components/brand/HylsiaLogo). */
function HylsiaTile() {
  return <HylsiaMark size={36} className="transition-transform motion-safe:group-hover:scale-105" />;
}

// ─── Nav ──────────────────────────────────────────────────────────────────────

/**
 * The pill's night glass: a hairline, a deep translucent fill that lifts
 * towards the top, a soft shadow, and (as a child) a lit top edge.
 */
const PLATE =
  "pointer-events-none absolute inset-0 rounded-full border border-white/[0.1] bg-[linear-gradient(180deg,rgb(24_29_80/0.8),rgb(10_12_42/0.78))] shadow-[0_18px_50px_-22px_rgb(2_3_18/0.95),inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-xl backdrop-saturate-150";

/** The plate's lit top edge. */
function PlateSheen() {
  return (
    <span
      aria-hidden
      className="absolute inset-x-12 top-0 h-px bg-[linear-gradient(90deg,transparent,rgb(201_204_255/0.42),transparent)]"
    />
  );
}

/** Nav text on the night glass (12–15px): mist at 76% is 7:1 over the plate. */
const NAV_TEXT = "text-[color:rgb(201_204_255/0.76)] hover:text-[color:var(--ink)]";

/**
 * Fill of the progress hairline. An indicator rather than decoration, so it
 * keeps tracking under reduced motion, only without the spring. Rendered with
 * a key on `smooth` so its source value is fixed for the life of the component.
 */
function ProgressFill({ page, smooth }: { page: MotionValue<number>; smooth: boolean }) {
  const bar = useSmooth(page);
  const scaleX = useRange(smooth ? bar : page, [0, 1], [0, 1]);
  return (
    <motion.div
      style={{ scaleX }}
      className="h-full w-full origin-left bg-[linear-gradient(90deg,var(--violet-hi),var(--lavender))] will-change-transform"
    />
  );
}

/**
 * One anchor in the pill (lg and up). Heights here are fixed (h-*), not min-h-*:
 * index.css sets min-height: 0 on every .flex element in the utilities layer.
 */
function PillAnchor({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <SectionLink
      to={item.id}
      aria-current={active ? "true" : undefined}
      className={cn(
        "relative flex h-10 items-center whitespace-nowrap rounded-full px-3 text-sm transition-colors duration-200 xl:px-4",
        FOCUS_RING,
        active
          ? "bg-white/[0.07] text-[color:var(--ink)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
          : NAV_TEXT,
      )}
    >
      {item.label}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute bottom-[3px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-[color:var(--lavender)] transition-opacity duration-200",
          active ? "opacity-100" : "opacity-0",
        )}
      />
    </SectionLink>
  );
}

/** One 48px row in the menu (below lg). */
function MenuRow({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: () => void }) {
  return (
    <SectionLink
      to={item.id}
      onNavigate={onNavigate}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex h-12 items-center justify-between gap-3 rounded-lg px-4 text-[15px] font-medium transition-colors",
        FOCUS_RING,
        active ? "bg-white/[0.07] text-[color:var(--ink)]" : cn(NAV_TEXT, "hover:bg-white/[0.04]"),
      )}
    >
      {item.label}
      {active && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--lavender)]" />}
    </SectionLink>
  );
}

export function NavBar() {
  const safe = useMotionSafe();
  const page = usePageProgress();
  // transparent above the clouds, glass once the descent starts (about 120 to 150px of scroll)
  const glass = useRange(page, [0, 0.012], [0, 1]);
  const active = useActiveSection();
  const current = NAV.find((item) => item.covers.includes(active)) ?? null;
  const { state } = usePoolStatus();
  const cta = primaryCta(state);

  // the menu below lg: a disclosure under the pill
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);

  // the anchors take over from lg: fold the menu away
  const wide = useMedia("(min-width: 1024px)");
  useEffect(() => {
    if (wide) setOpen(false);
  }, [wide]);

  // Escape (focus back on the trigger) or a press anywhere outside the nav closes it
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node) || !headerRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <header
      ref={headerRef}
      onBlur={(e) => {
        // keyboard focus left the nav (tabbed past the last menu row): fold the menu away
        const next = e.relatedTarget;
        if (open && next instanceof Node && !e.currentTarget.contains(next)) setOpen(false);
      }}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-4"
    >
      <a
        href="#main"
        className="hylsia-chrome-skip pointer-events-auto absolute left-5 top-5 z-10 rounded-full bg-background px-4 py-2 text-sm font-medium text-foreground shadow-lg outline-none ring-2 ring-primary"
      >
        Skip to content
      </a>

      {/* the pill: no overflow-hidden here, it would clip focus rings */}
      <div className="pointer-events-auto relative mx-auto h-14 w-full max-w-[83rem] rounded-full px-3 sm:px-6">
        {/* glass plate; fully on while the menu is open so pill and panel read as one */}
        <motion.div aria-hidden style={{ opacity: glass }} className={cn(PLATE, open && "invisible")}>
          <PlateSheen />
        </motion.div>
        {open && (
          <div aria-hidden className={PLATE}>
            <PlateSheen />
          </div>
        )}

        {/* progress hairline: the track clips its own fill and shares the plate's opacity */}
        <motion.div
          aria-hidden
          style={{ opacity: glass }}
          className="pointer-events-none absolute inset-x-6 bottom-0 h-px overflow-hidden rounded-full bg-white/[0.06]"
        >
          <ProgressFill key={safe ? "smooth" : "direct"} page={page} smooth={safe} />
        </motion.div>

        {/* content row; from lg a 1fr | auto | 1fr grid centres the anchors on the pill */}
        <div className="relative flex h-full items-center justify-between gap-2 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:gap-4">
          <Link
            href="/"
            aria-label="Hylsia Privacy Pools, home"
            onClick={(e) => {
              setOpen(false);
              backToTop(e);
            }}
            className={cn(
              "group flex shrink-0 items-center gap-2.5 justify-self-start rounded-xl",
              FOCUS_RING,
              "focus-visible:ring-offset-4",
            )}
          >
            <HylsiaTile />
            <span className="hidden text-[15px] font-semibold tracking-tight text-[color:var(--ink)] min-[360px]:inline">
              Hylsia
            </span>
            <span className="hidden items-center gap-2 xl:flex">
              <span aria-hidden className="h-4 w-px bg-white/15" />
              <span className="text-xs text-[color:rgb(201_204_255/0.72)]">Privacy Pools</span>
            </span>
          </Link>

          <nav aria-label="Sections" className="hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <PillAnchor key={item.id} item={item} active={current?.id === item.id} />
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-1.5 justify-self-end sm:gap-2">
            <Link href="/docs" onClick={close} className={cn("hidden h-10 items-center rounded-full px-3 text-sm sm:inline-flex", NAV_TEXT, FOCUS_RING)}>Docs</Link>
            {/* menu trigger, below lg. Never give it a bg-primary* class: index.css forces black text on such buttons. */}
            <button
              ref={triggerRef}
              type="button"
              aria-expanded={open}
              aria-controls="landing-menu"
              onClick={() => setOpen((o) => !o)}
              className={cn(
                "flex h-10 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium transition-colors hover:bg-white/[0.06] lg:hidden",
                NAV_TEXT,
                FOCUS_RING,
                open && "bg-white/[0.07] text-[color:var(--ink)]",
              )}
            >
              {/* below md: icon only */}
              <span className="flex items-center md:hidden">
                {open ? <X className="h-4 w-4" aria-hidden /> : <Menu className="h-4 w-4" aria-hidden />}
                <span className="sr-only">Menu</span>
              </span>
              {/* md to lg: the current section's name */}
              <span className="hidden items-center gap-1.5 md:flex">
                {current?.label ?? "Sections"}
                <span className="sr-only"> menu</span>
                <ChevronDown
                  className={cn(
                    "h-3 w-3 transition-transform duration-200 motion-reduce:transition-none",
                    open && "rotate-180",
                  )}
                  aria-hidden
                />
              </span>
            </button>

            {/* the one status-aware CTA: the app (Pools) until the pool is live, then the vault */}
            <Button asChild className={CTA_PILL}>
              <Link href={cta.href} onClick={close}>
                <span className="sm:hidden">{cta.short}</span>
                <span className="hidden sm:inline">{cta.label}</span>
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* the menu (below lg): rendered only while open, directly under the pill */}
      {open && (
        <nav
          id="landing-menu"
          aria-label="Sections menu"
          className="hylsia-chrome-menu pointer-events-auto mx-auto mt-2 max-h-[calc(100svh-5.5rem)] w-full max-w-[83rem] overflow-y-auto overscroll-contain rounded-2xl border border-white/[0.1] bg-[linear-gradient(180deg,rgb(22_27_76/0.97),rgb(10_12_42/0.97))] p-2 shadow-[0_24px_60px_-24px_rgb(2_3_18/0.95),inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-xl lg:hidden"
        >
          <ul>
            <li className="sm:hidden"><Link href="/docs" onClick={close} className={cn("flex h-12 items-center rounded-lg px-4 text-[15px] font-medium", NAV_TEXT, FOCUS_RING)}>Documentation</Link></li>
            {NAV.map((item) => (
              <li key={item.id}>
                <MenuRow item={item} active={current?.id === item.id} onNavigate={close} />
              </li>
            ))}
          </ul>
          {/* Pools beside the CTA only while the CTA goes elsewhere (the vault, once live): never two links to one page */}
          <div className={cn("mt-2 grid gap-2 border-t border-white/[0.08] p-2 pt-3", cta.href !== POOLS_PATH && "sm:grid-cols-2")}>
            {cta.href !== POOLS_PATH && (
              <Link
                href={POOLS_PATH}
                onClick={close}
                className={cn(
                  "flex h-11 items-center justify-center rounded-full border border-white/[0.14] text-sm font-medium text-[color:var(--ink)] transition-colors hover:bg-white/[0.06]",
                  FOCUS_RING,
                )}
              >
                Pools
              </Link>
            )}
            <Button asChild className={cn(CTA_PILL, "h-11 w-full")}>
              <Link href={cta.href} onClick={close}>
                {cta.label}
              </Link>
            </Button>
          </div>
        </nav>
      )}

      <style>{CHROME_CSS}</style>
    </header>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

/** Footer links: mist at 74% on the footer's night (6.5:1), ink on hover. */
const FOOTER_LINK = cn(
  "inline-flex min-h-10 items-center gap-1 rounded-sm text-sm text-[color:rgb(201_204_255/0.74)] transition-colors hover:text-[color:var(--ink)] lg:min-h-8",
  FOCUS_RING,
);

/** Small print in the footer (12px, mist at 70%: 6:1). */
const FOOTER_CAPTION = "text-xs leading-relaxed text-[color:rgb(201_204_255/0.7)]";

/** Explore column: every chapter of the page, in order. */
const EXPLORE: readonly { to: SectionId; label: string }[] = [
  { to: "pool", label: "How it works" },
  { to: "proof", label: "The proof" },
  { to: "privacy", label: "What stays private" },
  { to: "design", label: "Guarantees" },
  { to: "network", label: "Network" },
  { to: "faq", label: "FAQ" },
];

/**
 * App column: the dashboard's pages, with the labels of its sidebar's Privacy group. Always shown: before the
 * pool is deployed each page says so plainly (and My vault explains how the vault works).
 */
const APP_LINKS: readonly { href: string; label: string }[] = [
  { href: POOLS_PATH, label: "Pools" },
  { href: NOTES_PATH, label: "My notes" },
  { href: POOL_PATH, label: "My vault" },
  { href: "/docs", label: "Documentation" },
];

/** Network column: public Robinhood Chain Testnet resources (external). */
const NETWORK_LINKS: readonly { href: string; label: string }[] = [
  { href: EXPLORER_URL, label: "Block explorer" },
  { href: FAUCET_URL, label: "Testnet faucet" },
  { href: WALLET_DOCS_URL, label: "Add network to wallet" },
];

function FooterCol({ title, children }: { title: string; children: ReactNode }) {
  return (
    <nav aria-label={title}>
      <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-[color:var(--lavender)]">{title}</p>
      <ul className="mt-3 space-y-0.5">{children}</ul>
    </nav>
  );
}

/**
 * External footer link. The icon flows inline and stays glued to the last word,
 * so a label that wraps in a narrow column ends in "wallet ↗" rather than
 * leaving the icon stranded beside two lines.
 */
function ExternalLink({ href, label }: { href: string; label: string }) {
  const words = label.split(" ");
  const last = words.pop();
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK}>
      <span>
        {words.length > 0 && `${words.join(" ")} `}
        <span className="whitespace-nowrap">
          {last}
          <ArrowUpRight className="ml-1 inline-block h-3 w-3" aria-hidden />
        </span>
        <span className="sr-only"> (opens in a new tab)</span>
      </span>
    </a>
  );
}

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer
      className={cn(
        "relative bg-[linear-gradient(to_bottom,#080a28,#070922_45%,var(--night-0))] pb-10 pt-14 sm:pt-16",
        SECTION_X,
      )}
    >
      {/* the hills the journey lands on: they rise over the bottom of the dawn scene, filled with the footer's own night */}
      <HorizonEdge className="absolute inset-x-0 bottom-[calc(100%-1px)] h-12 sm:h-16 lg:h-[76px]" />
      <Container>
        {/* brand + three link columns (privacy pools only): brand row + columns below xl, one row from xl */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 sm:gap-x-10 xl:grid-cols-[1.4fr_repeat(3,minmax(0,1fr))]">
          <div className="col-span-2 sm:col-span-3 xl:col-span-1">
            <Link
              href="/"
              aria-label="Hylsia Privacy Pools, home"
              onClick={backToTop}
              className={cn("group inline-flex items-center gap-2.5 rounded-xl", FOCUS_RING, "focus-visible:ring-offset-4")}
            >
              <HylsiaTile />
              <span className="text-[15px] font-semibold tracking-tight text-[color:var(--ink)]">Hylsia</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-[color:rgb(201_204_255/0.74)]">
              Privacy Pools built for Robinhood Chain Testnet.
            </p>
            <a
              href={X_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "mt-5 flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.12] bg-white/[0.03] text-[color:rgb(201_204_255/0.8)] shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] transition-colors hover:border-white/25 hover:text-[color:var(--ink)]",
                FOCUS_RING,
              )}
            >
              <XTwitter className="h-4 w-4" aria-hidden />
              <span className="sr-only">Hylsia on X (opens in a new tab)</span>
            </a>
          </div>

          <FooterCol title="Explore">
            {EXPLORE.map((item) => (
              <li key={item.to}>
                <SectionLink to={item.to} className={FOOTER_LINK}>
                  {item.label}
                </SectionLink>
              </li>
            ))}
          </FooterCol>

          <FooterCol title="App">
            {APP_LINKS.map((item) => (
              <li key={item.href}>
                <Link href={item.href} className={FOOTER_LINK}>
                  {item.label}
                </Link>
              </li>
            ))}
          </FooterCol>

          <FooterCol title="Network">
            {NETWORK_LINKS.map((item) => (
              <li key={item.href}>
                <ExternalLink href={item.href} label={item.label} />
              </li>
            ))}
          </FooterCol>
        </div>

        {/* bottom bar: the network plate (static, on its approved plate), the honest scope, © and back to top */}
        <div className="relative mt-12 grid gap-6 pt-8 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-10">
          {/* a hairline that fades out at both ends */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgb(174_180_255/0.16)_18%,rgb(174_180_255/0.16)_82%,transparent)]"
          />
          <div className="flex items-center gap-4">
            <span className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-[color:rgb(174_180_255/0.85)]">
              Network
            </span>
            <RobinhoodChainLogo height={22} />
          </div>
          <div className="min-w-0">
            <p className={FOOTER_CAPTION}>{SCOPE_LINE}</p>
            <p className={cn("mt-1.5", FOOTER_CAPTION)}>{NETWORK_TRADEMARK_LINE}</p>
          </div>
          <div className="flex shrink-0 items-center gap-4 text-xs text-[color:rgb(201_204_255/0.7)]">
            <span className="whitespace-nowrap">© {year} Hylsia</span>
            <SectionLink
              to="top"
              className={cn(
                "inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full border border-white/[0.1] bg-white/[0.03] px-4 text-[color:rgb(201_204_255/0.82)] shadow-[inset_0_1px_0_rgb(255_255_255/0.05)] transition-colors hover:border-white/25 hover:text-[color:var(--ink)]",
                FOCUS_RING,
              )}
            >
              Back to top
              <ArrowUp className="h-3 w-3" aria-hidden />
            </SectionLink>
          </div>
        </div>
      </Container>
    </footer>
  );
}
