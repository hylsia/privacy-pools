import { useMemo, useState, type ReactNode } from "react";
import { Link, Redirect, useParams } from "wouter";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  DoorOpen,
  Ethereum,
  ExternalLink,
  Info,
  Landmark,
  LineChart,
  RefreshCw,
  ShieldCheck,
  Users,
  type IconType,
} from "@/components/icons";
import { toast } from "sonner";
import { isAddress } from "viem";
import { trpc } from "@/lib/trpc";
import { NetworkLabel } from "@/components/brand/NetworkMark";
import { PoolMark } from "@/components/brand/PoolMark";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import PoolChart, { type ChartKind } from "@/components/pools/PoolCharts";
import { OWNER_NOTE } from "@/components/pools/PoolDetail";
import PoolsShell from "@/components/pools/PoolsShell";
import { MetricList, MetricRow as Stat } from "@/components/pools/MetricList";
import { Segmented } from "@/components/pools/TopStats";
import { age, ago, ethAmount, minFeeText, plural, relayerFeeTerms, short, signedEth } from "@/components/pools/format";
import {
  poolHref,
  PUBLISHER_WAIT_NOTE,
  publisherNote,
  publisherUp,
  relayerDownNote,
  relayerUp,
  TERMS,
  vaultHref,
  type PoolDetailResponse,
  type PoolHealth,
} from "@/components/pools/types";
import { CARD, CAUTION_BOX, FILLED, PoolStatusPill, poolStatus, QUIET_HOVER, TONE_TEXT } from "@/components/privacy/ui";
import { firstRootClause, joinsClause, nextRootChange, nextRootChangeText, publisherStateWords, ScreeningSummary, useASPStatusOf } from "@/components/privacy/Screening";
import { explorerAddressUrl, explorerTxUrl, findPool, PRIVACY_NETWORKS } from "@/privacy/config";
import { inclusionDelay } from "@/privacy/publicData";
import type { ASPScreening } from "@shared/privacy/api";
import { STANDARD_LADDER } from "@shared/privacy/guidance";
import { networkById, networkBySlug, type NetworkInfo, type PoolId } from "@shared/privacy/networks";

const DETAIL_INTERVALS = ["24h", "7d", "30d"] as const;
type DetailInterval = (typeof DETAIL_INTERVALS)[number];
const SPAN: Record<DetailInterval, number> = { "24h": 86_400, "7d": 604_800, "30d": 2_592_000 };
const PAGE = 15;

type Kind = "all" | "deposit" | "withdraw" | "ragequit";
const KINDS: { key: Kind; label: string }[] = [
  { key: "all", label: "All" },
  { key: "deposit", label: "Deposits" },
  { key: "withdraw", label: "Withdrawals" },
  { key: "ragequit", label: "Ragequits" },
];
const KIND_META = {
  deposit: { label: "Deposit", icon: ArrowDownToLine, tone: "text-[color:var(--flow-in)]" },
  withdraw: { label: "Private withdrawal", icon: ArrowUpFromLine, tone: "text-[color:var(--flow-out)]" },
  ragequit: { label: "Ragequit", icon: DoorOpen, tone: "text-muted-foreground" },
} as const;

const CHARTS: { key: ChartKind; label: string; title: string; icon: IconType }[] = [
  { key: "anonymity", label: "Anonymity set", title: "Anonymity set growth", icon: Users },
  { key: "activity", label: "Activity", title: "Deposits and withdrawals", icon: LineChart },
  { key: "balance", label: "Balance", title: "Pool balance", icon: Ethereum },
];

