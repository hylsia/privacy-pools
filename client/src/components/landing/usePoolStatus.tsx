/**
 * The single deployment-state source for every landing CTA and status pill.
 *
 * Every caller goes through usePoolStatus(), which reads privacy.networks: one input-less query, the same for every
 * visitor, with the options the landing has always used, so react-query makes one request for the whole page. The
 * pool is built for Robinhood Chain Testnet: until the server reports a configured pool, every CTA points at the
 * app's front page (/pools), which tells the pending story and links the next steps, so no CTA ever dead-ends.
 *
 * The answer has one entry per network the server serves: Robinhood Chain Testnet in the normal build (a development
 * build may serve local chains instead, or several of them). Whether a configured pool can be read right now (RPC
 * health) shows on the status row under #status (Network.tsx), never in the hero.
 */
import { useMemo } from "react";
import { PRIVACY_NETWORKS } from "@/privacy/config";
import type { NetworkStatus, NetworksAnswer } from "@shared/privacy/api";
import { NETWORKS, networkById, type NetworkInfo } from "@shared/privacy/networks";
import { POOL_PATH, POOLS_PATH, ROBINHOOD_NETWORK } from "@/components/landing/links";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

/**
 * loading  first request in flight (or paused offline), nothing known yet
 * pending  the server answered: no pool is deployed yet
 * live     the server answered with a configured pool
 * error    the first request failed and nothing is known
 */
export type PoolState = "loading" | "pending" | "live" | "error";

/**
 * One served network's status row:
 * live         a pool is configured and its public state was read
 * unavailable  a pool is configured, but its state cannot be read right now (RPC, configuration, contract check)
 * pending      no pool on this network yet
 * loading, error  as for the page, before the first answer
 */
export type NetworkRowState = "loading" | "pending" | "live" | "unavailable" | "error";

export interface NetworkRow {
  network: NetworkInfo;
  state: NetworkRowState;
  /** this network's entry in the last answer; only ever show figures from it when state === "live" */
  status: NetworkStatus | null;
}

export interface PoolStatus {
  state: PoolState;
  /** every served network, in registry order (Robinhood Chain Testnet alone in the normal build); before the first answer, Robinhood Chain Testnet */
  networks: NetworkRow[];
}

const registryOrder = (n: NetworkInfo) => NETWORKS.indexOf(n);

/**
 * The landing's state from the last privacy.networks answer (pure; usePoolStatus calls it). A network the registry
 * does not know is never shown. `failed`: the request failed (it only matters while there is no answer).
 */
export function poolStatusFrom(answer: NetworksAnswer | undefined, failed: boolean): PoolStatus {
  if (!answer) {
    const state: PoolState = failed ? "error" : "loading";
    return { state, networks: [{ network: ROBINHOOD_NETWORK, state, status: null }] };
  }
  const networks: NetworkRow[] = [];
  for (const status of answer.networks) {
    const network = networkById(status.chainId);
    if (!network || networks.some((r) => r.network === network)) continue;
    networks.push({ network, status, state: !status.configured ? "pending" : status.available ? "live" : "unavailable" });
  }
  networks.sort((a, b) => registryOrder(a.network) - registryOrder(b.network));
  // a configured pool makes the page live, even while its state cannot be read: its status row says so
  const state: PoolState = networks.some((r) => r.state !== "pending") ? "live" : "pending";
  return { state, networks };
}

/**
 * Deployment state of the pool. A failed background refetch keeps the last known state (react-query keeps the last
 * data), so CTAs never flicker between "Open your vault" and "Explore the app".
 */
export function usePoolStatus(): PoolStatus {
  const query = trpc.privacy.networks.useQuery(undefined, { staleTime: 30_000, retry: false });
  const answer = useMemo(() => query.data ? { ...query.data, networks: query.data.networks.filter(status => PRIVACY_NETWORKS.some(entry => entry.network.chainId === status.chainId)) } : undefined, [query.data]);
  const failed = query.isError;
  return useMemo(() => poolStatusFrom(answer, failed), [answer, failed]);
}

export interface PrimaryCta {
  href: string;
  /** full label, e.g. for the hero and the closing card */
  label: string;
  /** short label for tight spots (the nav pill below sm) */
  short: string;
}

/**
 * The one primary action: the vault once the pool is live (the dashboard calls
 * /pools/vault "My vault"), otherwise the app's front page, /pools, in every
 * other state (loading, pending, error). It never dead-ends: before deployment
 * /pools says so plainly and offers the next steps (how it works, testnet ETH).
 */
export function primaryCta(state: PoolState): PrimaryCta {
  return state === "live"
    ? { href: POOL_PATH, label: "Open your vault", short: "Vault" }
    : { href: POOLS_PATH, label: "Explore the app", short: "App" };
}

export const POOL_STATE_LABEL: Record<PoolState, string> = {
  loading: "Checking status…",
  pending: "Deployment pending",
  live: "Live · testnet",
  error: "Status unavailable",
};

const PILL_TONE: Record<PoolState, string> = {
  live: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  pending: "bg-primary/12 text-primary",
  loading: "bg-muted text-muted-foreground",
  error: "bg-muted text-muted-foreground",
};

const DOT_TONE: Record<PoolState, string> = {
  live: "bg-emerald-600 dark:bg-emerald-400",
  pending: "bg-primary",
  loading: "bg-muted-foreground motion-safe:animate-pulse",
  error: "bg-muted-foreground",
};

/**
 * 12px status pill with a 6px dot: "Deployment pending", "Live · testnet", …
 * The hero passes `state === "loading" ? "pending" : state` so nothing above
 * the fold flickers while the first request is in flight.
 */
export function PoolStatePill({ state, className }: { state: PoolState; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium leading-4",
        PILL_TONE[state],
        className,
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_TONE[state])} />
      <span className="sr-only">Pool status: </span>
      {POOL_STATE_LABEL[state]}
    </span>
  );
}
