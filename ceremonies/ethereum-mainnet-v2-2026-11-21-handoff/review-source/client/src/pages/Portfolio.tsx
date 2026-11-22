import { useMemo, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { toast } from "sonner";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  DoorOpen,
  ExternalLink,
  LineChart,
  Lock,
  LockOpen,
  RefreshCw,
  ShieldCheck,
} from "@/components/icons";
import { trpc } from "@/lib/trpc";
import { NetworkLabel } from "@/components/brand/NetworkMark";
import { NoteDiamond, NoteDiamondIcon } from "@/components/brand/NoteDiamond";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NetworkFilter } from "@/components/pools/NetworkMenu";
import PoolsShell from "@/components/pools/PoolsShell";
import { MetricList, MetricRow as Stat } from "@/components/pools/MetricList";
import { Segmented } from "@/components/pools/TopStats";
import { ethAmount, ethNumber, plural, short } from "@/components/pools/format";
import type { NetworkFilterValue } from "@/components/pools/prefs";
import { vaultHref } from "@/components/pools/types";
import { useClock } from "@/components/privacy/PrivacyCheck";
import { screeningPill, useScreeningReader } from "@/components/privacy/Screening";
import { CARD, DeploymentPending, FILLED, Pill, QUIET_HOVER, TONE_TEXT } from "@/components/privacy/ui";
import { LOCK_LATER, lockOrSay } from "@/components/privacy/VaultPanel";
import { explorerTxUrl, MULTI_NETWORK } from "@/privacy/config";
import { usePrivacy, type PoolView } from "@/privacy/PrivacyProvider";
import { activePoolActivity, POOL_ACTIVITY_SCHEDULE, poolDataUnavailable, poolReadState } from "@/privacy/publicData";
import type { PoolActivityAnswer } from "@shared/privacy/api";
import { poolKey, type NetworkInfo } from "@shared/privacy/networks";
import type { Note } from "@shared/privacy/notes";

type Range = "today" | "week" | "month" | "all";
const RANGES: { key: Range; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "all", label: "All time" },
];
const RANGE_SECONDS: Record<Range, number> = { today: 86_400, week: 604_800, month: 2_592_000, all: Number.POSITIVE_INFINITY };

/** Series colours of the private balance chart, one per network in registry order (never one total). */
const SERIES = ["var(--primary)", "var(--chart-3)", "var(--chart-4)", "var(--chart-2)"];

interface MyEvent {
  kind: "deposit" | "withdraw" | "ragequit";
  value: bigint;
  fee: bigint;
  /** that chain's block time; null until its public activity list holds the transaction */
  timestamp: number | null;
  txHash: `0x${string}`;
  recipient?: string;
  note: Note;
}

/** One network's notes and history, dated from that network's own public activity list only. */
interface NetworkNotes {
  view: PoolView;
  network: NetworkInfo;
  /** that chain's time now (its list's head time plus the time since the fetch); the device clock without a list */
  now: number;
  events: MyEvent[];
  /** when each note was created (its deposit, or the withdrawal that left it as change), keyed by commitment */
  createdAt: Map<bigint, number | null>;
}