/** The workspace card (the Pools table and the vault use the same one, close to the landing's SURFACE.card). */
function Card({ title, icon, action, children, className = "" }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${CARD} flex min-w-0 flex-col ${className}`}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-3">
        {icon}
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <div className="ml-auto">{action}</div>
      </header>
      {children}
    </section>
  );
}

// ─── privacy health ───────────────────────────────────────────────────────────

type CheckState = "good" | "watch" | "none";
interface HealthCheck {
  label: string;
  value: string;
  state: CheckState;
  /** what is counted and why it matters, in plain words */
  detail: string;
}

/**
 * Icon and status word in readable tones. "Worth watching" is the landing's rose caution (its "linked again" /
 * "payer is visible" chips): these checks flag exactly those link risks.
 */
const STATE: Record<CheckState, { word: string; icon: IconType; tone: string; card: string }> = {
  good: { word: "Looks good", icon: CheckCircle2, tone: TONE_TEXT.profit, card: "border-border/50 bg-background/30" },
  watch: { word: "Worth watching", icon: AlertTriangle, tone: TONE_TEXT.destructive, card: CAUTION_BOX },
  none: { word: "Nothing to check yet", icon: Info, tone: "text-muted-foreground", card: "border-border/50 bg-background/30" },
};

/** A check that needs deposits or withdrawals says so on an empty pool instead of passing. */
function judge(empty: boolean, value: string, ok: boolean): Pick<HealthCheck, "value" | "state"> {
  return empty ? { value: "—", state: "none" } : { value, state: ok ? "good" : "watch" };
}

/**
 * The pool's privacy-health heuristics (server: public chain data only), each explained plainly.
 * Thresholds: 50+ deposits under the published association-set root, 70%+ standard amounts (the vault forms'
 * ladder, STANDARD_LADDER), and none of the linking patterns. On a pool with no deposits there is nothing to judge:
 * every check says so instead of flagging the empty pool.
 */
function healthChecks(p: PoolDetailResponse["pool"], h: PoolHealth, screening: ASPScreening | null): HealthCheck[] {
  const noDeposits = p.deposits === 0;
  const noWithdrawals = p.withdrawals === 0;
  const crowd = p.aspRootMembers;
  const big = crowd >= 50;
  // the publisher reports it cannot post a root now (the server's own key; an unread balance counts as able)
  const publisherDown = p.aspCanPublish === false;
  return [
    {
      label: TERMS.anonymity.label,
      value: crowd.toLocaleString("en-US"),
      state: noDeposits ? "none" : big ? "good" : "watch",
      detail: noDeposits
        ? "No deposits yet. The anonymity set starts with the first deposits and grows with every one after them."
        : big
          ? "A large crowd: a private withdrawal proved against the published association-set root could have come from any of its deposits that holds enough. Amounts and timing can still narrow it."
          : !p.aspRootPublished
            ? publisherDown
              ? "No association-set root is published yet, and the publisher cannot post one right now, so private withdrawals wait for it. Ragequit works regardless."
              : `No association-set root is published yet: ${firstRootClause(screening)}. Until then the crowd is empty. Ragequit works regardless.`
            : crowd === 0
              ? "The published association-set root holds no deposit that could be checked against the public deposits (none screened in yet, every member excluded, or a list that does not match), so no private withdrawal can be proved against it right now."
              : "A small crowd: each withdrawal proved against the published root has few possible sources. Every new deposit makes everyone harder to link.",
    },
    {
      label: "Standard amounts",
      ...judge(noDeposits, `${Math.round(h.standardAmountShare * 100)}%`, h.standardAmountShare >= 0.7),
      detail: `Deposits and withdrawals in standard amounts (${STANDARD_LADDER}), the ones the vault suggests. A standard amount that many deposits share is harder to link; odd ones stand out.`,
    },
    {
      label: "One-of-a-kind deposit amounts",
      ...judge(noDeposits, h.uniqueAmountDeposits.toLocaleString("en-US"), h.uniqueAmountDeposits === 0),
      detail: "Deposits whose exact amount no other deposit used. They are easy to pick out if that amount later leaves the pool.",
    },
    {
      label: "Exact-amount withdrawals",
      ...judge(noWithdrawals, h.exactMatchWithdrawals.toLocaleString("en-US"), h.exactMatchWithdrawals === 0),
      detail: "Withdrawals of exactly an earlier deposit's amount, which can point to that deposit. Withdraw a part and leave the change in the pool.",
    },
    {
      label: "Withdrawn to a depositing address",
      ...judge(noWithdrawals, h.recipientIsDepositor.toLocaleString("en-US"), h.recipientIsDepositor === 0),
      detail: "Withdrawals sent to an address that also deposited, which can tie the two together. A fresh address avoids that link.",
    },
    {
      label: "Paid their own gas",
      ...judge(noWithdrawals, h.selfRelayed.toLocaleString("en-US"), h.selfRelayed === 0),
      detail: "Withdrawals sent from a wallet that paid its own gas instead of using the relayer. The gas payer is visible and had to be funded from somewhere.",
    },
  ];
}

function HealthCard({ check }: { check: HealthCheck }) {
  const s = STATE[check.state];
  return (
    <li className={`flex gap-3 rounded-xl border p-4 sm:p-5 ${s.card}`}>
      <s.icon className={`mt-0.5 h-4 w-4 shrink-0 ${s.tone}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-sm font-semibold text-foreground">{check.label}</h3>
          <p className="shrink-0 font-mono text-base font-semibold text-foreground">{check.value}</p>
        </div>
        <p className={`mt-1 text-sm font-medium ${s.tone}`}>{s.word}</p>
        <p className="mt-2 max-w-3xl text-base leading-relaxed text-muted-foreground">{check.detail}</p>
      </div>
    </li>
  );
}

