import { useMemo } from "react";
import { Link } from "wouter";
import { ArrowDownToLine, ArrowUpFromLine, DoorOpen, ExternalLink } from "@/components/icons";
import { PoolMark } from "@/components/brand/PoolMark";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FILLED, PoolStatusPill, poolStatus, QUIET_HOVER } from "@/components/privacy/ui";
import { nextRootChange, nextRootChangeText, publisherStateWords, ScreeningSummary, useASPStatusOf } from "@/components/privacy/Screening";
import { explorerAddressUrl, explorerTxUrl, findPool } from "@/privacy/config";
import { networkById, type PoolId } from "@shared/privacy/networks";
import { age, ago, ethAmount, minFeeText, plural, short, signedEth } from "./format";
import Sparkline from "./Sparkline";
import { MetricList, MetricRow } from "./MetricList";
import { poolHref, PUBLISHER_WAIT_NOTE, publisherNote, publisherUp, relayerDownNote, relayerUp, TERMS, vaultHref, type PoolRow } from "./types";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <MetricRow label={label} value={value} sub={hint} />;
}

/** One governance address on the pool's own network; `note` says what the role can (and cannot) do, in the website's words. */
function AddressLine({ chainId, label, value, note }: { chainId: number; label: string; value: string; note?: string }) {
  const link = explorerAddressUrl(chainId, value);
  return (
    <div className="flex items-start justify-between gap-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="text-muted-foreground">{label}</p>
        {note && <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{note}</p>}
      </div>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-xs text-primary hover:underline">
          {short(value)} <ExternalLink className="h-3 w-3" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : (
        <span className="shrink-0 font-mono text-xs">{short(value)}</span>
      )}
    </div>
  );
}

/** Deposits and withdrawals in the flow palette (as on the pool page); the public ragequit stands apart. */
const KIND = {
  deposit: { label: "Deposit", icon: ArrowDownToLine, tone: "text-[color:var(--flow-in)]" },
  withdraw: { label: "Private withdrawal", icon: ArrowUpFromLine, tone: "text-[color:var(--flow-out)]" },
  ragequit: { label: "Ragequit (public exit)", icon: DoorOpen, tone: "text-muted-foreground" },
} as const;

/** The owner's powers, exactly as the website and the contract disclose them. */
export const OWNER_NOTE =
  "Can stop new deposits, set the minimum deposit, choose who publishes the association-set root and transfer ownership. Cannot move funds, pause withdrawals or upgrade the contracts.";

/**
 * The Pools table's quick view of one pool. The sheet slides in, so the network is named in text only (no mark
 * inside an animated container), and every link stays on the pool's own network: its explorer, its pool page, and
 * vault links that open the vault on that network (#network=<slug>, read once and stripped). Deposit and Withdraw
 * appear only for a pool built into this app: a deposit target never comes from a server answer.
 */