function networkNotes(view: PoolView, answer: PoolActivityAnswer | undefined, failed: boolean, fetchedAt: number, nowMs: number): NetworkNotes {
  const { entry, now } = activePoolActivity(answer, failed, view.ref, fetchedAt, nowMs);
  // keyed by chain, kind and transaction: a list never dates another network's transaction
  const byTx = new Map((entry?.activity ?? []).map((a) => [`${view.ref.chainId}:${a.kind}:${a.txHash.toLowerCase()}`, a]));
  const find = (kind: MyEvent["kind"], hash: string) => byTx.get(`${view.ref.chainId}:${kind}:${hash.toLowerCase()}`);
  const events: MyEvent[] = [];
  const createdAt = new Map<bigint, number | null>();
  for (const n of view.notes.list) {
    if (n.hop === 0) {
      const a = find("deposit", n.txHash);
      events.push({ kind: "deposit", value: n.value, fee: 0n, timestamp: a?.timestamp ?? null, txHash: n.txHash, note: n });
      createdAt.set(n.commitment, a?.timestamp ?? null);
    } else {
      createdAt.set(n.commitment, find("withdraw", n.txHash)?.timestamp ?? null);
    }
    if (n.spentBy?.kind === "withdraw") {
      const a = find("withdraw", n.spentBy.txHash);
      if (a) events.push({ kind: "withdraw", value: a.value, fee: a.fee, timestamp: a.timestamp, txHash: n.spentBy.txHash, recipient: a.account, note: n });
    }
    if (n.spentBy?.kind === "ragequit") {
      const a = find("ragequit", n.spentBy.txHash);
      events.push({ kind: "ragequit", value: n.value, fee: 0n, timestamp: a?.timestamp ?? null, txHash: n.spentBy.txHash, note: n });
    }
  }
  events.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  return { view, network: view.ref.network, now: now ?? Math.floor(nowMs / 1000), events, createdAt };
}

// ─── locked / empty states ────────────────────────────────────────────────────

function UnlockCard() {
  const { vault, unlock } = usePrivacy();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await unlock(pw);
      setPw("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`${CARD} mx-auto max-w-md p-6 text-center`}>
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/30 bg-background/70">
        <Lock className="h-5 w-5 text-primary" aria-hidden />
      </div>
      {vault.status === "none" ? (
        <>
          <h2 className="mt-4 text-lg font-semibold">No vault on this device</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your notes and private balance are rebuilt from your vault seed and public chain data. Create a vault, or restore one from a backup file.
          </p>
          <Button asChild className="mt-5 rounded-full">
            <Link href="/pools/vault">Create or restore a vault</Link>
          </Button>
        </>
      ) : (
        <form onSubmit={submit} className="mt-4 space-y-3 text-left">
          <h2 className="text-center text-lg font-semibold">Unlock your vault</h2>
          <p className="text-center text-sm text-muted-foreground">Notes are decrypted in this tab only. Nothing secret is sent anywhere.</p>
          <div className="space-y-1">
            <Label htmlFor="pf-pw">Vault password</Label>
            <Input id="pf-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
          </div>
          <Button type="submit" className={`w-full rounded-full ${FILLED}`} disabled={busy}>
            <LockOpen className="mr-1.5 h-4 w-4" aria-hidden /> {busy ? "Unlocking…" : "Unlock"}
          </Button>
        </form>
      )}
    </div>
  );
}

// ─── pieces ───────────────────────────────────────────────────────────────────

/**
 * One network's six figures, never added to another network's: each pool is separate. With one network (the normal
 * build) the block carries no network heading: there is nothing to tell apart.
 */
