import { Fragment, useEffect, useMemo, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";
import { ArrowDownToLine, ArrowUpFromLine, Ethereum, Info, Layers, Send, Users, type IconType } from "@/components/icons";
import { PoolStatePill } from "@/components/landing/usePoolStatus";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PRIVACY_NETWORKS } from "@/privacy/config";
import { poolsForProfile } from "@/privacy/profileData";
import { usePrivacy } from "@/privacy/PrivacyProvider";
import type { PoolsAnswer } from "@shared/privacy/api";
import { NETWORKS, networkById, type NetworkInfo } from "@shared/privacy/networks";
import { ethAmount, plural } from "./format";
import { TERMS, type Interval, type PoolRow } from "./types";

/** The human line for a failed read, shared by the header strip and the Pools table (the raw error goes to the console). */
export const POOL_DATA_UNAVAILABLE = "Pool data is unavailable right now. Please try again shortly. Figures are only ever read from public chain data.";

/**
 * How often the dashboard's pool figures update on their own: one schedule for every visitor, paused while the tab is
 * hidden (React Query's default). The server memoizes each pool's read for 5 s (server/privacy/pools.ts), so a faster
 * schedule adds no load on the public RPC per visitor.
 */
export const POOLS_REFRESH_MS = 10_000;

/**
 * The public pools list (privacy.pools): the same request for every visitor of every dashboard page, every
 * POOLS_REFRESH_MS. There is no refresh button: the figures stay live. The header strip and the search ask for the 24h
 * interval; the Pools table for the interval it shows.
 */
export function usePoolsAnswer(interval: Interval = "24h") {
  const q = trpc.privacy.pools.useQuery({ interval }, { refetchInterval: POOLS_REFRESH_MS, retry: 1 });
  const answer = useMemo(() => q.data ? poolsForProfile(q.data, PRIVACY_NETWORKS) : undefined, [q.data]);
  return { q, answer };
}

/**
 * Where the dashboard's pool figures stand, from the pools list plus this build's configuration:
 *   live     the list has at least one pool: show its figures
 *   pending  no network has a pool yet (the build has none, or the server lists none): no figures at all
 *   error    a pool is configured but no pool's public data could be read: "—" and a human line
 *   loading  the first answer is still on its way
 * A build without a pool is pending at once, even while (or if) the list request fails: there is nothing to read.
 */
export type PoolsState = "live" | "pending" | "error" | "loading";

export function poolsState(answer: PoolsAnswer | undefined, isError: boolean, configured: boolean): PoolsState {
  if (answer && answer.pools.length > 0) return "live";
  if (!configured) return "pending";
  if (answer) return answer.unavailable.length > 0 ? "error" : "pending";
  return isError ? "error" : "loading";
}

/** One network as the dashboard reports it: its pools, or why there is none to show. */
export interface NetworkReport {
  network: NetworkInfo;
  /** live: listed with figures; pending: no pool deployed yet; unavailable: a pool whose data cannot be read; loading */
  state: "live" | "pending" | "unavailable" | "loading";
  pools: PoolRow[];
}

const registryIndex = (chainId: number) => NETWORKS.findIndex((n) => n.chainId === chainId);

/**
 * Every network the dashboard reports on, in registry order (Robinhood Chain Testnet first): the server's list, or this
 * build's before the first answer (and from a server that lists no networks).
 */
export function networkReports(answer: PoolsAnswer | undefined): NetworkReport[] {
  const ids = new Set<number>(
    answer && answer.networks.length > 0 ? answer.networks.map((n) => n.chainId) : PRIVACY_NETWORKS.map((n) => n.network.chainId),
  );
  for (const p of answer?.pools ?? []) ids.add(p.chainId);
  return [...ids]
    .sort((a, b) => registryIndex(a) - registryIndex(b))
    .flatMap((chainId): NetworkReport[] => {
      const network = networkById(chainId);
      if (!network) return [];
      const pools = answer?.pools.filter((p) => p.chainId === chainId) ?? [];
      let state: NetworkReport["state"];
      if (pools.length > 0) state = "live";
      else if (!answer) {
        const built = PRIVACY_NETWORKS.find((n) => n.network.chainId === chainId);
        state = built?.problem ? "unavailable" : built && !built.pool ? "pending" : "loading";
      } else if (answer.unavailable.some((u) => u.chainId === chainId)) state = "unavailable";
      else state = answer.networks.find((n) => n.chainId === chainId)?.pool ? "unavailable" : "pending";
      return [{ network, state, pools }];
    });
}

