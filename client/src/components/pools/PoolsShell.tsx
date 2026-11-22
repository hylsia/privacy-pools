import "./pools.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { BookOpen, ArrowUpRight, FileCheck2, Layers, Search, Menu, Moon, ShieldCheck, Sun, XTwitter, type IconType } from "@/components/icons";
import { useTheme } from "@/contexts/ThemeContext";
import { HylsiaMark } from "@/components/brand/HylsiaLogo";
import { NetworkAttribution } from "@/components/brand/NetworkAttribution";
import { NoteDiamondIcon } from "@/components/brand/NoteDiamond";
import { X_URL } from "@/components/landing/links";
import { SCOPE_LINE } from "@/components/landing/system";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { trpc } from "@/lib/trpc";
import { PRIVACY_NETWORKS, PRIVACY_POOLS } from "@/privacy/config";
import ApplicationNetworkMenu from "./ApplicationNetworkMenu";
import { IS_ETHEREUM_MAINNET, ENVIRONMENT_NOTICE } from "@/privacy/environmentCopy";
import { ASP_STATUS_SCHEDULE } from "@/privacy/publicData";
import { networkById, poolKey } from "@shared/privacy/networks";
import { isAddress } from "viem";
import { short } from "./format";
import ConnectionSettings from "./ConnectionSettings";
import DashboardWallet from "./DashboardWallet";
import TopStats, { usePoolsAnswer } from "./TopStats";
import { poolHref } from "./types";

interface NavItem {
  label: string;
  href: string;
  icon: IconType;
  external?: boolean;
  /** accessible name when it differs from the visible label */
  name?: string;
}

// The app's own pages. The landing's chapters (how it works, the proof, the FAQ) are one click away through the brand
// mark, so the dashboard's sidebar lists only the app; Hylsia's X account sits at its foot (X_ACCOUNT).
const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: "Privacy",
    items: [
      { label: "Pools", href: "/pools", icon: Layers },
      // the gold diamond: on the landing gold means "your note"
      { label: "My notes", href: "/pools/portfolio", icon: NoteDiamondIcon },
      { label: "My vault", href: "/pools/vault", icon: ShieldCheck },
      // the association set's screening policy: who joins the set, when, and who can be left out
      { label: "Screening policy", href: "/pools/screening", icon: FileCheck2 },
      { label: "Documentation", href: "/docs", icon: BookOpen },
    ],
  },
];

/** Hylsia's official X account, at the foot of the sidebar. X_URL is the one source for every X link. */
const X_ACCOUNT: NavItem = {
  label: `@${X_URL.split("/").filter(Boolean).pop()}`,
  href: X_URL,
  icon: XTwitter,
  external: true,
  name: "Hylsia on X (opens in a new tab)",
};

/**
 * One sidebar link. In the desktop rail (`rail`) the icon keeps its place while the rail widens, and the label fades in
 * once it is open (pools.css: .shell-rail); in the phone's sheet the label always shows.
 */
function NavLink({ item, rail = false, onNavigate }: { item: NavItem; rail?: boolean; onNavigate?: () => void }) {
  const [location] = useLocation();
  // a pool page (/pools/<network>/<address>, or the older /pools/<address>) belongs to Pools
  const isPoolPage = item.href === "/pools" && /^\/pools\/([a-z0-9-]+\/)?0x[0-9a-fA-F]{40}$/.test(location);
  const active = !item.external && !item.href.includes("#") && (location === item.href || isPoolPage);
  const Icon = item.icon;
  // rail: the nav's 12px plus 14px here put the 16px icon on the 68px rail's centre line, open or closed
  const cls = `group flex h-10 items-center gap-3 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
    rail ? "px-[14px]" : "px-3"
  } ${active ? "bg-muted/70 text-foreground" : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"}`;
  const inner = (
    <>
      <Icon className={`h-4 w-4 shrink-0 ${active ? "text-primary" : ""}`} aria-hidden />
      <span className={rail ? "rail-fade whitespace-nowrap" : "truncate"}>{item.label}</span>
      {item.external && (
        <span className={`ml-auto flex shrink-0 ${rail ? "rail-fade" : ""}`} aria-hidden>
          <ArrowUpRight className="h-3 w-3 opacity-60" />
        </span>
      )}
    </>
  );
  return item.external ? (
    <a href={item.href} target="_blank" rel="noopener noreferrer" className={cls} aria-label={item.name ?? item.label} onClick={onNavigate}>
      {inner}
    </a>
  ) : (
    <Link href={item.href} className={cls} aria-label={item.label} aria-current={active ? "page" : undefined} onClick={onNavigate}>
      {inner}
    </Link>
  );
}