function AddressRow({ chainId, label, value, note }: { chainId: number; label: string; value: string; note?: string }) {
  const link = explorerAddressUrl(chainId, value);
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
      <div>
        <p className="text-muted-foreground">{label}</p>
        {/* full muted tone: these notes carry state (a relayer or publisher that cannot work right now), so they keep AA contrast */}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      {link ? (
        <a href={link} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-primary hover:underline">
          {short(value)} <ExternalLink className="h-3 w-3" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : (
        <span className="shrink-0 font-mono text-xs">{short(value)}</span>
      )}
    </div>
  );
}

/** A network in the URL: its slug ("robinhood-testnet"), or a chain id ("46630"), which redirects to the slug. */
function networkFromParam(param: string): { network: NetworkInfo | null; numeric: boolean } {
  if (/^\d+$/.test(param)) return { network: networkById(Number(param)), numeric: true };
  return { network: networkBySlug(param), numeric: false };
}

/**
 * One pool's public page: /pools/<network>/<address>. The network is part of the address of the page (the same
 * address can be a pool on several chains), of the one request it makes (poolDetail, the public page being viewed)
 * and of every explorer link. Deposit and Withdraw appear only for a pool built into this app. A pool with no deposit
 * yet says so plainly (no health warnings, no empty charts) and points at the first deposit.
 */
