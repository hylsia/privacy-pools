/**
 * The pool routes (final design §5 "Routes").
 *
 *   - CanonicalPoolRoute serves /pools/<network>/<address>. A known numeric chain id in place of the slug redirects to
 *     the slug (/pools/46630/0x… → /pools/robinhood-testnet/0x…); everything else is the pool page's to show,
 *     including a network Hylsia is not built for.
 *   - PoolAddressRedirect serves the legacy /pools/<address> (links made before pool pages named their network). The
 *     same deployer gives a pool the same address on every chain, so in a build with several networks an address alone
 *     can name several pools. It looks the address up in this build's registry first, then in the shell's public pools
 *     answer (the request every visitor's shell makes, with the same input):
 *       one match: a replacing redirect to /pools/<slug>/<address>;
 *       several: the chooser "This address has a pool on N networks";
 *       none: "Pool not found".
 */
import { useMemo } from "react";
import { Link, Redirect, useParams, useSearch } from "wouter";
import { isAddress } from "viem";
import { ArrowLeft, ChevronRight } from "@/components/icons";
import { NetworkMark } from "@/components/brand/NetworkMark";
import PoolsShell from "@/components/pools/PoolsShell";
import { short } from "@/components/pools/format";
import { CARD, QUIET_HOVER } from "@/components/privacy/ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { PRIVACY_NETWORKS, PRIVACY_POOLS } from "@/privacy/config";
import { NETWORKS, networkById, poolKey, type NetworkInfo } from "@shared/privacy/networks";
import PoolPage from "./PoolPage";

/** The canonical pool page link: /pools/<network slug>/<address>. */
export const poolPageHref = (network: Pick<NetworkInfo, "slug">, address: string) => `/pools/${network.slug}/${address}`;

export function CanonicalPoolRoute() {
  const { network = "", address = "" } = useParams<{ network: string; address: string }>();
  const search = useSearch().replace(/^\?/, "");
  if (/^\d+$/.test(network)) {
    const n = networkById(Number(network));
    if (n) return <Redirect to={`${poolPageHref(n, address)}${search ? `?${search}` : ""}`} replace />;
  }
  return <PoolPage />;
}

interface Match {
  network: NetworkInfo;
  pool: string;
}

/** Registry order: Robinhood Chain Testnet first. */
const registryOrder = (a: Match, b: Match) =>
  NETWORKS.findIndex((n) => n.chainId === a.network.chainId) - NETWORKS.findIndex((n) => n.chainId === b.network.chainId);

/** "Robinhood Chain Testnet" (or "Local chain A or Local chain B"): the networks this build offers. */
const BUILT_FOR = PRIVACY_NETWORKS.map((n) => n.network.name).join(" or ");

export default function PoolAddressRedirect() {
  const { address = "" } = useParams<{ address: string }>();
  const valid = isAddress(address);
  const needle = address.toLowerCase();

  const registry = useMemo<Match[]>(
    () => (valid ? PRIVACY_POOLS.filter((r) => r.pool.toLowerCase() === needle).map((r) => ({ network: r.network, pool: r.pool })) : []),
    [valid, needle],
  );
  // Only when the registry has no pool at this address: the shell's own request (same input, same schedule).
  const answer = trpc.privacy.pools.useQuery({ interval: "24h" }, { enabled: valid && registry.length === 0, refetchInterval: 30_000, retry: 1 });
  const fromServer = useMemo<Match[]>(() => {
    const pools = (answer.data as { pools?: unknown } | undefined)?.pools;
    if (!valid || !Array.isArray(pools)) return [];
    const seen = new Set<string>();
    const out: Match[] = [];
    for (const p of pools as { chainId?: unknown; pool?: unknown }[]) {
      if (typeof p?.chainId !== "number" || typeof p.pool !== "string" || p.pool.toLowerCase() !== needle) continue;
      const network = networkById(p.chainId);
      if (!network || seen.has(poolKey(p.chainId, p.pool as `0x${string}`))) continue;
      seen.add(poolKey(p.chainId, p.pool as `0x${string}`));
      out.push({ network, pool: p.pool });
    }
    return out.sort(registryOrder);
  }, [answer.data, valid, needle]);

  const matches = registry.length > 0 ? registry : fromServer;
  if (valid && matches.length === 1) return <Redirect to={poolPageHref(matches[0].network, matches[0].pool)} replace />;

  const looking = valid && registry.length === 0 && answer.isPending && !answer.isError;
  const unavailable = valid && registry.length === 0 && !answer.data && answer.isError;

  return (
    <PoolsShell>
      <div className="mx-auto max-w-xl py-16">
        {looking ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="mx-auto h-8 w-64" />
            <Skeleton className="mx-auto h-4 w-80" />
            <span className="sr-only">Looking up this pool</span>
          </div>
        ) : matches.length > 1 ? (
          <>
            <h1 className="text-center font-display text-2xl font-semibold tracking-[-0.03em]">
              This address has a pool on {matches.length} networks
            </h1>
            <p className="mt-2 text-center text-sm text-muted-foreground">
              Each network has its own pool and its own anonymity set. Choose the one you mean.
            </p>
            <ul className={`${CARD} mt-6 divide-y divide-border/50 overflow-hidden`}>
              {matches.map((m) => (
                <li key={poolKey(m.network.chainId, m.pool as `0x${string}`)}>
                  <Link
                    href={poolPageHref(m.network, m.pool)}
                    className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                  >
                    <NetworkMark network={m.network} size={20} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-foreground">ETH Privacy Pool · {m.network.name}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        Chain ID {m.network.chainId} · {short(m.pool)}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="text-center">
            <h1 className="font-display text-2xl font-semibold tracking-[-0.03em]">{unavailable ? "Pool data is unavailable" : "Pool not found"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {!valid
                ? "That is not a valid contract address."
                : unavailable
                  ? "The list of pools could not be loaded right now, so this address could not be looked up. Try again in a moment."
                  : `There is no privacy pool at ${short(address)} on ${BUILT_FOR}.`}
            </p>
            <Button asChild variant="outline" className={`mt-6 rounded-full ${QUIET_HOVER}`}>
              <Link href="/pools">
                <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> All pools
              </Link>
            </Button>
          </div>
        )}
      </div>
    </PoolsShell>
  );
}
