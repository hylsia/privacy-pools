import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowDownToLine, ChevronDown, Clock, Info, Layers, RefreshCw, SlidersHorizontal, Sort, SortDown, SortUp, ArrowUpDown } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { NetworkLabel } from "@/components/brand/NetworkMark";
import { PoolMark } from "@/components/brand/PoolMark";
import { NetworkFilter } from "@/components/pools/NetworkMenu";
import PoolDetail from "@/components/pools/PoolDetail";
import PoolsShell from "@/components/pools/PoolsShell";
import Sparkline from "@/components/pools/Sparkline";
import { networkReports, POOL_DATA_UNAVAILABLE, POOLS_REFRESH_MS, useLogPoolError, usePoolsAnswer, type NetworkReport } from "@/components/pools/TopStats";
import { loadPrefs, savePrefs, type PoolsPrefs } from "@/components/pools/prefs";
import { age, ethAmount, minFeeText, plural, relayerFeeTerms, short, signedEth } from "@/components/pools/format";
import {
  COLUMN_SORT,
  COLUMNS,
  INTERVALS,
  poolHref,
  publisherNote,
  publisherUp,
  relayerUp,
  SORTS,
  TERMS,
  vaultHref,
  type ColumnKey,
  type PoolRow,
  type SortDir,
  type SortKey,
} from "@/components/pools/types";
import { DeploymentPending, FILLED_FOCUS, PoolStatusPill, poolStatus, QUIET_HOVER } from "@/components/privacy/ui";
import { findPool, MULTI_NETWORK, PRIVACY_NETWORKS } from "@/privacy/config";
import { usePrivacy } from "@/privacy/PrivacyProvider";
import { NETWORKS, networkById, poolKey, type PoolKey } from "@shared/privacy/networks";
import { formatDelay } from "@shared/privacy/screening";

type Tag = "all" | "open" | "relayer";
const TAGS: { key: Tag; label: string }[] = [
  { key: "all", label: "All pools" },
  { key: "open", label: "Open" },
  { key: "relayer", label: "Relayer online" },
];

/** Shared look of the toolbar controls (with the landing's quiet hover: the outline variant's own is 2.4:1 in light). */
const CTRL = `h-9 rounded-lg border-border/60 bg-card/50 px-3 text-[13px] font-medium ${QUIET_HOVER}`;

/** The networks this build offers, in registry order: the network filter's choices. */
const OFFERED = PRIVACY_NETWORKS.map((n) => n.network);

const registryIndex = (chainId: number) => NETWORKS.findIndex((n) => n.chainId === chainId);
const networkName = (chainId: number) => networkById(chainId)?.name ?? `chain ${chainId}`;

/**
 * What each sort compares, most significant first. Activity leads with the transaction count, as its
 * column does, and breaks ties on the ETH moved. Age is measured on each pool's own chain clock.
 */
function sortValue(key: SortKey, p: PoolRow): (bigint | number)[] {
  switch (key) {
    case "anonymity":
      return [p.aspRootMembers];
    case "balance":
      return [p.tvl];
    case "activity":
      return [p.intervalCount, p.intervalDeposits + p.intervalWithdrawals];
    case "net":
      return [p.intervalDeposits - p.intervalWithdrawals];
    case "withdrawals":
      return [p.withdrawals];
    case "fee":
      return [relayerUp(p) ? p.relayerFeeBps : -1];
    case "age":
      return [p.deployedAt ? p.now - p.deployedAt : -1];
  }
}

