import { Fragment, useEffect } from "react";
import { useAccount } from "wagmi";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, KeyRound, Lock, LockOpen, RefreshCw, type IconType } from "@/components/icons";
import { NoteDiamond } from "@/components/brand/NoteDiamond";
import { PoolStatePill } from "@/components/landing/usePoolStatus";
import { NetworkSwitcher, type SwitcherOption } from "@/components/pools/NetworkMenu";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { explorerAddressUrl } from "@/privacy/config";
import { formatEth, shortHex } from "@/privacy/format";
import { usePrivacy } from "@/privacy/PrivacyProvider";
import { poolReadState } from "@/privacy/publicData";
import { networkById } from "@shared/privacy/networks";
import { InlineAction } from "./PrivacyCheck";
import { firstRootClause, useASPStatusOf } from "./Screening";
import { CARD, Figure, Pill, PoolMark, QUIET_HOVER, TONE_TEXT } from "./ui";
import { LOCK_LATER, lockOrSay } from "./VaultPanel";

/** The strip's icon buttons share the Pools toolbar's refresh button look. */
const CTRL = `h-9 w-9 rounded-lg border-border/60 bg-card/50 px-0 ${QUIET_HOVER}`;

interface Notice {
  tone: "destructive" | "warning";
  icon: IconType;
  text: string;
  /** a one-click choice next to the line (never while an operation runs) */
  action?: { label: string; run: () => void };
}

/**
 * The pool strip at the top of the vault workspace: which pool on which network (its name; a switcher only when the
 * build offers several networks), the vault and sync state, and the active pool's figures at a glance. With several
 * networks the vault acts on one at a time, and another network's notes are pointed out, never added in. Before the
 * pool is deployed it only names the network and says so.
 */
