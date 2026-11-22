/**
 * The association set's screening policy as the vault, My notes and the pool pages show it (the rules:
 * shared/privacy/screening.ts; the public page: /pools/screening). Where each of the vault's deposits stands (in the
 * set, waiting for screening, excluded, ...) is worked out on this device (publicData.ts noteScreening) from public data
 * every visitor gets alike, and nothing is fetched for a note:
 *   - the pool's public events and current root (PrivacyProvider: every pool, on one schedule);
 *   - privacy.asp.status, which the shell fetches for every privacy-area visitor (ASP_STATUS_SCHEDULE): the policy, the
 *     operator's snapshot and the deposits its exclusion list names. An announced exclusion is the operator's claim: only
 *     on-chain evidence (a leaf in the verified current root's exclusions, or a member an earlier root counted and the
 *     current one dropped) makes a deposit "excluded" and points at the public exit. An announcement alone can only hold
 *     this app back (fail closed), never send anyone to the public exit, which names the depositor;
 *   - privacy.poolActivity (the vault page and My notes fetch it for every visitor): the deposit's block time, matched
 *     by its transaction hash, so no block is read for one deposit.
 * Every hook here reads the copies those schedules keep (disabled observers): none starts a request.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { AlertTriangle, DoorOpen, FileCheck2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { MULTI_NETWORK, type PoolRef } from "@/privacy/config";
import { formatEth, shortHex } from "@/privacy/format";
import type { PoolState } from "@/privacy/PrivacyProvider";
import {
  activeASPStatus,
  activePoolActivity,
  announcedSinceOf,
  inclusionDelay,
  noteScreening,
  offersPublicExit,
  withdrawHold,
  type ASPStatusState,
  type NoteScreening,
} from "@/privacy/publicData";
import type { ASPScreening, PublisherBlock } from "@shared/privacy/api";
import { formatAge } from "@shared/privacy/guidance";
import type { PoolId } from "@shared/privacy/networks";
import type { Note } from "@shared/privacy/notes";
import { EXCLUSION_REASONS, formatDelay, type ExclusionReason, type RootProblem } from "@shared/privacy/screening";
import { CAUTION_BOX, INSET, Pill, QUIET_HOVER, TONE_TEXT, type PillTone } from "./ui";

/** The public screening policy page. */
export const SCREENING_PATH = "/pools/screening";

// ─── the cached public answers ────────────────────────────────────────────────

/** The device clock, ticking every `ms` (only ever used for the age of an answer and added to a chain's own time). */
function useNowMs(ms: number): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setT(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return t;
}

/** The shell's copy of privacy.asp.status (a disabled observer: it never asks the server itself). */
export function useASPStatusAnswer() {
  const q = trpc.privacy.asp.status.useQuery(undefined, { enabled: false });
  return { answer: q.data, failed: q.isError, fetchedAt: q.dataUpdatedAt };
}

/** The page's copy of privacy.poolActivity (a disabled observer: the vault page and My notes fetch it). */
function useActivityAnswer() {
  const q = trpc.privacy.poolActivity.useQuery(undefined, { enabled: false });
  return { answer: q.data, failed: q.isError, fetchedAt: q.dataUpdatedAt };
}

/** One pool's entry of the status answer (same chain AND address, fresh), re-read every 30 s. */
export function useASPStatusOf(ref: PoolId | null): ASPStatusState {
  const nowMs = useNowMs(30_000);
  const { answer, failed, fetchedAt } = useASPStatusAnswer();
  return useMemo(() => activeASPStatus(answer, failed, ref, fetchedAt, nowMs), [answer, failed, ref, fetchedAt, nowMs]);
}

/** Several pools' entries of the status answer, in the order given (pass a stable array). */
export function useASPStatuses(refs: readonly PoolId[]): ASPStatusState[] {
  const nowMs = useNowMs(30_000);
  const { answer, failed, fetchedAt } = useASPStatusAnswer();
  return useMemo(() => refs.map((r) => activeASPStatus(answer, failed, r, fetchedAt, nowMs)), [refs, answer, failed, fetchedAt, nowMs]);
}

