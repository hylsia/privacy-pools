/**
 * The vault's privacy guidance (shared/privacy/guidance.ts), as the whitepaper asks: "Hylsia's interface will
 * recommend standard amounts and waiting periods", and for small anonymity sets "standard amounts, interface
 * warnings, pool-size shown before each action".
 *   - Deposit: the pool size, the standard amounts (with how many other deposits used each), and a caution for an
 *     amount few deposits share.
 *   - Withdraw: the privacy check right before the submit button.
 *
 * Everything is worked out on this device from public data it already holds or that every visitor fetches alike:
 * the pool's events (PrivacyProvider), the public pool summary the dashboard fetches for every visitor
 * (privacy.pools), and the public activity list (block times), which the vault page fetches for every visitor when
 * it opens and then once a minute, whatever the tab, the notes or the input. The panels only read those copies, so
 * no request depends on the note, the amount, the recipient or the timing. Both copies are used only when they
 * name the vault's active pool: its chain AND its address (client/src/privacy/publicData.ts), so switching the
 * network re-selects from the copies and sends nothing, and no figure ever comes from the other network's pool.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { AlertTriangle, CheckCircle2, Link2, ShieldCheck, Users } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { MULTI_NETWORK, type PoolRef } from "@/privacy/config";
import { usePrivacy } from "@/privacy/PrivacyProvider";
import {
  activePoolActivity,
  activePoolServices,
  activePoolSize,
  POOL_ACTIVITY_SCHEDULE,
  type PoolServicesState,
  type PoolSizeState,
} from "@/privacy/publicData";
import type { AssociationSetPreview } from "@shared/privacy/associationSet";
import {
  activityStatus,
  eth,
  formatAge,
  poolDeposits,
  waitLine,
  withdrawCheck,
  type ReasonTopic,
  type StandardAmount,
  type WithdrawCheck,
} from "@shared/privacy/guidance";
import type { Note } from "@shared/privacy/notes";
import { formatDelay } from "@shared/privacy/screening";
import type { SimVerdict } from "@shared/privacy/simulate";
import type { DepositedEvent } from "@shared/privacy/types";
import { CAUTION_BOX, INSET, TONE_TEXT } from "./ui";

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// ─── public data on this device ───────────────────────────────────────────────

export type { PoolServicesState, PoolSizeState };

/** The vault's active pool, the provider's choice (kept in memory only): every figure of the forms is this pool's. */
export function useActivePool(): PoolRef | null {
  return usePrivacy().activePool;
}

/** The vault page fetches the public activity list (call once, at the page level, for every visitor). */
export function useVaultPoolActivity(): void {
  trpc.privacy.poolActivity.useQuery(undefined, POOL_ACTIVITY_SCHEDULE);
}

/**
 * The active pool's entry of the public activity list the vault page fetched (same chain AND address), with that
 * chain's time now. Never starts a request itself.
 */
function useActivePoolActivity(ref: PoolRef | null, nowMs: number) {
  const q = trpc.privacy.poolActivity.useQuery(undefined, { enabled: false });
  return { ...activePoolActivity(q.data, q.isError, ref, q.dataUpdatedAt, nowMs), failed: q.isError };
}

/**
 * The pool size before a deposit: the active pool's row of the public pool summary that the dashboard already
 * fetches for every visitor (privacy.pools, the same request for everyone). Never another network's figure, never a
 * sum. Never starts a request itself, and builds no association-set tree on this device.
 */
export function usePoolSize(): PoolSizeState {
  const ref = useActivePool();
  const q = trpc.privacy.pools.useQuery({ interval: "24h" }, { enabled: false });
  return activePoolSize(q.data, q.isError, ref);
}

/**
 * The server's relayer and publisher on the active pool (can they send a withdrawal / post a root now), from the same
 * public pool summary. Never starts a request itself; the server checks its own keys, nothing about the visitor.
 */
export function usePoolServices(): PoolServicesState {
  const ref = useActivePool();
  const q = trpc.privacy.pools.useQuery({ interval: "24h" }, { enabled: false });
  return activePoolServices(q.data, q.isError, ref);
}

/**
 * This vault's deposits as an observer would group them: the active pool's labels, and the addresses that made this
 * vault's deposits on every network (an address is the same on both chains, so a deposit on the other network links
 * just as well).
 */