export default function PoolDetail({ pool, onOpenChange }: { pool: PoolRow | null; onOpenChange: (open: boolean) => void }) {
  const network = pool ? networkById(pool.chainId) : null;
  const ours = pool ? findPool(pool.chainId, pool.pool) : null;
  const now = pool?.now ?? 0;
  // the pool's screening policy, from the shell's privacy.asp.status copy (every visitor's; nothing new is sent)
  const statusRef = useMemo<PoolId | null>(() => (pool ? { chainId: pool.chainId, pool: pool.pool } : null), [pool?.chainId, pool?.pool]);
  const screening = useASPStatusOf(statusRef).screening;
  // what the next root changes, from the operator's status (joins and removals counted apart; nothing when the server
  // cannot verify the current root)
  const nextChange = nextRootChangeText(nextRootChange(screening), { asks: true, schedule: screening?.autoPublish.running ?? true });
  return (
    <Sheet open={pool !== null} onOpenChange={onOpenChange}>
      {/* app-root: the sheet is portaled outside the shell, so it carries the heading roll-back itself */}
      <SheetContent side="right" className="app-root w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {pool && (
          <>
            {/* shrink-0: the global `.flex { min-height: 0 }` would otherwise squash the header when the sheet scrolls */}
            <SheetHeader className="shrink-0 border-b border-border/50 p-5">
              <div className="flex items-center gap-3">
                <PoolMark size="sm" />
                <div className="min-w-0">
                  <SheetTitle className="text-base">ETH Privacy Pool</SheetTitle>
                  <SheetDescription className="text-xs">
                    {network?.name ?? "Unknown network"} · chain {pool.chainId} · age {age(pool.deployedAt, now)}
                  </SheetDescription>
                </div>
                <PoolStatusPill status={poolStatus(pool)} className="ml-auto mr-8" />
              </div>
            </SheetHeader>

            <div className="space-y-5 p-5">
              {/* lead: the anonymity set, then the pool balance trend */}
              <div className="rounded-xl border border-border/50 bg-card/60 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">{TERMS.anonymity.label}</p>
                    <p className="mt-0.5 font-mono text-2xl font-semibold leading-tight text-foreground">{pool.aspRootMembers.toLocaleString("en-US")}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {pool.deposits === 0
                        ? "no deposits yet"
                        : `deposits under the published root · ${plural(pool.uniqueDepositors, "depositor address", "depositor addresses")}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs font-medium text-muted-foreground">{TERMS.balance.label}</p>
                    <p className="mt-0.5 font-mono text-lg font-semibold text-foreground">{ethAmount(pool.tvl)}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {pool.deposits === 0 ? (
                    `No deposits yet. Every deposit grows the anonymity set; withdrawals hide better once many have joined.${publisherUp(pool) ? "" : ` ${PUBLISHER_WAIT_NOTE}`}`
                  ) : (
                    <>
                      A private withdrawal proved against this root could have come from any of these deposits that holds enough. Amounts and timing can
                      narrow it; the withdraw form checks this before you send.
                      {nextChange && ` ${nextChange.charAt(0).toUpperCase()}${nextChange.slice(1)}.`}
                    </>
                  )}
                </p>
                <Sparkline series={pool.tvlSeries} flows={pool.netFlow} width={420} height={96} className="mt-3 h-24 w-full" />
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>Trend · pool balance, last {pool.interval}</span>
                  {/* an empty pool's dashed baseline has no ticks to explain: the legend starts with the first deposit */}
                  {pool.deposits === 0 ? (
                    <span>No deposits yet</span>
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm" style={{ background: "var(--flow-in)" }} aria-hidden /> more deposited
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-sm" style={{ background: "var(--flow-out)" }} aria-hidden /> more withdrawn or ragequit
                      </span>
                    </>
                  )}
                </p>
              </div>

              <MetricList label="Pool figures">
                <Stat label={`${TERMS.activity.label} ${pool.interval}`} value={`${pool.intervalCount.toLocaleString("en-US")} tx`} hint={`${ethAmount(pool.intervalDeposits + pool.intervalWithdrawals)} moved`} />
                <Stat label={`${TERMS.net.label} ${pool.interval}`} value={signedEth(pool.intervalDeposits - pool.intervalWithdrawals)} hint="deposits minus withdrawals and ragequits" />
                <Stat label={TERMS.withdrawals.label} value={pool.withdrawals.toLocaleString("en-US")} hint={`private · ${plural(pool.ragequits, "public ragequit")}`} />
                <Stat
                  label={TERMS.fee.label}
                  value={relayerUp(pool) ? `${pool.relayerFeeBps / 100}%` : pool.relayer ? "unavailable" : "offline"}
                  hint={
                    relayerUp(pool)
                      ? `${minFeeText(pool.relayerMinFeeWei) ? `${minFeeText(pool.relayerMinFeeWei)} · ` : ""}sealed into each proof`
                      : pool.relayer
                        ? publisherUp(pool)
                          ? "temporarily; paying your own gas still works, but the gas payer is visible"
                          : "temporarily"
                        : "pay your own gas (from your wallet); the gas payer is visible"
                  }
                />
                <Stat label="Deposited" value={ethAmount(pool.depositedTotal)} hint="since deployment" />
                <Stat label="Withdrawn" value={ethAmount(pool.withdrawnTotal)} hint="since deployment, ragequits included" />
                <Stat label="Commitments" value={pool.leafCount.toLocaleString("en-US")} hint="deposits + change notes" />
                <Stat label="Minimum deposit" value={pool.minDeposit === 0n ? "none" : ethAmount(pool.minDeposit)} />
              </MetricList>

              {/* An in-app route to the complete pool view. */}
              <Button asChild variant="secondary" className="w-full rounded-full">
                <Link href={poolHref(pool.chainId, pool.pool)}>
                  Full pool page and privacy health
                </Link>
              </Button>

              {/* only a pool built into this app takes deposits from it, and the vault opens on that pool's network */}
              {ours && (
                <div className="flex gap-2">
                  {/* a closed pool gets a real disabled button: `disabled` on Button asChild would land on the link and do nothing */}
                  {pool.dead ? (
                    <Button disabled className={`flex-1 rounded-full ${FILLED}`}>
                      <ArrowDownToLine className="mr-1.5 h-4 w-4" aria-hidden /> Deposits closed
                    </Button>
                  ) : (
                    <Button asChild className="flex-1 rounded-full">
                      <Link href={vaultHref(ours.network.slug)}>
                        <ArrowDownToLine className="mr-1.5 h-4 w-4" aria-hidden /> Deposit
                      </Link>
                    </Button>
                  )}
                  <Button asChild variant="outline" className={`flex-1 rounded-full ${QUIET_HOVER}`}>
                    <Link href={vaultHref(ours.network.slug, "withdraw")}>
                      <ArrowUpFromLine className="mr-1.5 h-4 w-4" aria-hidden /> Withdraw
                    </Link>
                  </Button>
                </div>
              )}

              <section>
                <h3 className="mb-2 text-sm font-semibold">Recent public activity</h3>
                {pool.recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{pool.deposits === 0 ? "No public activity yet: the first deposit appears here." : "No public activity yet."}</p>
                ) : (
                  <ul className="divide-y divide-border/50 rounded-xl border border-border/50 bg-card/30">
                    {pool.recent.map((a) => {
                      const k = KIND[a.kind];
                      const link = explorerTxUrl(pool.chainId, a.txHash);
                      return (
                        <li key={`${a.txHash}-${a.kind}`} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                          <k.icon className={`h-4 w-4 shrink-0 ${k.tone}`} aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="truncate">{k.label}</p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {a.kind === "withdraw" ? "to " : "from "}
                              {short(a.account)} · {ago(a.timestamp, now)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-mono text-xs">{ethAmount(a.value)}</p>
                            {link && (
                              <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline">
                                tx <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                              </a>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Every row here is public chain data. The proof hides which deposit a private withdrawal spent; ragequits are public and linked to
                  their deposit, and amounts, timing and addresses can still hint at a link.
                </p>
              </section>

              <section className="rounded-xl border border-border/50 bg-card/30 px-4 py-2" aria-label="Contract and governance">
                <AddressLine chainId={pool.chainId} label="Pool contract" value={pool.pool} note="non-upgradeable, no proxy" />
                <AddressLine chainId={pool.chainId} label="Owner" value={pool.owner} note={OWNER_NOTE} />
                <AddressLine
                  chainId={pool.chainId}
                  label="Association-set publisher"
                  value={pool.aspPostman}
                  note={!publisherUp(pool) && pool.aspPublishBlock === "policy_error" ? publisherStateWords(false, "policy_error") : publisherNote(pool)}
                />
                {pool.relayer && (
                  <AddressLine
                    chainId={pool.chainId}
                    label="Relayer"
                    value={pool.relayer}
                    note={relayerUp(pool) ? "pays the gas; the proof binds recipient, fee and deadline" : relayerDownNote(pool)}
                  />
                )}
                <ScreeningSummary chainId={pool.chainId} screening={screening} className="border-t border-border/40 py-2" />
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