/**
 * A reader of note states for any registry pool: (pool, its state as read here, the note's label) → NoteScreening, from
 * the cached status and activity answers. Re-evaluated every 30 s so a countdown moves on. An announced removal is
 * judged overdue only from this device's own first sight of the announcement (publicData.ts announcedSinceOf, kept only
 * while the vault is unlocked).
 */
export function useScreeningReader(): (ref: PoolRef, state: Pick<PoolState, "scope" | "events" | "aspRoot">, label: bigint) => NoteScreening | null {
  const nowMs = useNowMs(30_000);
  const status = useASPStatusAnswer();
  const activity = useActivityAnswer();
  return useCallback(
    (ref, state, label) => {
      const st = activeASPStatus(status.answer, status.failed, ref, status.fetchedAt, nowMs);
      const act = activePoolActivity(activity.answer, activity.failed, ref, activity.fetchedAt, nowMs);
      return noteScreening({ label, chainId: ref.chainId, pool: state, status: st, activity: act, announcedSince: announcedSinceOf(ref, label, st.screening, act.now) });
    },
    [status.answer, status.failed, status.fetchedAt, activity.answer, activity.failed, activity.fetchedAt, nowMs],
  );
}

// ─── words ────────────────────────────────────────────────────────────────────

const reasonTitle = (r: ExclusionReason | null): string | null => (r ? EXCLUSION_REASONS[r].title : null);
const withReason = (r: ExclusionReason | null): string => (r ? ` (reason: ${EXCLUSION_REASONS[r].title})` : "");

/**
 * What the screening pieces show of a note: never its secrets. Components get this, not the Note (React's development
 * build logs the props a component re-renders with, so a nullifier or secret passed as a prop would be copied there).
 */
export interface NoteBrief {
  depositIndex: number;
  hop: number;
  value: bigint;
  spent: boolean;
  spentKind: "withdraw" | "ragequit" | null;
}

export const noteBrief = (n: Note): NoteBrief => ({ depositIndex: n.depositIndex, hop: n.hop, value: n.value, spent: n.spent, spentKind: n.spentBy?.kind ?? null });

/** "Note #3.0" */
export const noteName = (n: Pick<Note, "depositIndex" | "hop">) => `Note #${n.depositIndex}.${n.hop}`;

/**
 * Why the publisher cannot post roots on a network right now, in a clause ("the publisher for X …"): the server's own
 * key and balance, or its exclusion list. Never anything about a visitor.
 */
export function publisherDownClause(block: PublisherBlock | null, name: string): string {
  switch (block) {
    case "publisher_unfunded":
      return `the association-set publisher for ${name} is temporarily unable to post roots (too little testnet ETH for gas)`;
    case "policy_error":
      return `publishing association-set roots on ${name} is paused until the operator fixes a problem with its screening list`;
    default:
      return `this app's server cannot post association-set roots for ${name} right now`;
  }
}

/** The publisher's state in a few words ("can post roots now", "cannot post right now (too little testnet ETH for gas)"). */
export function publisherStateWords(canPublish: boolean, block: PublisherBlock | null): string {
  if (canPublish) return "can post roots now";
  switch (block) {
    case "publisher_unfunded":
      return "cannot post right now (too little testnet ETH for gas)";
    case "policy_error":
      return "publishing paused (a problem with the operator's screening list)";
    default:
      return "this app's server cannot post roots for it right now";
  }
}

/**
 * When a waiting deposit becomes eligible: "in about 42 min", "in under a minute" or "once it is 1 hour old"; null when it
 * already is (or there is no delay). It then joins with the next root the publisher posts, which may come later.
 */
export function etaText(s: Pick<NoteScreening, "eligibleAt" | "now" | "delaySeconds">): string | null {
  if (s.eligibleAt !== null && s.now !== null) {
    const left = s.eligibleAt - s.now;
    if (left <= 0) return null;
    return left < 60 ? "in under a minute" : `in about ${formatAge(left)}`;
  }
  return s.delaySeconds > 0 ? `once it is ${formatDelay(s.delaySeconds)} old` : null;
}