/** "Local chain A 12 · Local chain B not deployed yet": one figure per network, never a total (several networks only). */
export function perNetwork(reports: readonly NetworkReport[], figure: (p: PoolRow) => string): string {
  return reports
    .map((r) =>
      r.state === "live"
        ? `${r.network.name} ${r.pools.map(figure).join(", ")}`
        : `${r.network.name} ${r.state === "pending" ? "not deployed yet" : r.state === "unavailable" ? "unavailable" : "…"}`,
    )
    .join(" · ");
}

/** Logs a failed pool read once per distinct message, for developers; the UI shows POOL_DATA_UNAVAILABLE instead. */
export function useLogPoolError(error: { message: string } | null | undefined, where: string) {
  const message = error?.message;
  useEffect(() => {
    if (message) console.info(`[pools] ${where}: pool data unavailable:`, message);
  }, [message, where]);
}

/** One bordered header pill: icon, short label, value. `className` controls at which widths it shows. */
export function StatPill({
  icon: Icon,
  label,
  value,
  hint,
  className = "",
}: {
  icon: IconType;
  label: ReactNode;
  value: ReactNode;
  hint?: string;
  className?: string;
}) {
  const body = (
    <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-border/60 bg-card/50 px-3 text-[13px]">
      <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
      <span className="whitespace-nowrap text-muted-foreground">{label}</span>
      <span className="whitespace-nowrap font-mono font-medium tabular-nums text-foreground">{value}</span>
    </span>
  );
  if (!hint) return <span className={`shrink-0 ${className}`}>{body}</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={`shrink-0 cursor-help rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}>
          {body}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{hint}</TooltipContent>
    </Tooltip>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { key: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border/60 bg-card/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          onClick={() => onChange(o.key)}
          className={`h-full whitespace-nowrap rounded-md px-2.5 font-mono text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            value === o.key ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Dashboard-wide stats strip, led by the anonymity set. In the normal build there is one pool (Robinhood Chain
 * Testnet) and the strip shows its figures. A build with several networks has one pool per network: anonymity sets
 * are never added up (each pool is its own crowd), so the strip shows the largest one and names every network's in
 * its hint, and the pool balance and the counts are totals across the networks, labelled so, with each network's
 * figure in the hint. Amounts are in testnet ETH only: there is no price and no currency switch. Like the landing's
 * status row, it never shows a figure unless a pool is live: while none is deployed it tells the pending story
 * instead.
 */
export default function TopStats() {
  const { configured } = usePrivacy();
  const { q, answer } = usePoolsAnswer("24h");
  const state = poolsState(answer, q.isError, configured);
  useLogPoolError(state === "error" ? q.error : null, "header");
  const reports = useMemo(() => networkReports(answer), [answer]);

  if (state === "pending") {
    // the network by name (several: a line breaks between two names, never inside one)
    return (
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <PoolStatePill state="pending" />
        <span className="min-w-0 text-xs text-muted-foreground">
          {reports.map((r, i) => (
            <Fragment key={r.network.chainId}>
              {i > 0 && " · "}
              <span className="whitespace-nowrap">{r.network.name}</span>
            </Fragment>
          ))}
        </span>
      </div>
    );
  }

  const all = answer?.pools ?? [];
  const loading = state === "loading";
  const failed = state === "error";
  const count = (f: (p: PoolRow) => number) => all.reduce((s, p) => s + f(p), 0);
  const sum = (f: (p: PoolRow) => bigint) => all.reduce((s, p) => s + f(p), 0n);
  const shown = (v: string | number) => (failed ? "—" : loading ? "…" : typeof v === "number" ? v.toLocaleString("en-US") : v);
  const ragequits = count((p) => p.ragequits);
  // the largest pool's crowd: a withdrawal hides only among its own pool's deposits, so the sets are never summed
  const largest = all.reduce((m, p) => Math.max(m, p.aspRootMembers), 0);
  // the totals' scope, in words: across the networks, or the one network with a live pool
  const several = all.length > 1;
  const one = all[0] ? (networkById(all[0].chainId)?.name ?? `chain ${all[0].chainId}`) : "";
  const across = several ? "across the networks" : one ? `on ${one}` : "";
  const breakdown = (f: (p: PoolRow) => string) => (reports.length > 1 ? ` (${perNetwork(reports, f)})` : "");
  // From lg up the strip sits inline in the header, so the later pills join only as the screen widens;
  // below lg it is its own scrolling row and shows every pill. (Tailwind emits arbitrary min-[…] variants
  // before lg:, so the widest pill uses rules that never overlap instead of overriding lg:hidden.)
  const wide = "lg:hidden 2xl:inline-flex";
  const widest = "hidden max-lg:inline-flex min-[1880px]:inline-flex";
  // "Largest" only when there are several crowds to choose the largest from
  const largestLabel = several ? "Largest anonymity set" : TERMS.anonymity.label;
  const since = (what: string) => `${what} since deployment${across ? `, ${across}` : ""}`;

  if (failed) {
    // "—" instead of a figure, and the human line (the raw error is in the console)
    return (
      <div className="relative flex items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden">
        <StatPill icon={Layers} label="Pools" value="—" hint={POOL_DATA_UNAVAILABLE} />
        <StatPill icon={Users} label={largestLabel} value="—" hint={POOL_DATA_UNAVAILABLE} />
        <StatPill icon={Ethereum} label={TERMS.balance.label} value="—" hint={POOL_DATA_UNAVAILABLE} className={wide} />
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className="inline-flex h-9 shrink-0 cursor-help items-center gap-1.5 whitespace-nowrap rounded-lg px-1 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Info className="h-3.5 w-3.5" aria-hidden /> Unavailable right now
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-60">{POOL_DATA_UNAVAILABLE}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    // relative: the strip, not the sticky header, holds the screen-reader-only text below, so it scrolls inside the
    // strip instead of widening the page on phones
    <div className="relative flex items-center gap-2 overflow-x-auto [&::-webkit-scrollbar]:hidden">
      <StatPill
        icon={Layers}
        label="Pools"
        value={shown(all.length)}
        hint={
          several || reports.length > 1
            ? "One ETH pool per network. Each is its own anonymity set: a withdrawal hides only among its own pool's deposits."
            : `The ETH privacy pool${one ? ` on ${one}` : ""}. A withdrawal hides among its deposits under the published association-set root.`
        }
      />
      <StatPill
        icon={Users}
        label={largestLabel}
        value={shown(largest)}
        hint={
          several
            ? `${reports.length > 1 ? `${perNetwork(reports, (p) => p.aspRootMembers.toLocaleString("en-US"))}. ` : ""}Deposits under each pool's published association-set root. A withdrawal hides only among deposits in its own network's pool; amounts and timing can narrow it.`
            : `Deposits under the pool's published association-set root: a private withdrawal could have come from any of them. Amounts and timing can narrow it.`
        }
      />
      <StatPill
        icon={Ethereum}
        label={
          <>
            {TERMS.balance.label}
            {several && <span className="sr-only"> across the networks</span>}
          </>
        }
        value={shown(ethAmount(sum((p) => p.tvl)))}
        hint={`Testnet ETH held by the pool ${several ? "contracts across the networks" : `contract${one ? ` on ${one}` : ""}`}${breakdown((p) => ethAmount(p.tvl))}. Amounts are public; who owns each note is not.`}
      />
      <StatPill
        icon={ArrowDownToLine}
        label="Deposits"
        value={shown(count((p) => p.deposits))}
        hint={`${since("Deposits")}${breakdown((p) => p.deposits.toLocaleString("en-US"))}. Amounts and depositor addresses are public.`}
        className={wide}
      />
      <StatPill
        icon={ArrowUpFromLine}
        label={TERMS.withdrawals.label}
        value={shown(count((p) => p.withdrawals))}
        hint={`${since("Private withdrawals")}. Public ragequits are counted separately: ${loading ? "…" : plural(ragequits, "ragequit")}.`}
        className={wide}
      />
      <StatPill
        icon={Send}
        label={TERMS.feesPaid.label}
        value={shown(ethAmount(sum((p) => p.feesPaid)))}
        hint={`${TERMS.feesPaid.hint} All time${across ? `, ${across}` : ""}.`}
        className={widest}
      />
    </div>
  );
}