function compare(a: (bigint | number)[], b: (bigint | number)[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

// ─── small pieces ─────────────────────────────────────────────────────────────

/**
 * The desktop table fits its container instead of scrolling sideways. As the container narrows (container queries on
 * the table's own width, so an open or collapsed sidebar counts), the least telling default figures step aside: Age and
 * Net deposits below 1100px (1280px wide with the sidebar open), then Trend below 900px (1024px wide with it open), and
 * below 800px Activity keeps its count without the ETH moved. The quick view and the pool page show every figure. A
 * column the reader adds (Withdrawals, Relayer fee) never steps aside; with those the table may scroll.
 */
const STEP_ASIDE: Partial<Record<ColumnKey, string>> = {
  age: "@max-[1100px]:hidden",
  net: "@max-[1100px]:hidden",
  trend: "@max-[900px]:hidden",
};
const stepAside = (col: ColumnKey) => STEP_ASIDE[col] ?? "";

function HeaderCell({
  col,
  align = "right",
  sort,
  dir,
  onSort,
}: {
  col: ColumnKey;
  align?: "left" | "right";
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const meta = COLUMNS.find((c) => c.key === col)!;
  const key = COLUMN_SORT[col];
  const active = key !== undefined && key === sort;
  const Arrow = !active ? Sort : dir === "asc" ? SortUp : SortDown;
  const base = "inline-flex items-center gap-1.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
      className={`whitespace-nowrap px-3 py-2.5 text-[13px] font-medium text-muted-foreground last:pr-4 ${align === "right" ? "text-right" : "text-left"} ${stepAside(col)}`}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          {key ? (
            <button type="button" onClick={() => onSort(key)} className={`${base} transition-colors hover:text-foreground ${active ? "text-foreground" : ""}`}>
              {meta.label}
              <Arrow className={`h-3 w-3 ${active ? "text-primary" : "opacity-50"}`} aria-hidden />
            </button>
          ) : (
            <span tabIndex={0} className={`${base} cursor-help`}>
              {meta.label}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{meta.hint}</TooltipContent>
      </Tooltip>
    </th>
  );
}

/**
 * The shared status pill: Open, Awaiting association set (rare: deposits, no root, and a publisher that cannot post
 * one now), Deposits closed. In the table the long "Awaiting association set" takes two lines of a fixed width (so
 * the column's width holds); a short label never wraps.
 */
function StatusBadge({ pool, wrap = false }: { pool: PoolRow; wrap?: boolean }) {
  const status = poolStatus(pool);
  return <PoolStatusPill status={status} wrap={wrap && status === "awaiting"} />;
}

/**
 * The publisher's cue next to the status: the pool has an association-set root, but the server's publisher cannot post
 * a newer one right now, so a deposit no root covers yet waits for it before a private withdrawal (ragequit always
 * works). Worded as the relayer's chip ("Relayer unavailable"); the full note is the pool page's publisher row. Without
 * a root yet, the status itself says so ("Awaiting association set").
 */
function publisherCue(p: PoolRow): string | null {
  if (publisherUp(p) || !p.aspRootPublished) return null;
  // no count here: aspMembers - aspRootMembers nets deposits that join against members a removal takes out, and a
  // current root the server cannot verify counts 0 members (the pool page names joins and removals apart)
  const wait = p.dead ? "" : " A deposit no root holds yet waits for the next root before a private withdrawal; ragequit works at any time.";
  return `Association-set publisher: ${publisherNote(p)}.${wait}`;
}

function PublisherCue({ note, className = "" }: { note: string; className?: string }) {
  return (
    <span title={note} className={`inline-flex max-w-[7.25rem] items-start gap-1 text-left text-xs leading-4 text-muted-foreground ${className}`}>
      <Clock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      <span aria-hidden>Publisher unavailable</span>
      <span className="sr-only">{note}</span>
    </span>
  );
}

/**
 * How fresh the figures are. They update on their own (usePoolsAnswer, every POOLS_REFRESH_MS while the tab is shown),
 * so the page has no refresh button: this line says "Live" and when the last answer came, or "Reconnecting" while a
 * read fails and the figures shown are the last good ones. A local clock only: it sends nothing.
 */
function LiveStatus({ updatedAt, failing }: { updatedAt: number; failing: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!updatedAt) return null;
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1_000));
  const ago = seconds < 5 ? "just now" : seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-muted-foreground"
      title={`The figures update on their own every ${POOLS_REFRESH_MS / 1_000} seconds while this page is open.`}
    >
      <span className="relative flex h-2 w-2" aria-hidden>
        {!failing && <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500/50 motion-safe:animate-ping" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${failing ? "bg-amber-500" : "bg-emerald-600 dark:bg-emerald-400"}`} />
      </span>
      <span className="font-medium text-foreground">{failing ? "Reconnecting" : "Live"}</span>
      <span>updated {ago}</span>
    </span>
  );
}

/**
 * The network under a pool's name: its mark (the Robinhood Chain feather at 20px, a neutral monogram otherwise) and its
 * full name. Static rows only: never inside the quick view's animated sheet.
 */
function NetworkLine({ chainId }: { chainId: number }) {
  const network = networkById(chainId);
  if (!network) return <span className="block font-mono text-xs text-muted-foreground">chain {chainId}</span>;
  return <NetworkLabel network={network} className="text-xs font-medium text-muted-foreground" />;
}

type DepositTarget = { ref: NonNullable<ReturnType<typeof findPool>>; publisherDown: boolean };

/**
 * A pool with no deposit yet: what that means, the three steps from deposit to private withdrawal, and one clear action,
 * instead of a long sentence next to a button. The delay is the network's registry value (the server's setting may
 * differ; the vault and the policy page show the live one). The publisher's outage is its own short line.
 */
function FirstDeposit({ targets, waits }: { targets: DepositTarget[]; waits: string[] }) {
  const delay = Math.max(...targets.map((t) => t.ref.network.aspInclusionDelaySeconds ?? 0));
  const where = MULTI_NETWORK ? ` on ${targets.map((t) => t.ref.network.name).join(" or ")}` : "";
  const steps: { title: string; text: string }[] = [
    { title: "Deposit", text: "Send ETH from your wallet. Your vault keeps the note that proves it is yours, on this device only." },
    {
      title: "Screening",
      text: delay > 0 ? `After about ${formatDelay(delay)}, your deposit joins the association set.` : "Your deposit joins the association set with the next root.",
    },
    { title: "Withdraw", text: "Withdraw privately to any address. The public exit (ragequit) works at any time." },
  ];
  return (
    <div className="border-t border-border/50 bg-muted/15 px-4 py-5 sm:px-5">
      <div className="flex flex-col gap-5">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-foreground">No deposits yet{where}</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Be the first. Every deposit grows the anonymity set, and withdrawals hide better once many have joined.
          </p>
          <ol className="mt-5 flex flex-col divide-y divide-border/40">
            {steps.map((s, i) => (
              <li key={s.title} className="flex gap-3 py-4 first:pt-0 last:pb-0">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-xs font-semibold text-primary" aria-hidden>
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">{s.title}</span>
                  <span className="mt-1 block text-base leading-relaxed text-muted-foreground">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className="flex flex-col items-stretch gap-3 border-t border-border/40 pt-4 sm:flex-row sm:items-center sm:gap-5">
          <Button asChild className={`h-10 rounded-full px-5 ${FILLED_FOCUS}`}>
            <Link href={vaultHref(targets.length === 1 ? targets[0].ref.network.slug : null)}>
              <ArrowDownToLine className="h-3.5 w-3.5" aria-hidden /> Make a deposit
            </Link>
          </Button>
          <Link
            href="/pools/screening"
            className="rounded text-center text-xs font-medium text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            How screening works
          </Link>
        </div>
      </div>
      {waits.length > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {MULTI_NETWORK ? `On ${waits.join(" and ")}, the` : "The"} association-set publisher cannot post roots right now, so a new deposit waits for it
            before a private withdrawal. Ragequit works at any time.
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * The pool's name with its relayer, then its address. The pool's own counts (depositors, deposits, withdrawals,
 * ragequits) and its minimums are in the columns, the quick view and the pool page, not under the name. In a narrow
 * column the relayer chip wraps under the name instead of running into the next column.
 */
function PoolName({ pool }: { pool: PoolRow }) {
  return (
    <div className="flex items-center gap-3">
      <PoolMark />
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={poolHref(pool.chainId, pool.pool)}
            onClick={(e) => e.stopPropagation()}
            className="whitespace-nowrap rounded text-[15px] font-semibold text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            ETH Privacy Pool
          </Link>
          <span
            className="inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-md border border-border/60 px-1.5 font-mono text-xs text-muted-foreground"
            title={
              relayerUp(pool)
                ? `relayer fee ${relayerFeeTerms(pool.relayerFeeBps, pool.relayerMinFeeWei)}, taken from each withdrawal and sealed into its proof`
                : pool.relayer
                  ? publisherUp(pool)
                    ? "relayer temporarily unavailable: you can still pay your own gas (from your wallet), but the gas payer is visible"
                    : "relayer temporarily unavailable, and the association-set publisher cannot post roots right now"
                  : "no relayer online: you can still pay your own gas (from your wallet), but the gas payer is visible"
            }
          >
            {relayerUp(pool) ? `Relayer ${pool.relayerFeeBps / 100}%` : pool.relayer ? "Relayer unavailable" : "No relayer"}
          </span>
        </div>
        {/* the network the pool is on, only in a build with several networks (the same address may then be a pool on
            each, so it is part of the name); with one network the intro and the footer name it */}
        {MULTI_NETWORK && <NetworkLine chainId={pool.chainId} />}
        <span className="block font-mono text-xs text-muted-foreground" title={`pool contract address ${pool.pool}`}>
          {short(pool.pool)}
        </span>
      </div>
    </div>
  );
}

/**
 * A network with no figures to show: no pool deployed there yet, or its public data could not be read. Muted by its
 * text colours only, so the network's mark stays at full strength. No quick view.
 */
function NetworkRow({ report, onRetry, retrying }: { report: NetworkReport; onRetry: () => void; retrying: boolean }) {
  const { network } = report;
  return (
    <li className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:gap-6">
      <div className="flex shrink-0 items-center gap-3 md:w-72">
        <PoolMark />
        <div className="min-w-0 space-y-1">
          <p className="whitespace-nowrap text-[15px] font-semibold text-muted-foreground">ETH Privacy Pool</p>
          <NetworkLabel network={network} className="text-xs font-medium text-muted-foreground" />
        </div>
      </div>
      {report.state === "pending" ? (
        <p className="min-w-0 text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Not deployed yet.</span> Its anonymity set, balance and activity are listed here once it is live
          on {network.name}.
        </p>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col items-start gap-3 sm:flex-row sm:items-center">
          <p className="min-w-0 text-sm leading-relaxed text-muted-foreground">
            Pool data for {network.name} is unavailable right now (public RPC). Figures are only ever read from public chain data.
          </p>
          <Button size="sm" variant="outline" className={`shrink-0 rounded-full px-4 sm:ml-auto ${QUIET_HOVER}`} onClick={onRetry} disabled={retrying}>
            <RefreshCw className={`h-3.5 w-3.5 ${retrying ? "motion-safe:animate-spin" : ""}`} aria-hidden /> Try again
          </Button>
        </div>
      )}
    </li>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Pools() {
  const [prefs, setPrefsState] = useState<PoolsPrefs>(loadPrefs);
  const setPrefs = (patch: Partial<PoolsPrefs>) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  const [tag, setTag] = useState<Tag>("all");
  const [hideEmpty, setHideEmpty] = useState(false);
  const [selected, setSelected] = useState<PoolKey | null>(null);

  const { configured } = usePrivacy();
  const { q: pools, answer } = usePoolsAnswer(prefs.interval);
  // nothing to show at all: the list request failed while this build has a pool to read (a build without one is pending)
  const failed = configured && pools.isError && !answer;
  useLogPoolError(failed ? pools.error : null, "pools table");

  const reports = useMemo(() => networkReports(answer), [answer]);
  const inNetwork = (chainId: number) => prefs.network === "all" || prefs.network === chainId;
  const all = useMemo(() => answer?.pools ?? [], [answer]);
  const rows = useMemo(() => {
    let list = all.filter(
      (p) => (prefs.network === "all" || prefs.network === p.chainId) && (tag === "open" ? !p.dead : tag === "relayer" ? relayerUp(p) : true),
    );
    if (hideEmpty) list = list.filter((p) => p.tvl > 0n);
    return [...list].sort((a, b) => {
      const c = compare(sortValue(prefs.sort, a), sortValue(prefs.sort, b));
      // ties keep the registry order: Robinhood Chain Testnet first
      return (prefs.dir === "asc" ? c : -c) || registryIndex(a.chainId) - registryIndex(b.chainId);
    });
  }, [all, tag, hideEmpty, prefs.network, prefs.sort, prefs.dir]);
  // Networks without figures (not deployed yet, or unreadable right now) follow the pools, in registry order. A status
  // filter is about a pool's figures, so it hides them.
  const others = !answer && configured ? [] : reports.filter((r) => r.state !== "live" && r.state !== "loading" && inNetwork(r.network.chainId));
  const shownOthers = tag === "all" && !hideEmpty ? others : [];
  // no network the build or the server lists has a pool yet: the dashboard's one pending story follows the rows
  const nothingDeployed = !all.length && reports.length > 0 && reports.every((r) => r.state === "pending");
  const loading = !answer && configured && !pools.isError;

  const show = (c: ColumnKey) => prefs.columns.includes(c);
  const selectedPool = all.find((p) => poolKey(p.chainId, p.pool) === selected) ?? null;
  // listed pools of this build that have no deposit yet: the table points at the first one (a deposit target only ever
  // comes from the built-in registry)
  const firstDeposit = rows.filter((p) => p.deposits === 0 && !p.dead).flatMap((p) => {
    const ref = findPool(p.chainId, p.pool);
    return ref ? [{ ref, publisherDown: !publisherUp(p) }] : [];
  });
  // the pointer says so when a deposit made now would wait for the association-set publisher (ragequit always works)
  const firstWaits = firstDeposit.filter((f) => f.publisherDown).map((f) => f.ref.network.name);
  // "Live": the last answer is the newest one; "Reconnecting": the last read failed and the figures are the last good ones
  const failing = pools.isError && !!answer;
  const resetFilters = () => {
    setTag("all");
    setHideEmpty(false);
    if (prefs.network !== "all") setPrefs({ network: "all" });
  };
  /** Header click: first click sorts high to low, a second click on the same column flips it. */
  const onSort = (key: SortKey) => setPrefs(key === prefs.sort ? { dir: prefs.dir === "desc" ? "asc" : "desc" } : { sort: key, dir: "desc" });
  const head = { sort: prefs.sort, dir: prefs.dir, onSort };

  return (
    <PoolsShell>
      <div className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="flex items-center gap-2.5 font-display text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
            <Layers className="h-6 w-6 text-primary" aria-hidden /> Privacy pools
          </h1>
          <LiveStatus updatedAt={pools.dataUpdatedAt} failing={failing} />
        </div>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          {MULTI_NETWORK
            ? "A pool hides which deposit paid for a withdrawal. The more deposits in its anonymity set, the better the cover; amounts and timing can still narrow it. Each network has its own pool and set."
            : `Built for ${OFFERED[0]?.name ?? "Robinhood Chain"}. A pool hides which deposit paid for a withdrawal. The more deposits in its anonymity set, the better the cover; amounts and timing can still narrow it.`}
        </p>
      </div>

      {/* toolbar: network and status on the left; the interval and the view options on the right. No refresh button:
          the figures update on their own (LiveStatus). */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {/* static menu (no animated content), so the network marks inside it are never faded or transformed */}
        <NetworkFilter value={prefs.network} onChange={(network) => setPrefs({ network })} networks={OFFERED} className={CTRL} />

        <div className="flex items-center gap-5" role="group" aria-label="Pool status">
          {TAGS.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={tag === t.key}
              onClick={() => setTag(t.key)}
              className={`h-9 whitespace-nowrap border-b-2 px-0.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                tag === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* the interval for Activity and Net deposits: one click, the choice always in sight */}
          <div role="group" aria-label="Interval" className="inline-flex h-9 items-center gap-0.5 rounded-lg border border-border/60 bg-card/50 p-0.5">
            {INTERVALS.map((i) => (
              <button
                key={i}
                type="button"
                aria-pressed={prefs.interval === i}
                onClick={() => setPrefs({ interval: i })}
                className={`h-full rounded-md px-2.5 font-mono text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  prefs.interval === i ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {i}
              </button>
            ))}
          </div>

          {/* sorting on a phone, where the cards have no column headers (the table's headers sort on a wider screen) */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className={`${CTRL} md:hidden`} aria-label={`Sort by: ${SORTS.find((s) => s.key === prefs.sort)?.label}`}>
                <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> Sort
                <ChevronDown className="h-3 w-3 opacity-60" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={prefs.sort} onValueChange={(v) => setPrefs({ sort: v as SortKey, dir: "desc" })}>
                {SORTS.map((s) => (
                  <DropdownMenuRadioItem key={s.key} value={s.key}>
                    {s.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* the view options in one menu: which columns show, and whether empty pools do */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className={CTRL}>
                {/* icon only on a phone, so the interval, Sort and View share one row */}
                <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> <span className="max-sm:sr-only">View</span>
                {hideEmpty && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="a filter is on" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Columns</DropdownMenuLabel>
              {COLUMNS.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.key}
                  checked={show(c.key)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(v) =>
                    setPrefs({ columns: v ? COLUMNS.map((x) => x.key).filter((k) => k === c.key || prefs.columns.includes(k)) : prefs.columns.filter((k) => k !== c.key) })
                  }
                >
                  {c.label}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={hideEmpty} onSelect={(e) => e.preventDefault()} onCheckedChange={(v) => setHideEmpty(v === true)}>
                Hide pools with no balance
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <p className="px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
                On a narrower table, Age and Net deposits step aside, then Trend. The quick view shows every figure.
              </p>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* table */}
      <div className="mt-3 overflow-hidden rounded-xl border border-border/50 bg-card/60">
        {failed ? (
          // a human line; the raw error is logged to the console (useLogPoolError)
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">
            <p className="mx-auto max-w-md">{POOL_DATA_UNAVAILABLE}</p>
            <div className="mt-4">
              <Button size="sm" variant="outline" className={`rounded-full px-4 ${QUIET_HOVER}`} onClick={() => void pools.refetch()} disabled={pools.isFetching}>
                <RefreshCw className={`h-3.5 w-3.5 ${pools.isFetching ? "motion-safe:animate-spin" : ""}`} aria-hidden /> Try again
              </Button>
            </div>
          </div>
        ) : loading ? (
          <div className="divide-y divide-border/40">
            {Array.from({ length: Math.max(1, reports.filter((r) => inNetwork(r.network.chainId)).length) }, (_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-4 w-64" />
                </div>
                <Skeleton className="ml-auto h-8 w-32" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="hidden h-4 w-20 md:block" />
              </div>
            ))}
          </div>
        ) : rows.length === 0 && shownOthers.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No pools match these filters.{" "}
            <button type="button" className="text-primary hover:underline" onClick={resetFilters}>
              Reset filters
            </button>
          </div>
        ) : (
          <>
            {rows.length > 0 && (
              <>
                {/* desktop / tablet table: a size container, so its columns follow the room the sidebar leaves (STEP_ASIDE) */}
                <div className="@container hidden overflow-x-auto md:block">
                  <table className="w-full border-collapse">
                    <thead className="border-b border-border/50 bg-muted/25">
                      <tr>
                        <th scope="col" className="py-2.5 pl-[68px] pr-3 text-left text-[13px] font-medium text-muted-foreground">Pool</th>
                        {show("anonymity") && <HeaderCell col="anonymity" {...head} />}
                        {show("trend") && <HeaderCell col="trend" align="left" {...head} />}
                        {show("balance") && <HeaderCell col="balance" {...head} />}
                        {show("activity") && <HeaderCell col="activity" {...head} />}
                        {show("net") && <HeaderCell col="net" {...head} />}
                        {show("withdrawals") && <HeaderCell col="withdrawals" {...head} />}
                        {show("fee") && <HeaderCell col="fee" {...head} />}
                        {show("age") && <HeaderCell col="age" {...head} />}
                        {show("status") && <HeaderCell col="status" {...head} />}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {rows.map((p) => {
                        const key = poolKey(p.chainId, p.pool);
                        const net = p.intervalDeposits - p.intervalWithdrawals;
                        const cue = publisherCue(p);
                        return (
                          <tr
                            key={key}
                            tabIndex={0}
                            onClick={() => setSelected(key)}
                            onKeyDown={(e) => {
                              if (e.target !== e.currentTarget) return;
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelected(key);
                              }
                            }}
                            className="cursor-pointer transition-colors hover:bg-muted/30 focus-visible:bg-muted/40 focus-visible:outline-none"
                            aria-label={`ETH Privacy Pool on ${networkName(p.chainId)}, ${p.pool}, open details`}
                          >
                            <td className="py-3 pl-4 pr-3"><PoolName pool={p} /></td>
                            {show("anonymity") && (
                              <td className="px-3 text-right">
                                <span className="font-mono text-sm font-semibold">{p.aspRootMembers.toLocaleString("en-US")}</span>
                                <span className="block whitespace-nowrap font-mono text-xs text-muted-foreground">
                                  {p.deposits === 0 ? "no deposits yet" : plural(p.uniqueDepositors, "depositor")}
                                </span>
                              </td>
                            )}
                            {show("trend") && (
                              <td className={`px-3 py-2 ${stepAside("trend")}`}><Sparkline series={p.tvlSeries} flows={p.netFlow} width={120} height={44} /></td>
                            )}
                            {show("balance") && <td className="whitespace-nowrap px-3 text-right font-mono text-sm">{ethAmount(p.tvl)}</td>}
                            {show("activity") && (
                              <td className="px-3 text-right">
                                <span className="whitespace-nowrap font-mono text-sm">{p.intervalCount.toLocaleString("en-US")} tx</span>
                                {/* the narrowest table keeps the count; the quick view has the ETH moved */}
                                <span className="block whitespace-nowrap font-mono text-xs text-muted-foreground @max-[800px]:hidden">
                                  {ethAmount(p.intervalDeposits + p.intervalWithdrawals)} moved
                                </span>
                              </td>
                            )}
                            {show("net") && (
                              // neutral on purpose: more deposits than withdrawals is neither a gain nor a loss
                              <td className={`whitespace-nowrap px-3 text-right font-mono text-sm ${net === 0n ? "text-muted-foreground" : "text-foreground"} ${stepAside("net")}`}>{signedEth(net)}</td>
                            )}
                            {show("withdrawals") && (
                              <td className="px-3 text-right font-mono text-sm">
                                {p.withdrawals.toLocaleString("en-US")}
                                {p.ragequits > 0 && <span className="block whitespace-nowrap font-mono text-xs text-muted-foreground">+{plural(p.ragequits, "ragequit")}</span>}
                              </td>
                            )}
                            {show("fee") && (
                              <td className="px-3 text-right font-mono text-sm">
                                {p.relayer ? `${p.relayerFeeBps / 100}%` : <span className="text-muted-foreground">offline</span>}
                                {/* the minimum is part of the terms: a small withdrawal pays it instead of the percentage */}
                                {relayerUp(p) && minFeeText(p.relayerMinFeeWei) && (
                                  <span className="block whitespace-nowrap font-mono text-xs text-muted-foreground">{minFeeText(p.relayerMinFeeWei)}</span>
                                )}
                                {p.relayer && !relayerUp(p) && <span className="block whitespace-nowrap font-mono text-xs text-muted-foreground">unavailable</span>}
                              </td>
                            )}
                            {show("age") && <td className={`px-3 text-right font-mono text-sm ${stepAside("age")}`}>{age(p.deployedAt, p.now)}</td>}
                            {show("status") && (
                              <td className="pl-2 pr-4 text-right">
                                <div className="flex flex-col items-end gap-1.5">
                                  <StatusBadge pool={p} wrap />
                                  {cue && <PublisherCue note={cue} />}
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* mobile cards */}
                <ul className="divide-y divide-border/40 md:hidden">
                  {rows.map((p) => {
                    const key = poolKey(p.chainId, p.pool);
                    const cue = publisherCue(p);
                    return (
                      <li key={key} className="relative px-4 py-4">
                        <PoolName pool={p} />
                        <Sparkline series={p.tvlSeries} flows={p.netFlow} width={320} height={44} className="mt-3 h-11 w-full" />
                        <dl className="mt-4 flex flex-col gap-2.5 text-sm">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><dt className="text-muted-foreground">{TERMS.anonymity.label}</dt><dd className="font-mono font-semibold">{p.aspRootMembers.toLocaleString("en-US")}</dd></div>
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><dt className="text-muted-foreground">{TERMS.balance.label}</dt><dd className="font-mono">{ethAmount(p.tvl)}</dd></div>
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><dt className="text-muted-foreground">{TERMS.activity.label} {p.interval}</dt><dd className="font-mono">{p.intervalCount.toLocaleString("en-US")} tx</dd></div>
                        </dl>
                        <div className="mt-3 flex items-center gap-3">
                          <StatusBadge pool={p} />
                          {cue && <PublisherCue note={cue} className="shrink-0" />}
                          <button
                            type="button"
                            onClick={() => setSelected(key)}
                            aria-label={`Quick view: ETH Privacy Pool on ${networkName(p.chainId)}`}
                            className="h-9 flex-1 rounded-full border border-border/60 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:hover:bg-input/50 dark:hover:text-foreground"
                          >
                            Quick view
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {/* a pool with no deposit yet: one short pointer to the first one, instead of a row of zeros alone */}
                {firstDeposit.length > 0 && <FirstDeposit targets={firstDeposit} waits={firstWaits} />}
              </>
            )}

            {shownOthers.length > 0 && (
              <ul className={`divide-y divide-border/40 ${rows.length > 0 ? "border-t border-border/50" : ""}`} aria-label="Networks without a pool to show">
                {shownOthers.map((r) => (
                  <NetworkRow key={r.network.chainId} report={r} onRetry={() => void pools.refetch()} retrying={pools.isFetching} />
                ))}
              </ul>
            )}

            {/* the rows above say what each network will list; this is the dashboard's one pending story */}
            {nothingDeployed && (
              <div className="border-t border-border/50">
                <DeploymentPending titleId="pools-pending-title" />
              </div>
            )}
          </>
        )}
      </div>

      {/* "Testnet ETH only" and "Not audited" are the footer's notice on every page (SCOPE_LINE) */}
      <p className="mt-3 flex items-start gap-2 px-1 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        Every figure is read from public chain data {MULTI_NETWORK ? "on each network" : `on ${OFFERED[0]?.name ?? "the network"}`} and updates on its own.
        Deposits and withdrawals, with their amounts and addresses, are visible to anyone; which deposit paid for which withdrawal is not. A quiet pool
        offers little cover.
      </p>

      <PoolDetail pool={selectedPool} onOpenChange={(o) => !o && setSelected(null)} />
    </PoolsShell>
  );
}