const UNVERIFIED_LINE: Record<RootProblem, string> = {
  missing_deposits: "Checking the newest association-set root on this device (its copy of the pool is catching up).",
  no_record: "Checking the newest association-set root on this device (its copy of the pool is catching up).",
  root: "The newest association-set root does not match the list its record describes, so this app does not prove against it.",
  exclusions: "The newest association-set root does not match the list its record describes, so this app does not prove against it.",
  malformed: "The newest association-set root carries a record this app cannot read, so this app does not prove against it.",
  lowered:
    "The newest association-set root leaves out deposits an earlier root counted without listing them as excluded, which the screening policy does not allow, so this app does not prove against it.",
  version_backwards:
    "The newest association-set root was posted under the older open policy after screened roots, so this app does not prove against it.",
  outdated: "The newest association-set root follows a newer screening policy than this app knows. This app is out of date: reload the page.",
};

/**
 * When the next root comes, from what the operator's server actually runs ("which the publisher posts within about 10
 * minutes"). A withdrawal asks for it only once the pool has a root (a note no root holds starts no withdrawal), except
 * that one request covers every network's pool, so with several networks a withdrawal elsewhere can ask for it too.
 * Without a fresh status answer (still loading, failed or too old) nothing is known about the schedule, so nothing is
 * said about it.
 */
function nextRootClause(s: Pick<NoteScreening, "screening" | "canPublish" | "publishBlock" | "rootPosted">, name: string): string {
  if (s.canPublish === false) return `, but ${publisherDownClause(s.publishBlock, name)}`;
  const withdrawals = s.rootPosted || MULTI_NETWORK;
  const auto = s.screening?.autoPublish;
  if (!auto) return `, which the publisher posts${withdrawals ? " (a private withdrawal of another deposit can also ask for one)" : ""}`;
  if (auto.running) {
    return `, which the publisher posts within about ${formatDelay(auto.seconds)}${withdrawals ? " (or sooner, when a private withdrawal of another deposit asks for one)" : ""}`;
  }
  // the answer says this server runs no periodic publisher (off, or serverless hosting without a scheduler)
  return withdrawals
    ? ", which the publisher posts when the operator, or a private withdrawal of another deposit, asks for one"
    : ", which comes only when the operator posts one: this server runs no periodic publisher";
}

/** "it becomes eligible in about 42 min, then joins with the next root" (or "it joins with the next root" once eligible). */
function eligibleThenJoins(s: Pick<NoteScreening, "eligibleAt" | "now" | "delaySeconds">): string {
  const when = etaText(s);
  return when ? `it becomes eligible ${when}, then joins with the next root` : "it joins with the next root";
}

/**
 * One sentence on where a deposit stands, for the Withdraw form and the notes (null: nothing to say, it is in the set).
 * `name`: the pool's network. Announced exclusions are worded as the operator's announcement, never as a fact.
 */
export function screeningLine(s: NoteScreening, name: string): string | null {
  const st = s.state;
  const down = s.canPublish === false;
  switch (st.kind) {
    case "in_set":
    case "unknown":
      return null;
    case "waiting":
      if (st.announced) {
        return `Waiting for screening, and the operator has announced that this deposit will be excluded${withReason(s.announcedReason)}, so this app does not withdraw it privately.`;
      }
      if (st.why === "delay") {
        const when = etaText(s);
        return down
          ? `Waiting for screening: ${when ? `it becomes eligible ${when}` : "it is eligible"}, but ${publisherDownClause(s.publishBlock, name)}. Ragequit (public exit) works now.`
          : `Waiting for screening: ${eligibleThenJoins(s)}. Ragequit (public exit) works now.`;
      }
      return `Eligible: it joins the association set with the next root${nextRootClause(s, name)}. This app withdraws it privately once the association set on-chain includes it.`;
    case "excluded":
      if (s.readmitted) {
        return `The operator says it has lifted this deposit's exclusion: it rejoins the association set with the next root${nextRootClause(s, name)}. Until the association set on-chain includes it again, this app does not withdraw it privately.`;
      }
      return st.listed
        ? `Excluded from the association set${withReason(st.reason)}: it cannot be withdrawn privately. The public exit (ragequit) returns it to the address that made it.`
        : "Left out of the association set without being listed as excluded, which the screening policy does not allow: it cannot be withdrawn privately now. The public exit (ragequit) returns it to the address that made it.";
    case "removal_announced":
      return `The operator has announced that this deposit will be excluded from the association set${withReason(st.reason)}, but the association set on-chain still includes it, so this app does not withdraw it privately for now.${
        st.overdue ? " The operator's announcement and the chain disagree: no root removing it was posted in time." : ""
      }`;
    case "unverified":
      return UNVERIFIED_LINE[st.problem];
  }
}