function NetworkSummary({ data, range }: { data: NetworkNotes; range: Range }) {
  const { view, network, now, events } = data;
  // the figures come from this pool's notes, known only once it was read: "…" while it is read, "—" if it cannot be
  const read = poolReadState(view.state);
  const known = <T,>(v: T): T | string => (read === "ready" ? v : read === "loading" ? "…" : "—");
  const inRange = events.filter((e) => range === "all" || (e.timestamp !== null && now - e.timestamp <= RANGE_SECONDS[range]));
  const deposited = inRange.filter((e) => e.kind === "deposit").reduce((s, e) => s + e.value, 0n);
  const withdrawn = inRange.filter((e) => e.kind !== "deposit").reduce((s, e) => s + e.value, 0n);
  const fees = inRange.reduce((s, e) => s + e.fee, 0n);
  const received = inRange.filter((e) => e.kind === "withdraw").reduce((s, e) => s + e.value - e.fee, 0n);
  return (
    <div>
      {/* a static block: the network's mark (the feather at 20px, never faded) and its full name (several networks only) */}
      {MULTI_NETWORK && (
        <h3 className="mb-2 text-sm font-medium text-foreground">
          <NetworkLabel network={network} />
        </h3>
      )}
      {read === "unavailable" && (
        <p className="mb-2 text-xs text-muted-foreground">
          {poolDataUnavailable(network.name)} Figures are only ever read from public chain data.
        </p>
      )}
      <MetricList label={MULTI_NETWORK ? `Your figures on ${network.name}` : "Your vault figures"}>
        <Stat note label="Private balance" value={known(ethAmount(view.balance))} sub={MULTI_NETWORK ? `spendable now on ${network.shortName}` : "spendable now"} />
        <Stat
          note
          label="Open notes"
          value={known(view.spendable.length)}
          sub={read === "ready" ? `${plural(view.notes.list.length, "note")} in total` : undefined}
        />
        <Stat label="Deposited" value={known(ethAmount(deposited))} sub={RANGES.find((r) => r.key === range)!.label} />
        <Stat
          label="Withdrawn"
          value={known(ethAmount(withdrawn))}
          sub={read === "ready" ? `incl. ragequits · ${ethAmount(received)} reached recipients` : "incl. ragequits"}
        />
        <Stat label="Relayer fees paid" value={known(ethAmount(fees))} sub="taken from your withdrawals" />
        <Stat label="Ragequits" value={known(inRange.filter((e) => e.kind === "ragequit").length)} sub="public, linked to the deposit" />
      </MetricList>
    </div>
  );
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayKey(ts: number) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Each day's deposits and withdrawals on one network, marked by direction (icon and flow colour) rather than a sign. */
function ActivityCalendar({ events, network }: { events: MyEvent[]; network: NetworkInfo }) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const byDay = useMemo(() => {
    const m = new Map<string, { in: bigint; out: bigint; n: number }>();
    for (const e of events) {
      if (e.timestamp === null) continue;
      const k = dayKey(e.timestamp);
      const v = m.get(k) ?? { in: 0n, out: 0n, n: 0 };
      if (e.kind === "deposit") v.in += e.value;
      else v.out += e.value;
      v.n++;
      m.set(k, v);
    }
    return m;
  }, [events]);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  let monthIn = 0n;
  let monthOut = 0n;
  let monthN = 0;
  for (let d = 1; d <= days; d++) {
    const v = byDay.get(`${year}-${month}-${d}`);
    if (v) {
      monthIn += v.in;
      monthOut += v.out;
      monthN += v.n;
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className={`h-8 w-8 p-0 ${QUIET_HOVER}`} aria-label="Previous month" onClick={() => setCursor(new Date(year, month - 1, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <p className="min-w-28 text-center text-sm font-semibold">{cursor.toLocaleDateString("en-US", { month: "short", year: "numeric" })}</p>
          <Button variant="ghost" size="sm" className={`h-8 w-8 p-0 ${QUIET_HOVER}`} aria-label="Next month" onClick={() => setCursor(new Date(year, month + 1, 1))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          Month total{MULTI_NETWORK ? ` on ${network.name}` : ""} · {monthN} tx · {ethAmount(monthIn)} deposited · {ethAmount(monthOut)} withdrawn or
          ragequit
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] table-fixed border-separate border-spacing-1 text-xs">
          <caption className="sr-only">Your activity on {network.name}</caption>
          <thead>
            <tr>
              <th scope="col" className="w-16 text-left font-mono text-xs font-semibold uppercase text-muted-foreground" />
              {WEEKDAYS.map((d) => (
                <th key={d} scope="col" className="font-mono text-xs font-semibold uppercase text-muted-foreground">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, wi) => (
              <tr key={wi}>
                <th scope="row" className="text-left font-mono text-xs font-normal text-muted-foreground">
                  Week {wi + 1}
                </th>
                {week.map((d, di) => {
                  if (d === null) return <td key={di} className="h-16 rounded-lg" />;
                  const v = byDay.get(`${year}-${month}-${d}`);
                  const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
                  return (
                    <td
                      key={di}
                      className={`h-16 rounded-lg border align-top ${v ? "border-primary/30 bg-accent/10" : "border-border/40 bg-card/30"} ${isToday ? "ring-1 ring-primary" : ""}`}
                    >
                      <div className="flex h-full flex-col p-1.5">
                        <span className="font-mono text-xs text-muted-foreground">{d}</span>
                        {v && (
                          <div className="mt-auto space-y-0.5 font-mono text-xs leading-tight">
                            {v.in > 0n && (
                              <p className="flex items-center gap-1 text-foreground">
                                <ArrowDownToLine className="h-3 w-3 shrink-0 text-[color:var(--flow-in)]" aria-hidden />
                                <span className="sr-only">deposited </span>
                                {ethNumber(v.in).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                              </p>
                            )}
                            {v.out > 0n && (
                              <p className="flex items-center gap-1 text-foreground">
                                <ArrowUpFromLine className="h-3 w-3 shrink-0 text-[color:var(--flow-out)]" aria-hidden />
                                <span className="sr-only">withdrawn </span>
                                {ethNumber(v.out).toLocaleString("en-US", { maximumFractionDigits: 3 })}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <ArrowDownToLine className="h-3 w-3 text-[color:var(--flow-in)]" aria-hidden /> deposited (ETH)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ArrowUpFromLine className="h-3 w-3 text-[color:var(--flow-out)]" aria-hidden /> withdrawn or ragequit (ETH)
        </span>
      </p>
    </div>
  );
}

/**
 * Your private balance over time, one series per network (deposits add, withdrawals and ragequits subtract), in ETH.
 * The series are drawn side by side and never added up: each network's pool is separate.
 */
function BalanceHistory({ networks }: { networks: NetworkNotes[] }) {
  const series = networks.filter((n) => n.events.some((e) => e.timestamp !== null));
  const data = useMemo(() => {
    // every timed event of every network, each moving only its own network's balance
    const steps = series.flatMap((n, i) =>
      n.events.filter((e) => e.timestamp !== null).map((e) => ({ t: e.timestamp!, i, delta: e.kind === "deposit" ? e.value : -e.value })),
    );
    steps.sort((a, b) => a.t - b.t);
    const bal = series.map(() => 0n);
    const pts: { t: number; raw: bigint[]; [k: `v${number}`]: number }[] = [];
    for (const s of steps) {
      bal[s.i] += s.delta;
      const point = { t: s.t, raw: [...bal] } as (typeof pts)[number];
      bal.forEach((b, i) => (point[`v${i}`] = ethNumber(b)));
      pts.push(point);
    }
    if (pts.length) {
      const last = pts[pts.length - 1];
      const end = Math.max(...series.map((n) => n.now), last.t + 1);
      pts.push({ ...last, t: end });
    }
    return pts;
  }, [series]);
  if (data.length === 0) return <p className="py-16 text-center text-sm text-muted-foreground">No history yet.</p>;
  const tip = (p: TooltipProps<number, string>) => {
    const d = p.payload?.[0]?.payload as (typeof data)[number] | undefined;
    if (!p.active || !d) return null;
    return (
      <div className="rounded-xl border border-border/70 bg-popover px-3 py-2 text-xs shadow-xl">
        <p className="font-mono text-xs text-muted-foreground">{new Date(d.t * 1000).toLocaleString("en-US")}</p>
        {series.map((n, i) => (
          <p key={n.network.chainId} className="font-mono text-foreground">
            {ethAmount(d.raw[i])} private balance{MULTI_NETWORK ? ` on ${n.network.shortName}` : ""}
          </p>
        ))}
      </div>
    );
  };
  const axis = { fontSize: 12, fill: "var(--muted-foreground)" };
  return (
    <div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              {series.map((n, i) => (
                <linearGradient key={n.network.chainId} id={`pf-area-${i}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={SERIES[i % SERIES.length]} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={SERIES[i % SERIES.length]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} strokeDasharray="2 4" />
            <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={48} tickFormatter={(t: number) => new Date(t * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })} />
            <YAxis tick={axis} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 3 })} />
            <Tooltip content={tip} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} />
            {series.map((n, i) => (
              <Area
                key={n.network.chainId}
                type="stepAfter"
                dataKey={`v${i}`}
                name={n.network.name}
                stroke={SERIES[i % SERIES.length]}
                strokeWidth={2}
                fill={`url(#pf-area-${i})`}
                isAnimationActive={false}
                activeDot={{ r: 4, stroke: "var(--background)", strokeWidth: 2, fill: SERIES[i % SERIES.length] }}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {/* with several networks the legend names each in words (no network logo inside the chart); one needs no legend */}
      {MULTI_NETWORK && (
        <p className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
          {series.map((n, i) => (
            <span key={n.network.chainId} className="inline-flex items-center gap-1.5">
              <span className="h-2 w-3 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} aria-hidden /> {n.network.name}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Portfolio() {
  // every registry pool, registry order (Robinhood Chain Testnet first)
  const { configured, vault, sync, lock, lockPending, busy, pools: views } = usePrivacy();
  const [range, setRange] = useState<Range>("all");
  const [view, setView] = useState<"calendar" | "history">("calendar");
  const [tab, setTab] = useState<"open" | "spent">("open");
  // which networks this page shows: in memory only (never stored), "all" on every visit
  const [network, setNetwork] = useState<NetworkFilterValue>("all");
  const [calendarNet, setCalendarNet] = useState<number | null>(null);
  const unlocked = vault.status === "unlocked";
  // The public activity list, on the vault's schedule and for every visitor, whether the vault is locked or not: the
  // request's cadence says nothing about the vault. Each network's history is dated from its own entry only.
  const activityQ = trpc.privacy.poolActivity.useQuery(undefined, { ...POOL_ACTIVITY_SCHEDULE, enabled: configured });
  const answer = activityQ.data;
  const tick = useClock(30_000);

  const all = useMemo(
    () => views.map((v) => networkNotes(v, answer, activityQ.isError, activityQ.dataUpdatedAt, tick)),
    [views, answer, activityQ.isError, activityQ.dataUpdatedAt, tick],
  );
  const shown = all.filter((n) => network === "all" || n.network.chainId === network);
  // the calendar shows one network at a time: each day's sums stay on their own network
  const withEvents = shown.filter((n) => n.events.length > 0);
  const calendar = withEvents.find((n) => n.network.chainId === calendarNet) ?? withEvents[0] ?? shown[0] ?? null;
  const loading = views.some((v) => v.state.status === "loading");
  const noteRows = shown.flatMap((n) =>
    (tab === "open" ? n.view.spendable : n.view.notes.list.filter((x) => x.spent || x.value === 0n)).map((note) => ({ net: n, note })),
  );
  const openCount = shown.reduce((s, n) => s + n.view.spendable.length, 0);
  const spentCount = shown.reduce((s, n) => s + n.view.notes.list.length - n.view.spendable.length, 0);
  // Withdraw opens the vault on the network shown, or on the one network that holds spendable notes
  const withSpendable = shown.filter((n) => n.view.spendable.length > 0);
  const withdrawNet = shown.length === 1 ? shown[0].network : withSpendable.length === 1 ? withSpendable[0].network : null;
  // where each open note's deposit stands under the screening policy, worked out on this device per network (each
  // from its own pool's events, status entry and activity list; nothing is sent)
  const screeningOf = useScreeningReader();

  return (
    <PoolsShell>
      <div className="mx-auto w-full max-w-7xl space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2.5 font-display text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
              <NoteDiamondIcon className="h-6 w-6" /> My notes
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {MULTI_NETWORK
                ? "Your notes, private balance and history on each network, rebuilt on this device from your vault seed and public chain data. Each network's pool is separate: a note is withdrawn on the network it was deposited on. "
                : "Your notes, private balance and history, rebuilt on this device from your vault seed and public chain data. "}
              The seed is what ties your deposits to your withdrawals, and it is never sent to a server. Ragequits are public, though, and amounts, timing
              and addresses can still give a link away.
            </p>
          </div>
          {unlocked && (
            <div className="flex flex-wrap gap-2">
              <NetworkFilter
                value={network}
                onChange={setNetwork}
                networks={views.map((v) => v.ref.network)}
                className={`h-8 rounded-full border-border/60 bg-card/50 px-3 text-[13px] font-medium ${QUIET_HOVER}`}
              />
              <Button variant="outline" size="sm" className={`rounded-full ${QUIET_HOVER}`} onClick={() => void sync()} disabled={loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "motion-safe:animate-spin" : ""}`} aria-hidden /> Sync
              </Button>
              {/* while an operation runs, the lock happens once it has written its outcome with the vault's key */}
              <Button
                variant="ghost"
                size="sm"
                className={`rounded-full ${QUIET_HOVER}`}
                onClick={() => lockOrSay(lock)}
                disabled={lockPending}
                title={busy || lockPending ? LOCK_LATER : undefined}
              >
                <Lock className="mr-1.5 h-3.5 w-3.5" aria-hidden /> {lockPending ? "Locks when the operation ends" : "Lock"}
              </Button>
            </div>
          )}
        </div>

        {!configured ? (
          <section className={CARD} aria-labelledby="notes-pending-title">
            <DeploymentPending titleId="notes-pending-title" note="Your notes, private balance and history appear here once you deposit into a deployed pool." />
          </section>
        ) : !unlocked ? (
          <UnlockCard />
        ) : (
          <>
            <section className={`${CARD} p-4`}>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-semibold">Summary</h2>
                <Badge variant="outline" className="rounded-full font-mono text-xs font-normal">computed on this device</Badge>
                <div className="ml-auto">
                  <Segmented label="Range" value={range} onChange={setRange} options={RANGES} />
                </div>
              </div>
              {/* one block per network: private balances and figures are never added across networks */}
              <div className="space-y-4">
                {shown.map((n) => (
                  <NetworkSummary key={n.view.ref.key} data={n} range={range} />
                ))}
              </div>
            </section>

            <section className={`${CARD} p-4`}>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <Segmented
                  label="View"
                  value={view}
                  onChange={setView}
                  options={[
                    { key: "calendar" as const, label: "Activity calendar" },
                    { key: "history" as const, label: "Private balance" },
                  ]}
                />
                {view === "calendar" && withEvents.length > 1 && calendar && (
                  <Segmented
                    label="Calendar network"
                    value={String(calendar.network.chainId)}
                    onChange={(v) => setCalendarNet(Number(v))}
                    options={withEvents.map((n) => ({ key: String(n.network.chainId), label: n.network.shortName }))}
                  />
                )}
                {view === "calendar" ? (
                  <CalendarDays className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden />
                ) : (
                  <LineChart className="ml-auto h-4 w-4 text-muted-foreground" aria-hidden />
                )}
              </div>
              {view === "calendar" ? (
                calendar ? (
                  <ActivityCalendar key={calendar.network.chainId} events={calendar.events} network={calendar.network} />
                ) : (
                  <p className="py-16 text-center text-sm text-muted-foreground">No history yet.</p>
                )
              ) : (
                <BalanceHistory networks={shown} />
              )}
            </section>

            <section className={CARD}>
              <header className="flex flex-wrap items-center gap-3 border-b border-border/50 px-4 py-3">
                <Segmented
                  label="Notes"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { key: "open" as const, label: `Open notes (${openCount})` },
                    { key: "spent" as const, label: `Spent notes (${spentCount})` },
                  ]}
                />
                <Button asChild size="sm" className="ml-auto rounded-full">
                  <Link href={vaultHref(withdrawNet?.slug ?? null, "withdraw")}>
                    <ArrowUpFromLine className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Withdraw
                    {withdrawNet && <span className="sr-only"> on {withdrawNet.name}</span>}
                  </Link>
                </Button>
              </header>
              {noteRows.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {tab === "open" ? "No open notes. Deposit to create one." : "No spent notes yet."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className={`w-full text-sm ${MULTI_NETWORK ? "min-w-[760px]" : "min-w-[660px]"}`}>
                    <thead className="border-b border-border/50 bg-muted/20">
                      <tr className="text-xs text-muted-foreground">
                        <th scope="col" className="px-4 py-2.5 text-left font-medium">Note</th>
                        {MULTI_NETWORK && <th scope="col" className="px-3 py-2.5 text-left font-medium">Network</th>}
                        <th scope="col" className="px-3 py-2.5 text-left font-medium">Origin</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-medium">Value</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-medium">Created</th>
                        <th scope="col" className="px-3 py-2.5 text-left font-medium">Status</th>
                        <th scope="col" className="px-4 py-2.5 text-right font-medium">Tx</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40">
                      {noteRows.map(({ net, note: n }) => {
                        const chainId = net.view.ref.chainId;
                        const ts = net.createdAt.get(n.commitment) ?? null;
                        const link = explorerTxUrl(chainId, n.txHash);
                        const spentLink = n.spentBy ? explorerTxUrl(chainId, n.spentBy.txHash) : null;
                        return (
                          <tr key={`${poolKey(chainId, net.view.ref.pool)}:${n.depositIndex}.${n.hop}`} className="hover:bg-accent/5">
                            <td className="px-4 py-2.5 font-mono text-xs">
                              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                <NoteDiamond />#{n.depositIndex}.{n.hop}
                              </span>
                            </td>
                            {MULTI_NETWORK && (
                              <td className="whitespace-nowrap px-3 text-xs text-muted-foreground">
                                <NetworkLabel network={net.network} short />
                              </td>
                            )}
                            <td className="px-3 text-xs">
                              {n.hop === 0 ? (
                                <span className="inline-flex items-center gap-1.5"><ArrowDownToLine className="h-3.5 w-3.5 text-[color:var(--flow-in)]" aria-hidden /> Deposit</span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden /> Change note</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-3 text-right font-mono">{ethAmount(n.value)}</td>
                            <td className="whitespace-nowrap px-3 text-right text-xs text-muted-foreground">{ts ? new Date(ts * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                            <td className="px-3 text-xs">
                              {!n.spent ? (
                                n.value === 0n ? (
                                  <span className="text-muted-foreground">empty change note</span>
                                ) : (
                                  (() => {
                                    const pill = screeningPill(screeningOf(net.view.ref, net.view.state, n.label), net.network.name);
                                    return pill ? (
                                      <span title={pill.title}>
                                        <Pill small tone={pill.tone}>
                                          {pill.label}
                                        </Pill>
                                        <span className="sr-only">{pill.title}</span>
                                      </span>
                                    ) : (
                                      <Badge className={`rounded-full bg-profit/15 ${TONE_TEXT.profit} hover:bg-profit/15`}>spendable</Badge>
                                    );
                                  })()
                                )
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                  {n.spentBy?.kind === "ragequit" ? <DoorOpen className="h-3.5 w-3.5" aria-hidden /> : <ArrowUpFromLine className="h-3.5 w-3.5" aria-hidden />}
                                  {n.spentBy?.kind === "ragequit" ? "ragequit" : "withdrawn"}
                                  {spentLink && (
                                    <a href={spentLink} target="_blank" rel="noreferrer" className="text-primary hover:underline" aria-label={`Spending transaction on ${net.network.name}`}>
                                      <ExternalLink className="h-3 w-3" aria-hidden />
                                    </a>
                                  )}
                                </span>
                              )}
                            </td>
                            <td className="px-4 text-right">
                              {link ? (
                                <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline">
                                  {short(n.txHash, 3)} <ExternalLink className="h-3 w-3" aria-hidden />
                                </a>
                              ) : (
                                <span className="font-mono text-xs">{short(n.txHash, 3)}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="border-t border-border/50 px-4 py-2.5 text-xs text-muted-foreground">
                Your vault seed, or its backup file and your vault password, is what shows which notes are yours. Others see the same public deposits
                and withdrawals; a ragequit, or a telling amount, time or address, can still link them.
              </p>
            </section>
          </>
        )}
      </div>
    </PoolsShell>
  );
}