export function useOwnDeposits(): { labels: ReadonlySet<bigint>; addresses: ReadonlySet<string>;
} {
  const { pool, notes, ownDepositors } = usePrivacy();
  const labels = useMemo(() => new Set(notes.list.map(n => n.label)), [notes.list]);
  const addresses = useMemo(() => {
    const set = new Set<string>(ownDepositors);
    for (const e of pool.events) if (e.kind === "deposit" && labels.has(e.label)) set.add(e.depositor.toLowerCase());
    return set;
  }, [pool.events, labels, ownDepositors]);
  return useMemo(() => ({ labels, addresses }), [labels, addresses]);
}

/** useOwnDeposits plus the connected wallet: its deposits are yours too, so they are no cover (both forms count them so). */
export function useOwnAndWallet(): { labels: ReadonlySet<bigint>; addresses: ReadonlySet<string>;
} {
  const own = useOwnDeposits();
  const { address } = useAccount();
  return useMemo(() => {
    if (!address) return own;
    const addresses = new Set(own.addresses);
    addresses.add(address.toLowerCase());
    return { labels: own.labels, addresses };
  }, [own, address]);
}

/** The device clock, ticking every `ms` (only ever added to a chain's own time since a fetch). */
export function useClock(ms: number): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setT(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return t;
}

// ─── shared pieces ────────────────────────────────────────────────────────────