/**
 * The Withdraw form's blocker for a note it holds back (publicData.ts withdrawHold), or null: short, since the privacy
 * check right above it says where the deposit stands (screeningLine).
 */
export function holdBlocker(note: Pick<Note, "depositIndex" | "hop">, s: NoteScreening | null, name: string): string | null {
  const hold = withdrawHold(s);
  if (!hold || !s) return null;
  const st = s.state;
  switch (hold) {
    case "delay":
      return `${noteName(note)} is waiting for screening: ${eligibleThenJoins(s)}.`;
    case "next_root":
      return `${noteName(note)} is eligible: it joins the association set with the next root${nextRootClause(s, name)}.`;
    case "excluded":
      return st.kind === "excluded" && !st.listed
        ? `${noteName(note)} was left out of the association set without being listed as excluded. Its public exit (ragequit) is in the Notes tab.`
        : `${noteName(note)} was excluded from the association set${withReason(st.kind === "excluded" ? st.reason : null)}. Use the public exit (ragequit) in the Notes tab.`;
    case "readmitted":
      return `The operator says it has lifted ${noteName(note)}'s exclusion: it rejoins the association set with the next root${nextRootClause(s, name)}.`;
    case "announced":
    case "removal_announced":
      return `The operator has announced that ${noteName(note)}'s deposit will be excluded${withReason(s.announcedReason)}, so this app does not withdraw it privately on ${name}.`;
    case "checking":
      return `This device is still checking the newest association-set root on ${name}. Try again in a moment.`;
    case "unverified":
      return `The newest association-set root on ${name} does not verify on this device, so this app does not withdraw privately there for now.`;
    case "outdated":
      return "The newest association-set root follows a newer screening policy than this app knows. Reload the page.";
  }
}

// ─── pills ────────────────────────────────────────────────────────────────────

/**
 * A note's screening pill, or null when it is simply in the set (the caller shows "spendable"). `short` is the few words
 * a narrow place shows (the Withdraw form's note selector).
 */
export function screeningPill(s: NoteScreening | null, name: string): { label: string; short: string; tone: PillTone; title: string } | null {
  if (!s) return null;
  const st = s.state;
  const title = screeningLine(s, name) ?? "";
  switch (st.kind) {
    case "in_set":
    case "unknown":
      return null;
    case "waiting":
      if (st.announced) return { label: "Exclusion announced", short: "announced", tone: "warning", title };
      return st.why === "delay"
        ? { label: "Waiting for screening", short: "waiting", tone: "muted", title }
        : { label: "Joins next root", short: "next root", tone: "muted", title };
    case "excluded":
      return s.readmitted
        ? { label: "Joins next root", short: "next root", tone: "muted", title }
        : { label: "Excluded", short: "excluded", tone: "destructive", title };
    case "removal_announced":
      return { label: "Removal announced", short: "announced", tone: "warning", title };
    case "unverified":
      if (st.problem === "missing_deposits" || st.problem === "no_record") return { label: "Checking…", short: "checking", tone: "muted", title };
      return st.problem === "outdated"
        ? { label: "Reload the app", short: "reload", tone: "warning", title }
        : { label: "Root not verified", short: "unverified", tone: "warning", title };
  }
}

/**
 * The note's status pill for the notes tables: spent and empty notes as before; an unspent note with value gets its
 * screening state, or "spendable" when it is in the set (or nothing can be said yet).
 */
export function NoteStatusPill({ note, s, name, small = true }: { note: NoteBrief; s: NoteScreening | null; name: string; small?: boolean }) {
  if (note.spent) return <Pill small={small}>spent · {note.spentKind}</Pill>;
  if (note.value === 0n) return <Pill small={small}>empty change note</Pill>;
  const pill = screeningPill(s, name);
  if (!pill) {
    return (
      <Pill small={small} tone="profit">
        spendable
      </Pill>
    );
  }
  return (
    <span className="inline-flex items-center gap-1" title={pill.title}>
      <Pill small={small} tone={pill.tone}>
        {pill.label}
      </Pill>
      <span className="sr-only">{pill.title}</span>
    </span>
  );
}