function SidebarBody({ rail = false, onNavigate }: { rail?: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Dashboard" className="flex flex-1 flex-col gap-5 overflow-y-auto overflow-x-hidden px-3 py-4">
      {NAV.map((section) => (
        <div key={section.title}>
          {/* the landing footer's column labels: 12px mono capitals in the primary (lavender at night). In the rail the
              title fades in with the labels and keeps its line, so the icons never move. */}
          <p
            className={`mb-1.5 whitespace-nowrap font-mono text-xs font-medium uppercase tracking-[0.18em] text-primary ${
              rail ? "rail-fade px-[14px]" : "px-3"
            }`}
          >
            {section.title}
          </p>
          <div className="space-y-0.5">
            {section.items.map((item) => (
              <NavLink key={item.label} item={item} rail={rail} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** The sidebar's foot, under a hairline: Hylsia's X account. */
function SidebarFoot({ rail = false, onNavigate }: { rail?: boolean; onNavigate?: () => void }) {
  return (
    <>
      <div className="mx-3 border-t border-border/40" aria-hidden />
      <div className="shrink-0 p-3">
        <NavLink item={X_ACCOUNT} rail={rail} onNavigate={onNavigate} />
      </div>
    </>
  );
}

/**
 * The landing's nav lockup (Chrome.tsx): mark, "Hylsia" at 15px, a hairline divider and "Privacy Pools" at 12px.
 * `compact` (the phone header) keeps the name next to the mark and drops the sub-line.
 */
function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      aria-label="Hylsia Privacy Pools, home"
      className="flex items-center gap-2.5 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <HylsiaMark size={36} />
      <span className={`text-[15px] font-semibold tracking-tight text-foreground ${compact ? "hidden sm:inline" : ""}`}>Hylsia</span>
      {!compact && (
        <span className="flex items-center gap-2">
          <span aria-hidden className="h-4 w-px bg-border" />
          <span className="whitespace-nowrap text-xs text-muted-foreground">Privacy Pools</span>
        </span>
      )}
    </Link>
  );
}

// ─── header search: jump to a page or a pool ──────────────────────────────────

interface SearchHit {
  key: string;
  label: string;
  sub: string;
  href: string;
  icon: IconType;
}

// the app's pages, the sidebar's, are the searchable pages
const PAGE_HITS: SearchHit[] = NAV.flatMap((section) => section.items)
  .filter((i) => i.href.startsWith("/pools"))
  .map((i) => ({
    key: i.href,
    label: i.label,
    sub: i.href,
    href: i.href,
    icon: i.icon as IconType,
  }));

/**
 * The association-set publisher's public status (privacy.asp.status: the screening policy, its snapshot and the
 * deposits its exclusion list names), for every privacy-area visitor on one schedule: when a page opens, then every
 * minute, whatever the vault, the notes or the page (ASP_STATUS_SCHEDULE). Input-less and the same answer for everyone.
 * Every reader (the vault's forms, My notes, the pool pages, the policy page, a withdrawal's publish decision) reads
 * this copy and never starts a request itself. A build without a pool asks nothing.
 */
function useASPStatusSchedule() {
  trpc.privacy.asp.status.useQuery(undefined, { ...ASP_STATUS_SCHEDULE, enabled: PRIVACY_POOLS.length > 0 });
}

function ShellSearch({ className = "" }: { className?: string }) {
  const [, navigate] = useLocation();
  // the header strip's request (same input, so one request for both)
  const { answer } = usePoolsAnswer("24h");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  // "/" focuses the search from anywhere outside a text field
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // one hit per pool: the same address can be a pool on each network, so the key and the link name the network
    const pools = answer?.pools ?? [];
    const poolHits: SearchHit[] = pools.map((p) => ({
      key: poolKey(p.chainId, p.pool),
      label: `ETH Privacy Pool · ${networkById(p.chainId)?.name ?? `chain ${p.chainId}`}`,
      sub: p.pool,
      href: poolHref(p.chainId, p.pool),
      icon: Layers,
    }));
    const all = [...poolHits, ...PAGE_HITS];
    if (!needle) return all;
    const found = all.filter((h) => h.label.toLowerCase().includes(needle) || h.sub.toLowerCase().includes(needle));
    // a full address that is not listed can still be opened, on each network this build offers: the pool page reports
    // whether a pool exists there
    if (isAddress(needle)) {
      const open = PRIVACY_NETWORKS.filter(({ network }) => !pools.some((p) => p.chainId === network.chainId && p.pool.toLowerCase() === needle)).map(
        ({ network }): SearchHit => ({
          key: `open:${network.chainId}:${needle}`,
          label: `Open pool on ${network.name}`,
          sub: needle,
          href: poolHref(network.chainId, needle),
          icon: Search,
        }),
      );
      found.unshift(...open);
    }
    return found;
  }, [q, answer]);

  const go = (hit: SearchHit | undefined) => {
    if (!hit) return;
    setOpen(false);
    setQ("");
    input.current?.blur();
    navigate(hit.href);
  };

  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <input
        ref={input}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls="shell-search-list"
        aria-autocomplete="list"
        aria-label="Search pools and pages"
        placeholder="Search a pool address or a page"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (hits.length ? (a + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length : 0));
          } else if (e.key === "Enter") {
            go(hits[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
            input.current?.blur();
          }
        }}
        className="h-9 w-full rounded-lg border border-border/60 bg-card/50 pl-9 pr-9 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/25"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border/60 px-1.5 font-mono text-xs text-muted-foreground" aria-hidden>
        /
      </kbd>
      {open && (
        <ul
          id="shell-search-list"
          role="listbox"
          className="absolute inset-x-0 top-full z-40 mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-border/60 bg-popover p-1 shadow-xl"
        >
          {hits.length === 0 ? (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">Nothing matches. Paste a full pool address to open it.</li>
          ) : (
            hits.map((h, i) => (
              <li
                key={h.key}
                role="option"
                aria-selected={i === active}
                // mousedown keeps focus on the input, so the click lands before the list closes
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(h)}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${i === active ? "bg-muted/70 text-foreground" : "text-muted-foreground"}`}
              >
                <h.icon className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                {/* the label carries the network's full name, so it wraps rather than cut it */}
                <span className="min-w-0 flex-1 font-medium text-foreground">{h.label}</span>
                <span className="shrink-0 font-mono text-xs">{h.sub.startsWith("0x") ? short(h.sub, 6) : h.sub}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export default function PoolsShell({ stats = <TopStats />, children }: { stats?: ReactNode; children: ReactNode }) {
  useASPStatusSchedule();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    // app-root: index.css lets heading utilities win here, as on the landing (Space Grotesk page titles, Inter 600 card titles)
    <div className="app-root flex min-h-screen flex-col bg-background text-foreground">
      {/* top bar: brand sits over the sidebar column, the rest lines up with the content panel */}
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur-xl">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          {/* the mark sits on the rail's centre line (16px of header padding, 36px mark: centre at 34px) */}
          <div className="shrink-0">
            <div className="lg:hidden">
              <Brand compact />
            </div>
            <div className="hidden lg:block">
              <Brand />
            </div>
          </div>
          <ShellSearch className="hidden min-w-0 max-w-md flex-1 md:block lg:hidden xl:block" />
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <div className="hidden min-w-0 lg:block">{stats}</div>
            {/* this browser's own RPC and relayer choice (kept here only, never sent to the server) */}
            {PRIVACY_POOLS.length > 0 && <ConnectionSettings />}
            {toggleTheme && (
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card/50 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              </button>
            )}
            <ApplicationNetworkMenu />
            <DashboardWallet />
          </div>
        </div>
        <div className="px-3 pb-2 sm:px-4 lg:hidden">{stats}</div>
      </header>

      {/* mobile sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        {/* a list of links needs no description: aria-describedby={undefined} tells Radix so (no console warning) */}
        <SheetContent side="left" className="flex w-64 flex-col gap-0 p-0" aria-describedby={undefined}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-14 items-center border-b border-border/40 px-4">
            <Brand />
          </div>
          <SidebarBody onNavigate={() => setMobileOpen(false)} />
          <SidebarFoot onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-0 flex-1">
        {/* desktop sidebar: a 68px rail of icons. It opens over the content while the pointer is on it and closes when
            the pointer leaves (pools.css: .shell-rail), so the page never reflows. Borderless when closed: the content
            panel's rounded corner is the divider. */}
        <aside className="sticky top-14 z-20 hidden h-[calc(100vh-3.5rem)] w-[68px] shrink-0 lg:block">
          <div className="shell-rail absolute inset-y-0 left-0 flex flex-col overflow-hidden bg-background">
            <SidebarBody rail />
            <SidebarFoot rail />
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col border-t border-border/50 bg-card/25 px-4 py-6 sm:px-6 lg:rounded-tl-2xl lg:border-l lg:px-8 lg:py-8">
          {/* One centered reading column; wide tables keep their own responsive overflow. */}
          <div className="mx-auto min-w-0 w-full max-w-6xl flex-1">{children}</div>
          {/* the network Hylsia is built for: the Robinhood Chain plate and the trademark line */}
          <footer className="mx-auto mt-10 w-full max-w-6xl border-t border-border/40 pt-5">
            {IS_ETHEREUM_MAINNET ? <div className="space-y-1 text-xs text-muted-foreground"><p className="font-medium text-foreground">Ethereum Mainnet · Chain 1</p><p>{ENVIRONMENT_NOTICE}</p></div> : <NetworkAttribution><p>{SCOPE_LINE}</p></NetworkAttribution>}
          </footer>
        </main>
      </div>
    </div>
  );
}