/** A rose caution, as on the website ("linked again", "payer is visible"). */
export function Caution({ children }: { children: ReactNode }) {
  return (
    <p className={`flex gap-2 rounded-lg border p-3 text-xs leading-relaxed text-foreground ${CAUTION_BOX}`}>
      <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${TONE_TEXT.destructive}`} aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** A softer note than Caution: something to plan for, not a link risk right now. */
export function SoftNote({ children }: { children: ReactNode }) {
  return (
    <p className={`${INSET} flex gap-2 p-3 text-xs leading-relaxed text-foreground`}>
      <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${TONE_TEXT.warning}`} aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** A small text button inside a line of copy ("Use 0.5 ETH"). Never a bg-primary class on a <button> (index.css). */
export function InlineAction({ onClick, children }: { onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="whitespace-nowrap rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {children}
    </button>
  );
}

/** "Use 0.5 ETH", at full precision */
export const UseAmount = ({ wei, onUse }: { wei: bigint; onUse: (wei: bigint) => void;
}) => (
  <InlineAction onClick={() => onUse(wei)}>Use {eth(wei)} ETH</InlineAction>
);

// ─── deposit ──────────────────────────────────────────────────────────────────

/** "used by 12 others" ("used by" is read out, and shown from a 22rem-wide panel up, so phones keep one line) */
const Others = ({ n }: { n: number }) =>
  n === 0 ? (
    <>no others yet</>
  ) : (
    <>
      <span className="sr-only @min-[22rem]:not-sr-only">used by </span>
      {n.toLocaleString("en-US")} {n === 1 ? "other" : "others"}
    </>
  );

/**
 * The ladder of standard amounts as chips that fill the amount field, each with how many other people's deposits
 * used it (and yours apart). The counts wait for the pool state, so they never read "no others yet" while it loads.
 */
export function StandardAmountChips({
  amounts,
  value,
  onPick,
  disabled = false,
  ready,
}: {
  amounts: StandardAmount[];
  value: bigint | null;
  onPick: (wei: bigint) => void;
  disabled?: boolean;
  /** the pool state is synced: the counts are known */
  ready: boolean;
}) {
  const id = useId();
  if (amounts.length === 0) return null;
  return (
    <div>
      <p id={id} className="mb-1.5 text-[13px] font-medium text-muted-foreground">
        Standard amounts
      </p>
      <div role="group" aria-labelledby={id} aria-busy={!ready} className="flex flex-wrap gap-2">
        {amounts.map(a => {
          const on = value === a.value;
          return (
            <button
              key={a.value.toString()}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onPick(a.value)}
              className={`flex min-w-0 flex-1 basis-28 flex-col items-center rounded-lg border px-3 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-60 ${
                on
                  ? "border-primary/60 bg-muted/70"
                  : "border-border/60 bg-background/50 hover:bg-muted/40"
              }`}
            >
              <span className="font-mono text-[13px] font-semibold leading-5 text-foreground">{eth(a.value)} ETH</span>
              {ready ? (
                <>
                  <span className="text-xs leading-4 text-muted-foreground">
                    <Others n={a.count} />
                  </span>
                  {a.own > 0 && (
                    <span className="text-xs leading-4 text-muted-foreground">+{a.own.toLocaleString("en-US")} yours</span>
                  )}
                </>
              ) : (
                <>
                  <Skeleton className="mt-0.5 h-3 w-16" aria-hidden />
                  <span className="sr-only">checking</span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** How a deposit joins the set under the screening policy, in a clause: "about 1 hour after it is made" / "once it is confirmed". */
const joinWords = (delaySeconds: number | null) =>
  delaySeconds !== null && delaySeconds > 0 ? `about ${formatDelay(delaySeconds)} after it is made` : "once it is confirmed";

/**
 * "Pool size shown before each action": the anonymity set (as the dashboard names it) and every deposit, of the
 * active network's pool only. `delaySeconds`: the pool's inclusion delay (screening), null when unknown.
 */
export function PoolSizeNote({
  size,
  networkName,
  delaySeconds = null,
}: {
  size: PoolSizeState;
  /** the active pool's network */
  networkName: string;
  delaySeconds?: number | null;
}) {
  const figure = (ready: (s: Extract<PoolSizeState, { status: "ready" }>) => string) =>
    size.status === "ready" ? (
      <dd className="font-mono text-[15px] font-semibold leading-6 text-foreground">{ready(size)}</dd>
    ) : size.status === "loading" ? (
      <dd className="text-[13px] leading-6 text-muted-foreground">Checking…</dd>
    ) : (
      <dd className="font-mono text-[15px] font-semibold leading-6 text-muted-foreground">
        —<span className="sr-only">not available</span>
      </dd>
    );
  return (
    <div className={`${INSET} px-3 py-2.5`} aria-busy={size.status === "loading"}>
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
        <Users className="h-3.5 w-3.5 text-primary" aria-hidden />
        Pool size
      </p>
      <dl className="mt-2 flex flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <dt className="text-xs text-muted-foreground">Anonymity set</dt>
          {/* an empty pool has no crowd at all (0), not just no root */}
          {figure(s =>
            s.rootPublished ? s.published.toLocaleString("en-US") : s.all === 0 ? "0" : "No root yet"
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <dt className="text-xs text-muted-foreground">All deposits</dt>
          {figure(s => s.all.toLocaleString("en-US"))}
        </div>
      </dl>
      {size.status === "unavailable" ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground" role="status">
          Pool size on {networkName} is unavailable right now.
        </p>
      ) : size.status === "ready" && size.all === 0 ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          No deposits yet: yours would start the anonymity set. A withdrawal soon after it would be easy to link, so plan to wait for others.
        </p>
      ) : MULTI_NETWORK ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          A private withdrawal hides among the deposits under the published association-set root of this network&apos;s pool. On {networkName} a
          deposit joins it {joinWords(delaySeconds)}, with the next root, unless the screening policy excludes it.
        </p>
      ) : (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          A private withdrawal hides among the deposits under the pool&apos;s published association-set root. A deposit joins it{" "}
          {joinWords(delaySeconds)}, with the next root, unless the screening policy excludes it.
        </p>
      )}
    </div>
  );
}

// ─── withdraw: the privacy check ──────────────────────────────────────────────

export interface CheckState {
  /** null until a valid amount is entered (or while the note is not in an association set) */
  check: WithdrawCheck | null;
  /** other people's deposits since the note's deposit */
  since: number | null;
  /** seconds since the note's deposit; null without public times */
  elapsed: number | null;
  /**
   * the public block times: this pool's list holding the note's deposit ("ready"); not here yet, or older than the
   * deposit ("loading"); failed, or not this pool's list ("unavailable"). Only "ready" dates the check.
   */
  times: "ready" | "loading" | "unavailable";
}

/**
 * The privacy check for one note and amount, from this device's copy of the public data. The association set is a
 * set of positions, not a prefix: under the screening policy an excluded deposit is no cover and a later member is.
 */
export function useWithdrawCheck({
  note,
  amount,
  members,
  delaySeconds = 0,
  eligibleAt = null,
  viaRelayer,
  freshRecipient,
}: {
  note: Note | null;
  amount: bigint | null;
  /**
   * positions (leaf-order deposits, poolDeposits' order) of the association set the withdrawal would be proved in:
   * previewAssociationSet's nextMembers when the withdrawal asks for the next root, else its members; null when no
   * set holds the note (no check then)
   */
  members: ReadonlySet<number> | null;
  /** the pool's inclusion delay: a deposit made from now on joins the set only this long after it is made */
  delaySeconds?: number;
  /** when the note's deposit becomes eligible (its time plus the delay): the projected withdrawal is never earlier */
  eligibleAt?: number | null;
  viaRelayer: boolean;
  freshRecipient: boolean;
}): CheckState {
  const { pool } = usePrivacy();
  const ref = useActivePool();
  const own = useOwnAndWallet();
  const tick = useClock(30_000);
  // the active pool's entry only: same chain and address (an entry for the same address on the other chain never matches)
  const activity = useActivePoolActivity(ref, tick);
  const list = activity.entry;

  // the note's deposit is found in the device's own events, never by asking anyone
  const event = useMemo(
    () =>
      note ? (pool.events.find((e): e is DepositedEvent => e.kind === "deposit" && e.label === note.label) ?? null) : null,
    [pool.events, note],
  );
  // the list dates the check only when it is the active pool's, and holds the note's deposit
  const status = list && event && ref ? activityStatus(list, { chainId: ref.chainId, pool: ref.pool }, event) : null;
  const times: CheckState["times"] =
    status === "ready" ? "ready" : status === "foreign" || activity.times === "unavailable" || activity.failed ? "unavailable" : "loading";
  const dating = times === "ready" && list ? list : null;

  const rows = useMemo(() => poolDeposits(pool.events, dating?.activity ?? null, own), [pool.events, dating, own]);
  // that chain's time at the last fetch, moved on by the time since (the device clock is not trusted for dates)
  const now = dating ? activity.now : null;
  const position = note ? rows.findIndex(r => r.label === note.label) : -1;

  const check = useMemo(() => {
    if (!note || position < 0 || !members || !members.has(position) || !amount || amount <= 0n || amount > note.value) return null;
    return withdrawCheck({
      deposits: rows,
      deposit: position,
      members,
      delaySeconds,
      eligibleAt,
      hop: note.hop,
      noteValue: note.value,
      amount,
      now,
      viaRelayer,
      freshRecipient,
    });
  }, [note, position, members, delaySeconds, eligibleAt, amount, rows, now, viaRelayer, freshRecipient]);

  const mine = position >= 0 ? rows[position] : null;
  return {
    check,
    since: check?.since ?? (mine ? rows.slice(position + 1).filter(r => !r.own).length : null),
    elapsed: check?.elapsed ?? (mine && now !== null ? Math.max(0, now - Math.min(mine.timestamp ?? now, now)) : null),
    times,
  };
}

/** Verdict words in readable tones (TONE_TEXT keeps small text at 4.5:1 on both themes). */
const VERDICT: Record<SimVerdict, { label: string; tone: string }> = {
  linked: { label: "Linked", tone: TONE_TEXT.destructive },
  weak: { label: "Weak", tone: TONE_TEXT.destructive },
  moderate: { label: "Moderate", tone: TONE_TEXT.warning },
  strong: { label: "Strong", tone: TONE_TEXT.profit },
};

function Row({ label, value, sub, strong = false }: { label: ReactNode; value?: ReactNode; sub?: ReactNode; strong?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <dt className="text-muted-foreground">{label}</dt>
      {value != null && (
        <dd className={`ml-auto text-right font-mono text-foreground ${strong ? "text-[13px] font-semibold" : ""}`}>{value}</dd>
      )}
      {sub && (
        <dd className="w-full leading-relaxed text-muted-foreground">{sub}</dd>
      )}
    </div>
  );
}

function ReasonLine({ tone, children }: { tone: "good" | "warn" | "bad"; children: ReactNode;
}) {
  const icon =
    tone === "good" ? (
      <CheckCircle2 className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${TONE_TEXT.profit}`} title="Good" />
    ) : tone === "warn" ? (
      <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${TONE_TEXT.warning}`} title="Caution" />
    ) : (
      <Link2 className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${TONE_TEXT.destructive}`} title="Link risk" />
    );
  return (
    <li className="flex gap-2">
      {icon}
      <span className="min-w-0 text-foreground">{children}</span>
    </li>
  );
}

/** A caution of the withdraw form; `links` = it is what links the withdrawal (shown right under the verdict). */
export interface FormCaution {
  text: string;
  links: boolean;
}

/**
 * The privacy check right before the submit button. The rows carry the figures: the association set this note is
 * proved in, who could fund the amount, the activity since the deposit, the estimate with its verdict and the
 * recommended wait. What links the withdrawal comes right under the verdict, then the advice, then the form's other
 * cautions (small set, own gas, an address that deposited before), each said once. Without public times there is
 * no verdict and no wait, only the figures that need no time.
 */
export function PrivacyCheckBlock({
  state,
  amount,
  over,
  preview,
  setSize,
  noNewRoot = false,
  held = false,
  screeningText = null,
  cautions,
  hide,
  onUseAmount,
}: {
  state: CheckState;
  /** a valid amount (above 0, at most the note's value), or null */
  amount: bigint | null;
  /** the note's value when the amount typed is more than it holds; null otherwise */
  over: bigint | null;
  preview: AssociationSetPreview;
  /** members of the association set the withdrawal would be proved in, when that set holds the note; else null */
  setSize: number | null;
  /** the association-set publisher cannot post a newer root right now: the proof uses the root already published */
  noNewRoot?: boolean;
  /** the form holds this note back (Screening.tsx holdBlocker): no withdrawal of it starts, so it asks for nothing */
  held?: boolean;
  /** where the note's deposit stands under the screening policy (Screening.tsx screeningLine), when it is not in the set */
  screeningText?: string | null;
  cautions: FormCaution[];
  /** reason topics the cautions already cover */
  hide: ReadonlySet<ReasonTopic>;
  onUseAmount: (wei: bigint) => void;
}) {
  const titleId = useId();
  const { check, since, elapsed, times } = state;
  const reasons = check ? check.reasons.filter(r => !hide.has(r.topic)) : [];
  const v = check?.verdict ? VERDICT[check.verdict] : null;
  // no wait while the recipient or the route links the withdrawal: waiting cannot fix that
  const wait = check && !check.linked ? waitLine(check) : null;
  const linking = cautions.filter(c => c.links);
  const rest = cautions.filter(c => !c.links);
  // the withdrawal asks for the next root; a note the form holds back starts no withdrawal, so it asks for nothing (a
  // pool's first root never comes from a withdrawal: every note is held until a root holds it)
  const asks = preview.behind && !noNewRoot && !held;
  // the next root (the operator's snapshot, rebuilt on this device) holds the note: its size is the crowd then
  const inNext = asks && preview.nextMembers !== null && preview.next !== null;
  // a held note that the next root would hold: the crowd it joins once the root on-chain includes it
  const joinsNext = held && preview.behind && !noNewRoot && preview.nextMembers !== null && preview.next !== null ? preview.next : null;
  // members the operator announces for exclusion are not counted: this app holds them back, so they are no cover
  const uncounted =
    preview.announcedOut > 0
      ? ` Not counted: ${plural(preview.announcedOut, "member")} the operator's status announces for exclusion (this app would not withdraw ${preview.announcedOut === 1 ? "it" : "them"}).`
      : "";

  return (
    <section aria-labelledby={titleId} className={`${INSET} flex flex-col gap-2.5 p-3`}>
      <h3 id={titleId} className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
        Privacy check
      </h3>

      <dl className="space-y-1.5 text-xs">
        {inNext ? (
          <Row
            label="Association set"
            value={plural(preview.next!, "deposit")}
            sub={`Counted once the next root is posted, which this withdrawal asks for (the operator's snapshot, rebuilt on this device; the app checks the root on-chain again once it is posted, before the withdrawal is sent); the current root ${
              preview.covered !== null
                ? `covers ${preview.covered.toLocaleString("en-US")}`
                : preview.state.kind === "unverified"
                  ? "could not be checked on this device"
                  : "does not include this deposit yet"
            }.${uncounted}`}
          />
        ) : preview.covered !== null ? (
          screeningText ? (
            // in the current root, but held back (a removal the operator announces): what holds it, not the crowd
            <Row label="Association set" value={plural(preview.covered, "deposit")} sub={screeningText} />
          ) : preview.behind && noNewRoot ? (
            <Row
              label="Association set"
              value={plural(preview.covered, "deposit")}
              sub={`The current root, for now: the association-set publisher cannot post a newer one right now. The proof shows your deposit is one of them, not which one.${uncounted}`}
            />
          ) : (
            <Row label="Association set" value={plural(preview.covered, "deposit")} sub={`The proof shows your deposit is one of them, not which one.${uncounted}`} />
          )
        ) : (
          <Row
            label="Association set"
            value="Not yet"
            sub={`${
              screeningText ??
              (preview.behind && noNewRoot
                ? "This deposit waits for the association-set publisher to post a root that includes it."
                : "This note's deposit is not in the association set yet.")
            }${
              joinsNext !== null
                ? ` Once the root on-chain includes it, the association set holds ${plural(joinsNext, "deposit")} (the operator's snapshot, rebuilt on this device).`
                : ""
            }`}
          />
        )}
        {check && amount !== null && (
          <Row
            label={`Could fund ${eth(amount)} ETH`}
            value={plural(check.couldFund, "deposit")}
          />
        )}
        {check && amount !== null && check.sameAmount !== null && (
          <Row
            label={`Exactly ${eth(amount)} ETH`}
            value={plural(check.sameAmount, "deposit")}
          />
        )}
        {since !== null && (
          <Row
            label="Since your deposit"
            value={`${plural(since, "deposit")}${elapsed !== null ? ` in ${formatAge(elapsed)}` : ""}`}
          />
        )}
        {check && check.estimate !== null && v && (
          <Row
            label="Effective anonymity set"
            strong
            value={
              <>
                {check.estimate === 1
                  ? "1"
                  : `≈ ${check.estimate.toLocaleString("en-US")}`}{" "}
                <span
                  className={`ml-1 font-sans text-xs font-semibold ${v.tone}`}
                >
                  {v.label}
                </span>
              </>
            }
          />
        )}
        {wait && (
          <Row
            label="Recommended wait"
            value={wait.value}
            sub={
              wait.note && (
                <span
                  className={
                    wait.value === null ? "text-foreground" : undefined
                  }
                >
                  {wait.note}
                  {wait.use !== null && (
                    <>
                      {" "}
                      <UseAmount wei={wait.use} onUse={onUseAmount} />
                    </>
                  )}
                </span>
              )
            }
          />
        )}
      </dl>

      {linking.map(c => (
        <Caution key={c.text}>{c.text}</Caution>
      ))}

      {over !== null ? (
        <p
          className={`text-xs font-medium leading-relaxed ${TONE_TEXT.destructive}`}
        >
          More than this note holds ({eth(over)} ETH).
        </p>
      ) : (
        !check &&
        setSize !== null && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Enter an amount to see who could have funded it.
          </p>
        )
      )}

      {/* without this pool's public times there is no verdict, no estimate and no wait: say so, plainly */}
      {setSize !== null && times !== "ready" && (
        <p className="text-xs leading-relaxed text-muted-foreground" role="status">
          {times === "loading"
            ? "Checking timing…"
            : "Timing could not be checked, so this check is incomplete. A recent deposit is easy to link by timing."}
        </p>
      )}

      {reasons.length > 0 && (
        <ul className="space-y-1.5 border-t border-border/50 pt-2.5 text-xs leading-relaxed">
          {reasons.map(r => (
            <ReasonLine key={r.topic} tone={r.tone}>
              {r.text}
              {r.use !== undefined && (
                <>
                  {" "}
                  <UseAmount wei={r.use} onUse={onUseAmount} />
                </>
              )}
            </ReasonLine>
          ))}
        </ul>
      )}

      {rest.map(c => (
        <Caution key={c.text}>{c.text}</Caution>
      ))}

      <p className="text-xs leading-relaxed text-muted-foreground">
        An estimate from this app's model, including the “Strong” label. Deposit
        counts are not counts of independent people. Worked out on this device from public data; no explicit note identifier is sent
        {asks && ", and asking for the next root is the same request for any withdrawal"}. An estimate, not a guarantee: IP addresses and
        off-chain data,
        exclusions and retry behavior can narrow it further.
      </p>
    </section>
  );
}