// ─── callouts ─────────────────────────────────────────────────────────────────

/** "Screening policy", a link in running text. */
export function PolicyLink({ children = "Screening policy" }: { children?: ReactNode }) {
  return (
    <Link
      href={SCREENING_PATH}
      className="inline-flex items-center gap-1 whitespace-nowrap rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <FileCheck2 className="h-3 w-3" aria-hidden />
      {children}
    </Link>
  );
}

/**
 * "Excluded: use the public exit", for a note whose exclusion the chain shows (publicData.ts offersPublicExit): what it
 * means, where the public exit sends the money, that the exit is public, and the Ragequit button. Nothing for any other
 * note (never for a spent or empty one, an announcement alone, or an exclusion being lifted).
 */
export function ExcludedCallout({
  note,
  s,
  connected,
  busy = false,
  onRagequit,
}: {
  note: NoteBrief;
  s: NoteScreening | null;
  /** the connected wallet's address, if any */
  connected?: string | null;
  busy?: boolean;
  onRagequit: () => void;
}) {
  if (!s || !offersPublicExit(note, s) || s.state.kind !== "excluded") return null;
  const st = s.state;
  const reason = reasonTitle(st.reason);
  const depositor = s.depositor;
  const otherWallet = !!connected && !!depositor && connected.toLowerCase() !== depositor;
  return (
    <div role="status" className={`rounded-lg border p-3 ${CAUTION_BOX}`}>
      <p className={`flex items-center gap-1.5 text-[13px] font-medium ${TONE_TEXT.destructive}`}>
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Excluded: use the public exit
      </p>
      <div className="mt-1 space-y-1.5 text-xs leading-relaxed text-foreground">
        <p>
          {noteName(note)} ({formatEth(note.value)} ETH){" "}
          {st.listed ? (
            <>
              was excluded from the association set{reason ? <> (reason: {reason})</> : null}
              {st.removed ? ", after it had been in the set (as an earlier root's record says)" : ""}.
            </>
          ) : (
            <>was left out of the association set without being listed as excluded, which the screening policy does not allow.</>
          )}{" "}
          It cannot be withdrawn privately.
        </p>
        <p>
          The public exit (ragequit) returns it to the address that made the deposit{depositor ? <> (<span className="font-mono">{shortHex(depositor)}</span>)</> : null}:
          connect that wallet and use Ragequit. It needs a little ETH there for gas, and it works only for whoever controls that address. The exit is
          public: anyone can link it to this deposit
          {note.hop > 0 ? ", and, since this is a change note, to the earlier private withdrawal that left it" : ""}.
        </p>
        {otherWallet && <p className={TONE_TEXT.destructive}>Your connected wallet is not that address, so a ragequit from it would be rejected.</p>}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button size="sm" variant="outline" className={`h-8 rounded-full px-3 text-xs ${QUIET_HOVER}`} disabled={busy} onClick={onRagequit}>
          <DoorOpen className="h-3.5 w-3.5" aria-hidden /> Ragequit {noteName(note).replace("Note ", "")}
        </Button>
        <span className="text-xs">
          <PolicyLink />
        </span>
      </div>
    </div>
  );
}

/**
 * The calm note for a deposit whose exclusion the operator only announces (removal_announced, or waiting with an
 * announcement): this app holds its private withdrawal back, and it suggests no public exit.
 */