export default function PoolPage() {
  const params = useParams<{ network?: string; address: string }>();
  const address = params.address ?? "";
  const valid = isAddress(address);
  const { network, numeric } = networkFromParam(params.network ?? "");
  // a network this build offers; any other slug or id is not one Hylsia is built for (and is never asked about)
  const offered = !!network && PRIVACY_NETWORKS.some((n) => n.network.chainId === network.chainId);
  const [interval, setInterval] = useState<DetailInterval>("7d");
  const [chart, setChart] = useState<ChartKind>("anonymity");
  const [kind, setKind] = useState<Kind>("all");
  const [page, setPage] = useState(0);

  const input = { chainId: network?.chainId ?? 0, pool: address as `0x${string}`, interval };
  const q = trpc.privacy.poolDetail.useQuery(input, {
    enabled: valid && offered && !numeric,
    refetchInterval: 30_000,
    // a pool that does not exist, or a network the server does not serve, is an answer, not a failure
    retry: (n, err) => err.data?.code !== "NOT_FOUND" && err.data?.code !== "BAD_REQUEST" && n < 1,
    placeholderData: (prev) => prev,
  });
  const d = q.data;
  const rows = useMemo(() => (d ? d.activity.filter((a) => kind === "all" || a.kind === kind) : []), [d, kind]);
  // the pool's screening policy, from the shell's privacy.asp.status copy (input-less, every visitor's; nothing new is sent)
  const statusRef = useMemo<PoolId | null>(() => (valid && network ? { chainId: network.chainId, pool: address as `0x${string}` } : null), [valid, network, address]);
  const screening = useASPStatusOf(statusRef).screening;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Pool address copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  // /pools/46630/0x… → /pools/robinhood-testnet/0x…
  if (numeric && network) return <Redirect to={poolHref(network.chainId, address)} replace />;

  const notBuilt = !network || !offered || q.error?.data?.code === "BAD_REQUEST";
  if (!valid || notBuilt || q.error?.data?.code === "NOT_FOUND") {
    return (
      <PoolsShell>
        <div className="mx-auto max-w-xl py-16 text-center">
          <h1 className="font-display text-2xl font-semibold tracking-[-0.03em]">Pool not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {!valid
              ? "That is not a valid contract address."
              : notBuilt
                ? "That network is not one Hylsia is built for."
                : `There is no privacy pool at ${short(address)} on ${network.name}.`}
          </p>
          <Button asChild variant="outline" className={`mt-6 rounded-full ${QUIET_HOVER}`}>
            <Link href="/pools">
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> All pools
            </Link>
          </Button>
        </div>
      </PoolsShell>
    );
  }

  const chainId = network.chainId;
  // no answer at all, only an error (a NOT_FOUND or BAD_REQUEST was handled above): the pool's chain is unavailable
  const failed = q.isError && !d;
  // deposits go only to a pool built into this app, and the vault opens on its network
  const ours = findPool(chainId, address);
  const explorer = explorerAddressUrl(chainId, address);
  const p = d?.pool;
  const net = p ? p.intervalDeposits - p.intervalWithdrawals : 0n;
  const avgDeposit = p && p.deposits > 0 ? p.depositedTotal / BigInt(p.deposits) : 0n;
  const checks = p && d ? healthChecks(p, d.health, screening) : null;
  // how a deposit joins the set on this pool (screening): its status answer's delay, else the registry's
  const joins = joinsClause(inclusionDelay(screening, chainId));
  // what the next root changes, from the operator's status (joins and removals counted apart; nothing when the server
  // cannot verify the current root, so a root that does not verify is never read as "every member is new")
  const nextChange = nextRootChangeText(nextRootChange(screening));
  const good = checks?.filter((c) => c.state === "good").length ?? 0;
  const watch = checks?.filter((c) => c.state === "watch").length ?? 0;
  const chartMeta = CHARTS.find((c) => c.key === chart)!;
  // a brand-new pool: nothing to chart or judge yet, and one short pointer at the first deposit
  const empty = !!p && p.deposits === 0;
  const relayerOk = !!p && relayerUp(p);
  // the server's publisher cannot post a root right now: a deposit no published root covers waits for it
  const publisherDown = !!p && !publisherUp(p);

  return (
    <PoolsShell>
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/pools" className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            Pools
          </Link>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 text-foreground">ETH Privacy Pool · {network.name}</span>
        </nav>

        {/* header */}
        <div className={`${CARD} flex flex-col gap-4 p-5 lg:flex-row lg:items-center`}>
          <div className="flex min-w-0 items-start gap-4">
            <PoolMark size="lg" className="mt-0.5" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-semibold tracking-[-0.03em] sm:text-[1.75rem]">ETH Privacy Pool</h1>
                {p && <PoolStatusPill status={poolStatus(p)} />}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {/* the network: its mark (a static card, so the feather is never faded or moved) and its full name */}
                <NetworkLabel network={network} className="font-medium text-foreground" />
                <span className="font-mono">chain {chainId}</span>
                <span className="inline-flex items-center gap-1 font-mono">
                  {short(address, 6)}
                  <button type="button" onClick={() => void copy()} aria-label="Copy pool address" className="rounded p-0.5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <Copy className="h-3 w-3" aria-hidden />
                  </button>
                  {explorer && (
                    <a
                      href={explorer}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open in ${network.explorer?.name ?? "the explorer"} (opens in a new tab)`}
                      className="rounded p-0.5 hover:text-foreground"
                    >
                      <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  )}
                </span>
                {p && <span>age {age(p.deployedAt, d!.now)}</span>}
                <span>{network.chain.testnet === false ? "mainnet · single operator · not independently audited" : "testnet · not audited"}</span>
              </div>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Deposits and withdrawals here are public; which deposit paid for which withdrawal is not. The larger its anonymity set, the harder a
                withdrawal is to trace.
              </p>
            </div>
          </div>
          {/* only a pool built into this app: a deposit target never comes from a URL */}
          {ours && (
            <div className="flex flex-wrap gap-2 lg:ml-auto">
              {/* a closed pool gets a real disabled button: `disabled` on Button asChild would land on the link and do nothing */}
              {p?.dead ? (
                <Button disabled className={`rounded-full ${FILLED}`}>
                  <ArrowDownToLine className="mr-1.5 h-4 w-4" aria-hidden /> Deposits closed
                </Button>
              ) : (
                <Button asChild className="rounded-full">
                  <Link href={vaultHref(ours.network.slug)}>
                    <ArrowDownToLine className="mr-1.5 h-4 w-4" aria-hidden /> Deposit
                  </Link>
                </Button>
              )}
              <Button asChild variant="outline" className={`rounded-full ${QUIET_HOVER}`}>
                <Link href={vaultHref(ours.network.slug, "withdraw")}>
                  <ArrowUpFromLine className="mr-1.5 h-4 w-4" aria-hidden /> Withdraw
                </Link>
              </Button>
            </div>
          )}
        </div>

        {/* this network's pool data could not be read (its RPC, or a failed contract check): only that network is
            affected, and the page says so instead of loading forever */}
        {failed ? (
          <div className={`${CARD} px-6 py-10 text-center text-sm text-muted-foreground`} role="status">
            <p className="mx-auto max-w-md">
              Pool data for {network.name} is unavailable right now (public RPC). Figures are only ever read from public chain data.
            </p>
            <Button size="sm" variant="outline" className={`mt-4 rounded-full px-4 ${QUIET_HOVER}`} onClick={() => void q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "motion-safe:animate-spin" : ""}`} aria-hidden /> Try again
            </Button>
          </div>
        ) : (
        <>
        {/* a pool with no deposit yet: say so once, and point at the first deposit */}
        {empty && !p!.dead && (
          <p className={`${CARD} flex items-start gap-2 px-4 py-3 text-sm leading-relaxed text-muted-foreground`} role="status">
            <Info className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="font-medium text-foreground">No deposits yet.</span> Every deposit grows this pool&apos;s anonymity set, and withdrawals
              hide better once many have joined. Its charts and health checks fill in from the first deposit{ours ? ": use Deposit above to make one" : ""}.
              {publisherDown && <> {PUBLISHER_WAIT_NOTE}</>}
            </span>
          </p>
        )}

        {/* stats, led by the anonymity set */}
        <MetricList label="Pool statistics">
          {!p ? (
            Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="px-4 py-4 sm:px-5">
                <dt className="sr-only">Loading statistic {i + 1}</dt>
                <dd><Skeleton className="h-12 rounded-lg" /></dd>
              </div>
            ))
          ) : (
            <>
              <Stat
                label={TERMS.anonymity.label}
                value={p.aspRootMembers.toLocaleString("en-US")}
                sub={
                  p.deposits === 0
                    ? "no deposits yet"
                    : (nextChange ?? plural(p.uniqueDepositors, "distinct depositor address", "distinct depositor addresses"))
                }
                hint={`Deposits under the published association-set root. A private withdrawal proved against it could have been funded by any of them that holds enough value. Amounts and timing can narrow it; the withdraw form checks this before you send. Under the screening policy, ${joins} (with the next root the publisher posts), unless the operator's exclusion list names them.`}
              />
              <Stat label={TERMS.balance.label} value={ethAmount(p.tvl)} sub={`${ethAmount(p.depositedTotal)} deposited all time`} hint={TERMS.balance.hint} />
              <Stat
                label={`${TERMS.activity.label} ${interval}`}
                value={`${p.intervalCount.toLocaleString("en-US")} tx`}
                sub={`${ethAmount(p.intervalDeposits + p.intervalWithdrawals)} moved`}
                hint={TERMS.activity.hint}
              />
              <Stat label={`${TERMS.net.label} ${interval}`} value={signedEth(net)} sub="deposits minus withdrawals and ragequits" hint={TERMS.net.hint} />
              <Stat label={TERMS.withdrawals.label} value={p.withdrawals.toLocaleString("en-US")} sub={`private · ${plural(p.ragequits, "public ragequit")}`} hint={TERMS.withdrawals.hint} />
              <Stat
                label={TERMS.feesPaid.label}
                value={ethAmount(p.feesPaid)}
                sub={
                  relayerOk
                    ? `current fee ${relayerFeeTerms(p.relayerFeeBps, p.relayerMinFeeWei)}`
                    : p.relayer
                      ? "relayer temporarily unavailable"
                      : "relayer offline"
                }
                hint={TERMS.feesPaid.hint}
              />
              <Stat label="Average deposit" value={p.deposits ? ethAmount(avgDeposit) : "—"} sub={plural(p.deposits, "deposit")} />
              <Stat
                label="Commitments"
                value={p.leafCount.toLocaleString("en-US")}
                sub="deposits + change notes in the tree"
                hint="Leaves in the depth-20 state tree. Change notes are commitments too, so this exceeds the deposit count."
              />
            </>
          )}
        </MetricList>

        {/* privacy health: the pool's privacy-specific reading, in plain words */}
        <Card
          title="Privacy health"
          icon={<ShieldCheck className="h-4 w-4 text-primary" aria-hidden />}
          action={
            // an empty pool: nothing judged yet, nothing flagged (the body says so)
            checks &&
            good + watch > 0 && (
              <p className="text-xs text-muted-foreground">
                <span className={`font-medium ${TONE_TEXT.profit}`}>
                  {good} {good === 1 ? "looks" : "look"} good
                </span>
                {watch > 0 && <> · <span className={`font-medium ${TONE_TEXT.destructive}`}>{watch} worth watching</span></>}
              </p>
            )
          }
        >
          <p className="px-4 pt-4 text-sm leading-relaxed text-muted-foreground">
            How easy is it to link a withdrawal back to its deposit in this pool? These checks read public chain data only: they describe how the pool
            is used, not who used it.
          </p>
          {!checks ? (
            <div className="flex flex-col gap-3 p-4 sm:p-5">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          ) : empty ? (
            // a pool with no deposit: the checks by name, once, instead of six cards that each say the same
            <div className="p-4">
              <p className="flex items-center gap-2 text-sm text-foreground">
                <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                Nothing to check yet. These checks start with the first deposits and withdrawals:
              </p>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Checks that start with the first deposits">
                {checks.map((c) => (
                  <li key={c.label} className="rounded-full border border-border/60 bg-background/30 px-3 py-1 text-xs text-muted-foreground">
                    {c.label}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ul className="flex flex-col gap-3 p-4 sm:p-5">
              {checks.map((c) => (
                <HealthCard key={c.label} check={c} />
              ))}
            </ul>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-5">
          {/* chart */}
          <Card
            title={chartMeta.title}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Segmented label="Chart" value={chart} onChange={setChart} options={CHARTS} />
                <Segmented label="Interval" value={interval} onChange={(v) => setInterval(v)} options={DETAIL_INTERVALS.map((i) => ({ key: i, label: i }))} />
              </div>
            }
          >
            <div className="flex flex-1 flex-col px-2 pb-3 pt-4">
              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-3 text-xs text-muted-foreground">
                {chart === "activity" ? (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--flow-in)" }} aria-hidden /> Deposited (up)
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--flow-out)" }} aria-hidden /> Withdrawn, ragequits included (down)
                    </span>
                  </>
                ) : chart === "anonymity" ? (
                  <span>Deposits under the published association-set root over time: the set a private withdrawal is proved in. Under the screening policy, {joins}, unless they are excluded.</span>
                ) : (
                  <span>{TERMS.balance.hint}</span>
                )}
              </div>
              <div className={empty ? "h-44" : "h-72 sm:h-80"}>
                {!d ? (
                  <Skeleton className="h-full w-full rounded-xl" />
                ) : empty ? (
                  // no axes over nothing: the chart starts with the first deposit
                  <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 px-6 text-center">
                    <chartMeta.icon className="h-5 w-5 text-muted-foreground" aria-hidden />
                    <p className="text-sm font-medium text-foreground">No deposits yet</p>
                    <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">This chart starts with the pool&apos;s first deposit.</p>
                  </div>
                ) : (
                  <PoolChart kind={chart} points={d.series} span={SPAN[interval]} />
                )}
              </div>
            </div>
          </Card>

          {/* governance */}
          <Card title="Contract and governance" icon={<Landmark className="h-4 w-4 text-primary" aria-hidden />}>
            {!p ? (
              <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8" />)}</div>
            ) : (
              <>
                <div className="divide-y divide-border/40">
                  <AddressRow chainId={chainId} label="Pool contract" value={p.pool} note="non-upgradeable, no proxy" />
                  <AddressRow chainId={chainId} label="Owner" value={p.owner} note={OWNER_NOTE} />
                  <AddressRow
                    chainId={chainId}
                    label="Association-set publisher"
                    value={p.aspPostman}
                    note={!publisherUp(p) && p.aspPublishBlock === "policy_error" ? publisherStateWords(false, "policy_error") : publisherNote(p)}
                  />
                  {p.relayer && (
                    <AddressRow
                      chainId={chainId}
                      label="Relayer"
                      value={p.relayer}
                      note={
                        relayerOk
                          ? `${p.relayerFeeBps / 100}% fee${minFeeText(p.relayerMinFeeWei) ? ` (${minFeeText(p.relayerMinFeeWei)})` : ""}, sealed into each proof`
                          : relayerDownNote(p)
                      }
                    />
                  )}
                  <div className="flex justify-between px-4 py-2.5 text-sm">
                    <span className="text-muted-foreground">Minimum deposit</span>
                    <span className="font-mono text-xs">{p.minDeposit === 0n ? "none" : ethAmount(p.minDeposit)}</span>
                  </div>
                </div>
                <div className="border-t border-border/50 px-4 py-3">
                  <p className="text-xs font-semibold">Association-set roots</p>
                  {d!.aspUpdates.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {publisherDown
                        ? p.deposits === 0
                          ? "No root published yet, and the publisher cannot post one right now: a deposit made now waits for it before a private withdrawal; ragequit works regardless."
                          : "No root published yet, and the publisher cannot post one right now: private withdrawals wait for it; ragequit works regardless."
                        : p.deposits === 0
                          ? "No root published yet: the first one follows the first deposits."
                          : `No root published yet: ${firstRootClause(screening)}; ragequit works regardless.`}
                    </p>
                  ) : (
                    <ul className="mt-1.5 space-y-1">
                      {d!.aspUpdates.slice(0, 4).map((u) => (
                        <li key={u.txHash} className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-mono text-muted-foreground">{short(`0x${u.root.toString(16).padStart(64, "0")}`, 4)}</span>
                          <span className="text-muted-foreground">{ago(u.timestamp, d!.now)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">{plural(d!.aspUpdates.length, "update")}</p>
                  <ScreeningSummary chainId={chainId} screening={screening} className="mt-1" />
                </div>
              </>
            )}
          </Card>
        </div>

        {/* activity */}
        <Card
          title="Public activity"
          action={<Segmented label="Activity type" value={kind} onChange={(v) => { setKind(v); setPage(0); }} options={KINDS} />}
        >
          {!d ? (
            <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">No {kind === "all" ? "public activity" : KINDS.find((k) => k.key === kind)!.label.toLowerCase()} yet.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-b border-border/50 bg-muted/20">
                    <tr className="text-xs text-muted-foreground">
                      <th scope="col" className="px-4 py-2.5 text-left font-medium">Type</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Amount</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Relayer fee</th>
                      <th scope="col" className="px-3 py-2.5 text-left font-medium">Address</th>
                      <th scope="col" className="px-3 py-2.5 text-left font-medium">Via</th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">Time</th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">Tx</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {pageRows.map((a) => {
                      const m = KIND_META[a.kind];
                      const link = explorerTxUrl(chainId, a.txHash);
                      return (
                        <tr key={`${a.txHash}-${a.kind}`} className="hover:bg-accent/5">
                          <td className="whitespace-nowrap px-4 py-2.5">
                            <span className="inline-flex items-center gap-2">
                              <m.icon className={`h-4 w-4 ${m.tone}`} aria-hidden /> {m.label}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-3 text-right font-mono">{ethAmount(a.value)}</td>
                          <td className="whitespace-nowrap px-3 text-right font-mono text-muted-foreground">{a.fee > 0n ? ethAmount(a.fee) : "—"}</td>
                          <td className="whitespace-nowrap px-3 font-mono text-xs">
                            <span className="text-muted-foreground">{a.kind === "withdraw" ? "to " : "from "}</span>
                            {short(a.account)}
                          </td>
                          <td className="whitespace-nowrap px-3 text-xs text-muted-foreground">{a.kind === "withdraw" ? (a.relayer ? "relayer" : "own gas") : "—"}</td>
                          <td className="whitespace-nowrap px-3 text-right text-xs text-muted-foreground" title={new Date(a.timestamp * 1000).toLocaleString("en-US")}>
                            {ago(a.timestamp, d.now)}
                          </td>
                          <td className="whitespace-nowrap px-4 text-right">
                            {link ? (
                              <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline">
                                {short(a.txHash, 3)} <ExternalLink className="h-3 w-3" aria-hidden />
                              </a>
                            ) : (
                              <span className="font-mono text-xs">{short(a.txHash, 3)}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-border/50 px-4 py-2.5 text-xs text-muted-foreground">
                <span>
                  {plural(rows.length, "event")}
                  {d.activityTruncated && " (latest 1,000 shown)"} · the proof hides which deposit a private withdrawal spent; a ragequit reveals
                  its deposit
                </span>
                {/* shrink-0: the global `.flex { min-width: 0 }` would let the caption squeeze the pager off-screen on phones */}
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" className={`h-7 w-7 p-0 ${QUIET_HOVER}`} disabled={page === 0} onClick={() => setPage((x) => x - 1)} aria-label="Previous page">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="font-mono">
                    {page + 1}/{pages}
                  </span>
                  <Button variant="ghost" size="sm" className={`h-7 w-7 p-0 ${QUIET_HOVER}`} disabled={page >= pages - 1} onClick={() => setPage((x) => x + 1)} aria-label="Next page">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </Card>
        </>
        )}
      </div>
    </PoolsShell>
  );
}