export default function PoolHeader({ className = "" }: { className?: string }) {
  const { configured, pool, pools, networks, activePool, setActivePool, busy, vault, balance, spendable, notes, sync, lock, lockPending } = usePrivacy();
  const { chainId: walletChainId } = useAccount();
  const unlocked = vault.status === "unlocked";
  const loading = pool.status === "loading";
  const ready = pool.status === "ready";
  const name = activePool?.network.name ?? "";
  const poolLink = activePool ? explorerAddressUrl(activePool.chainId, activePool.pool) : null;
  // the active pool's screening status (the shell's copy): who posts a pool's first root on this server
  const screening = useASPStatusOf(activePool).screening;

  // a failed read shows a human line; the raw message goes to the console for developers
  const readFailed = configured && pool.status === "error";
  useEffect(() => {
    if (readFailed && pool.error) console.info("[vault] pool state unavailable:", pool.error);
  }, [readFailed, pool.error]);
  // the active pool's notes are known only once its state was read: before that its figures are "…" or "—", never 0
  const activeRead = poolReadState(pool);
  const unreadFigure = activeRead === "unavailable" ? "—" : "…";

  // the other pools, with what this vault holds there (only while unlocked: nothing is known otherwise); one that could
  // not be read is named as such, never left out as if it held nothing
  const others = activePool ? pools.filter((v) => v.ref.key !== activePool.key) : [];
  const otherLines = unlocked
    ? others.flatMap((v) =>
        poolReadState(v.state) === "unavailable"
          ? [`${v.ref.network.name}: unavailable`]
          : v.balance > 0n
            ? [`+${formatEth(v.balance)} ETH on ${v.ref.network.name}`]
            : [],
      )
    : [];

  const notices: Notice[] = [];
  if (configured && activePool) {
    // the provider's own lines name the real reason (a record that does not match the contract, an RPC behind this
    // device's copy); any other failure gets the general line
    const ownLine = !!pool.error && (pool.error.startsWith("This app's pool record") || pool.error.includes("RPC is behind this device's copy"));
    if (readFailed && ownLine) notices.push({ tone: "destructive", icon: AlertTriangle, text: pool.error! });
    else if (readFailed) {
      notices.push({
        tone: "destructive",
        icon: AlertTriangle,
        text: `Pool state on ${name} could not be read right now (public RPC). Try Sync again; figures are only ever read from public chain data.`,
      });
    } else if (pool.error) notices.push({ tone: "destructive", icon: AlertTriangle, text: pool.error });
    if (pool.dead) notices.push({ tone: "destructive", icon: AlertTriangle, text: "Deposits closed (pool wound down)" });
    // the wallet's network is only read here, never followed: the vault stays on the network chosen above
    if (walletChainId !== undefined && walletChainId !== activePool.chainId) {
      const walletNetwork = networkById(walletChainId);
      const walletPool = pools.find((v) => v.ref.chainId === walletChainId);
      notices.push(
        walletNetwork
          ? {
              tone: "warning",
              icon: AlertTriangle,
              text: `Your wallet is on ${walletNetwork.name}. Deposits here ask it to switch to ${name}.`,
              action: walletPool && !busy ? { label: `Use the ${walletNetwork.name} pool`, run: () => setActivePool(walletPool.ref.key) } : undefined,
            }
          : {
              tone: "warning",
              icon: Info,
              // a wallet that does not have the network yet is asked to add it (wagmi's switch falls back to adding it)
              text: `Your wallet is on another network (chain ${walletChainId}). A deposit asks it to switch to ${name}, and to add ${name} first if it does not have it yet.`,
            },
      );
    }
    if (unlocked) {
      for (const v of others) {
        if (v.spendable.length === 0) continue;
        notices.push({
          tone: "warning",
          icon: Info,
          text: `You also have ${v.spendable.length} spendable note(s) (${formatEth(v.balance)} ETH) on ${v.ref.network.name}.`,
          action: busy ? undefined : { label: `Switch to ${v.ref.network.name}`, run: () => setActivePool(v.ref.key) },
        });
      }
    }
  }

  const options: SwitcherOption[] = networks.map((n) => {
    const read = n.pool ? poolReadState(n.pool.state) : null;
    return {
      network: n.network,
      key: n.pool?.ref.key ?? null,
      state: n.pool ? "live" : n.problem ? "unavailable" : "pending",
      // a count only for a pool that was read: an unread one has no count, and one that failed says so
      notes: unlocked && n.pool && read === "ready" ? n.pool.notes.list.length : undefined,
      unreadable: read === "unavailable",
    };
  });

  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-3 px-4 py-3 ${className}`} aria-label="Pool and vault summary">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <PoolMark />
        <h2 className="whitespace-nowrap text-base font-semibold tracking-tight">ETH Privacy Pool</h2>
        {activePool ? (
          // the network switcher: a static menu (nothing in it animates or fades), locked while an operation runs
          <NetworkSwitcher options={options} active={activePool.network} activeKey={activePool.key} onSelect={(key) => setActivePool(key)} locked={busy}>
            {/* Below 400px the address gives way (the explorer link stays as its icon), so the network's name is
                always written in full ("Robinhood Chain Testnet" never truncates). */}
            <span className={`shrink-0 whitespace-nowrap px-2 ${poolLink ? "" : "hidden min-[400px]:inline"}`}>
              {poolLink ? (
                <a
                  href={poolLink}
                  target="_blank"
                  rel="noreferrer"
                  title={activePool.pool}
                  className="inline-flex items-center gap-1 rounded hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="hidden min-[400px]:inline">{shortHex(activePool.pool, 4)}</span>
                  <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                  <span className="sr-only">(pool contract on {name} in the explorer, opens in a new tab)</span>
                </a>
              ) : (
                shortHex(activePool.pool, 4)
              )}
            </span>
          </NetworkSwitcher>
        ) : (
          // no pool on any network yet: the networks by name (a line breaks between names, never inside one), nothing to choose
          <span className="min-w-0 text-xs text-muted-foreground">
            {networks.map((n, i) => (
              <Fragment key={n.network.chainId}>
                {i > 0 && " · "}
                <span className="whitespace-nowrap">{n.network.name}</span>
              </Fragment>
            ))}
          </span>
        )}

        {configured ? (
          // The status pills and the Sync / Lock buttons travel as one unit: next to the title when there is room,
          // otherwise on their own row below it with the buttons at its right end (never alone on a row).
          <div className="flex min-w-0 flex-auto items-center gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {vault.status === "none" ? (
                <Pill icon={KeyRound}>No vault</Pill>
              ) : vault.status === "locked" ? (
                <Pill icon={Lock}>Locked</Pill>
              ) : (
                <Pill tone="profit" icon={LockOpen}>
                  Unlocked
                </Pill>
              )}
              {vault.status !== "none" &&
                (vault.backupVerified ? (
                  <Pill tone="profit" icon={CheckCircle2}>
                    Backup verified
                  </Pill>
                ) : (
                  <Pill tone="destructive" icon={AlertTriangle} title="Deposits stay disabled until the backup file is verified">
                    Backup not verified
                  </Pill>
                ))}
              {/* while the first sync runs, the "Last sync" figure says so; the pill then reports the outcome */}
              {pool.status === "error" ? (
                <Pill tone="destructive" icon={AlertTriangle}>
                  Sync failed
                </Pill>
              ) : ready && !pool.inSync ? (
                <Pill tone="destructive" icon={AlertTriangle}>
                  Out of sync
                </Pill>
              ) : ready && pool.historyVerified === false ? (
                <Pill icon={RefreshCw} title="This device started from the site's snapshot and is reading the rest of the pool's history">
                  Reading history
                </Pill>
              ) : ready ? (
                <Pill icon={CheckCircle2}>In sync</Pill>
              ) : null}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" className={CTRL} onClick={() => void sync()} disabled={loading} aria-label="Sync pool state">
                    <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${loading ? "motion-safe:animate-spin" : ""}`} aria-hidden />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Sync pool state</TooltipContent>
              </Tooltip>
              {unlocked && (
                // while an operation runs, a click asks for the lock, which happens once the operation has written its
                // outcome with the vault's key; the tooltip (and, on touch screens, a toast) says so
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      className={`${CTRL} aria-disabled:cursor-not-allowed aria-disabled:opacity-50`}
                      onClick={() => lockOrSay(lock)}
                      aria-label="Lock vault"
                      aria-disabled={lockPending || undefined}
                    >
                      <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{busy || lockPending ? LOCK_LATER : "Lock vault"}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        ) : (
          // the landing's own pill, as on every other pending page
          <PoolStatePill state="pending" />
        )}
      </div>

      {configured && (
        // gap-x-6 below xl keeps the five figures on one row from about 1280px up
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3 xl:gap-x-8">
          {/* yours: the gold note diamond (gold means "your note", as on the landing). The active network's balance;
              another network's is named beside it, never added in. */}
          <Figure
            mark={<NoteDiamond />}
            label="Private balance"
            value={unlocked ? (activeRead === "ready" ? `${formatEth(balance)} ETH` : unreadFigure) : vault.status === "locked" ? "Locked" : "—"}
            sub={otherLines.length > 0 ? otherLines.join(" · ") : undefined}
          />
          <Figure
            mark={<NoteDiamond />}
            label="Spendable notes"
            value={unlocked && activeRead === "ready" ? spendable.length : unlocked ? unreadFigure : "—"}
            sub={unlocked && activeRead === "ready" && notes.list.length > spendable.length ? `of ${notes.list.length}` : undefined}
          />
          <Figure label="Commitments" value={ready ? pool.leafCount : loading ? "…" : "—"} title="leaves in the state tree" />
          <Figure
            label="Association set"
            // a new pool: nothing to publish before the first deposit; after it, the publisher (or, on a server without a
            // periodic publisher, the operator) posts the first root once a deposit has passed screening
            value={ready ? (pool.aspRoot !== 0n ? "Published" : pool.leafCount === 0 ? "No deposits yet" : "No root yet") : loading ? "…" : "—"}
            title={
              pool.aspRoot
                ? pool.aspRoot.toString()
                : ready && pool.leafCount > 0
                  ? `No association-set root yet: ${firstRootClause(screening)}`
                  : undefined
            }
          />
          <Figure
            label="Last sync"
            value={pool.syncedAt ? new Date(pool.syncedAt).toLocaleTimeString("en-US") : loading ? "Syncing…" : "—"}
            title={pool.syncedAt ? `block ${pool.lastBlock.toString()}` : undefined}
          />
        </div>
      )}

      {notices.length > 0 && (
        <ul className="space-y-1 border-t border-border/50 pt-2.5 text-xs">
          {notices.map((n) => (
            <li key={n.text} className={`flex items-start gap-2 ${TONE_TEXT[n.tone]}`}>
              <n.icon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                {n.text}
                {n.action && (
                  <>
                    {" "}
                    <InlineAction onClick={n.action.run}>{n.action.label}</InlineAction>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