export function AnnouncedNote({ note, s, name }: { note: NoteBrief; s: NoteScreening | null; name: string }) {
  if (!s || note.spent || note.value === 0n) return null;
  const st = s.state;
  const announced = st.kind === "removal_announced" || (st.kind === "waiting" && st.announced);
  if (!announced) return null;
  return (
    <p className={`${INSET} flex gap-2 p-3 text-xs leading-relaxed text-foreground`} role="status">
      <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${TONE_TEXT.warning}`} aria-hidden />
      <span className="min-w-0">
        <span className="font-medium">{noteName(note)}: </span>
        {screeningLine(s, name)} <PolicyLink />
      </span>
    </p>
  );
}

// ─── what the next root changes ───────────────────────────────────────────────

const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/**
 * What the operator's next root changes against the root on-chain (its status answer's `next`: deposits it adds and
 * members it removes, counted apart). null when the answer has none: an older server, a current root the server cannot
 * verify, or a list the server cannot read (then nothing is said about the next root at all).
 */
export function nextRootChange(screening: ASPScreening | null | undefined): { joins: number; removals: number } | null {
  if (screening?.exclusions === "invalid") return null;
  const n = screening?.next;
  return n && isCount(n.joins) && isCount(n.removals) ? { joins: n.joins, removals: n.removals } : null;
}

/**
 * "2 newer deposits wait for the next root; it removes 1 excluded deposit", or null when it changes nothing. `asks`:
 * add who posts it, from what the server actually runs (`schedule`: its periodic publisher runs).
 */
export function nextRootChangeText(change: { joins: number; removals: number } | null, o: { asks?: boolean; schedule?: boolean } = {}): string | null {
  if (!change || (change.joins === 0 && change.removals === 0)) return null;
  const n = (k: number, one: string) => `${k.toLocaleString("en-US")} ${one}${k === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (change.joins > 0) parts.push(`${n(change.joins, "newer deposit")} ${change.joins === 1 ? "waits" : "wait"} for the next root`);
  if (change.removals > 0) parts.push(`${parts.length > 0 ? "it" : "the next root"} removes ${n(change.removals, "excluded deposit")}`);
  const who = o.schedule
    ? " (the publisher posts it on its schedule, or when a private withdrawal asks for it)"
    : " (the publisher posts it when the operator, or a private withdrawal, asks for it: this server runs no periodic publisher)";
  return `${parts.join("; ")}${o.asks ? who : ""}`;
}

/**
 * How a pool's first root comes, for a pool with deposits and no root yet: from the periodic publisher, or, on a server
 * that runs none, only when the operator posts one (no withdrawal of its own asks for it: every note is held until a
 * root holds it). With several networks, the one publish request a withdrawal on another network sends covers this
 * pool too.
 */
export function firstRootClause(screening: ASPScreening | null | undefined): string {
  if (screening && !screening.autoPublish.running) {
    return MULTI_NETWORK
      ? "the operator posts the first one once a deposit has passed screening, or the publisher does when a private withdrawal on another network asks for a newer root (this server runs no periodic publisher)"
      : "the operator posts the first one once a deposit has passed screening (this server runs no periodic publisher)";
  }
  return `the publisher posts the first one once a deposit has passed screening${MULTI_NETWORK ? " (a private withdrawal on another network can ask for it sooner)" : ""}`;
}

// ─── the policy, in one line ──────────────────────────────────────────────────

/**
 * "deposits become eligible 1 hour after they are made" / "deposits become eligible once they are confirmed" (they join
 * with the next root posted after that)
 */
export function joinsClause(delaySeconds: number): string {
  return delaySeconds > 0 ? `deposits become eligible ${formatDelay(delaySeconds)} after they are made` : "deposits become eligible once they are confirmed";
}

/**
 * The pool's screening line (pool page governance, quick view): "Screening policy v1: deposits become eligible 1 hour
 * after they are made · 2 excluded · 3 waiting · Read the policy". From the pool's fresh status entry; without one, the
 * registry's delay and no counts. "Excluded" counts the deposits the operator's list names (its public claim); while
 * the server cannot read its list it says so instead (a count would be the last list it read, or none after a restart).
 */
export function ScreeningSummary({ chainId, screening, className = "" }: { chainId: number; screening: ASPScreening | null; className?: string }) {
  const delay = inclusionDelay(screening, chainId);
  const parts = [`Screening policy${screening ? ` v${screening.policyVersion}` : ""}: ${joinsClause(delay)}`];
  if (screening) {
    parts.push(screening.exclusions === "invalid" ? "exclusion list unreadable, publishing paused" : `${screening.excluded.length.toLocaleString("en-US")} excluded`);
    parts.push(`${screening.snapshot.waiting.toLocaleString("en-US")} waiting`);
  }
  return (
    <p className={`text-xs leading-relaxed text-muted-foreground ${className}`}>
      {parts.join(" · ")} · <PolicyLink>Read the policy</PolicyLink>
    </p>
  );
}
