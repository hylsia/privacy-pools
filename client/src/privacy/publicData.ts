/**
 * Pure selectors over the public answers every visitor fetches alike (privacy.poolActivity, privacy.pools,
 * privacy.asp.status). They pick the active pool's entry, by chain AND address, from answers already on this device,
 * and never start a request: switching the active network re-selects from the cached answers.
 *
 * The rules (final design §5 "Selectors"):
 *   - an entry belongs to a pool only when both its chain and its address match (the same deployer gives the same
 *     address on every chain, so an address alone can name several pools);
 *   - figures are never summed or merged across networks, and a block time is used only with its own chain's
 *     events: each entry carries its own chain's `now`;
 *   - when nothing matches, when the pool is listed under `unavailable`, or when the fetch failed before any answer,
 *     the result is "unavailable" and there is no verdict.
 *
 * Tested from server/privacy/publicData.test.ts.
 */
import type {
  ASPScreening,
  ASPStatusAnswer,
  ASPStatusEntry,
  PoolActivityAnswer,
  PoolActivityEntry,
  PoolServices,
  PoolsAnswer,
  PoolUnavailable,
  PublisherBlock,
} from "@shared/privacy/api";
import { networkById, pickPoolEntry, type PoolId } from "@shared/privacy/networks";
import type { Note } from "@shared/privacy/notes";
import {
  announcedExclusions,
  announcementsShrinkSome,
  depositOf,
  publishDueAcross,
  screeningState,
  validScreening,
  type ExclusionReason,
  type PoolForPublish,
  type ScreeningState,
} from "@shared/privacy/screening";
import type { PoolEvent } from "@shared/privacy/types";
import type { PoolState } from "./PrivacyProvider";

/**
 * One schedule for every visitor for privacy.poolActivity (the vault's privacy check, and My notes): when the page
 * opens, then every minute. Never because of a note, an amount, a tab or the vault's lock state.
 */
export const POOL_ACTIVITY_SCHEDULE = { staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: false } as const;

/** The pool is listed as unavailable in an answer (a chain-wide entry, pool null, counts for its pool too). */
function listedUnavailable(list: readonly PoolUnavailable[] | undefined, ref: PoolId): boolean {
  if (!Array.isArray(list)) return false;
  return list.some(
    (u) => !!u && u.chainId === ref.chainId && (u.pool === null || (typeof u.pool === "string" && u.pool.toLowerCase() === ref.pool.toLowerCase())),
  );
}

/**
 * The active pool's public activity list, and that chain's time now.
 *   - "ready": the answer holds the active pool's entry (same chain and address); `now` is the entry's own `now`
 *     plus the whole seconds since the fetch (the device clock is never trusted for dates);
 *   - "loading": no answer yet, and no failure;
 *   - "unavailable": the fetch failed with no answer to use, the pool is listed under `unavailable`, or nothing
 *     matches (an entry for the same address on another chain does not). `now` is null then: no verdict.
 * An earlier answer stays usable after a failed refetch, as the vault's privacy check had it.
 * The entry then goes to guidance's activityStatus(entry, { chainId, pool }, deposit); only its "ready" dates a check.
 */
export function activePoolActivity(
  answer: PoolActivityAnswer | undefined,
  failed: boolean,
  ref: PoolId | null,
  fetchedAtMs: number,
  nowMs: number,
): { entry: PoolActivityEntry | null; now: number | null; times: "ready" | "loading" | "unavailable" } {
  if (!answer) return { entry: null, now: null, times: failed || !ref ? "unavailable" : "loading" };
  if (!ref) return { entry: null, now: null, times: "unavailable" };
  const entry = Array.isArray(answer.pools) ? pickPoolEntry(answer.pools, ref) : null;
  if (!entry || listedUnavailable(answer.unavailable, ref) || typeof entry.now !== "number" || !Number.isFinite(entry.now)) {
    return { entry: null, now: null, times: "unavailable" };
  }
  const since = Number.isFinite(nowMs - fetchedAtMs) ? Math.max(0, Math.floor((nowMs - fetchedAtMs) / 1000)) : 0;
  return { entry, now: entry.now + since, times: "ready" };
}

/** The pool size shown before a deposit (moved here from PrivacyCheck.tsx). */
export type PoolSizeState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; published: number; rootPublished: boolean; all: number };

/**
 * The active pool's size, from its row of the shell's privacy.pools({ interval: "24h" }) answer: the deposits under
 * the published association-set root (the anonymity set) and every deposit. Never a sum, never another network's
 * figure. No matching row (or the pool listed under `unavailable`) gives "unavailable": the form then reads "Pool
 * size on {name} is unavailable right now."
 */
export function activePoolSize(answer: PoolsAnswer | undefined, failed: boolean, ref: PoolId | null): PoolSizeState {
  if (!answer) return { status: failed || !ref ? "unavailable" : "loading" };
  if (!ref) return { status: "unavailable" };
  const row = Array.isArray(answer.pools) ? pickPoolEntry(answer.pools, ref) : null;
  if (!row || listedUnavailable(answer.unavailable, ref)) return { status: "unavailable" };
  return { status: "ready", published: row.aspRootMembers, rootPublished: row.aspRootPublished, all: row.deposits };
}

/**
 * The server's relayer and association-set publisher on the active pool, as its row of the shell's privacy.pools
 * answer reports them (the same request for every visitor, every 30 s: reading it here sends nothing new). The server
 * checks its own keys and their balances, never anything about a visitor.
 *   - "ready": the row carries the four fields;
 *   - "loading": no answer yet;
 *   - "unknown": the fetch failed, the pool has no row (or is listed under `unavailable`), or an older server sent a
 *     row without these fields. The forms then fall back to the relayer quote and the publish answer, as before.
 */
export type PoolServicesState = { status: "loading" } | { status: "unknown" } | ({ status: "ready" } & PoolServices);

export function activePoolServices(answer: PoolsAnswer | undefined, failed: boolean, ref: PoolId | null): PoolServicesState {
  if (!answer) return { status: failed || !ref ? "unknown" : "loading" };
  if (!ref) return { status: "unknown" };
  const row = Array.isArray(answer.pools) ? pickPoolEntry(answer.pools, ref) : null;
  if (!row || listedUnavailable(answer.unavailable, ref)) return { status: "unknown" };
  const s = row as Partial<PoolServices>;
  if (typeof s.relayerAvailable !== "boolean" || typeof s.aspCanPublish !== "boolean") return { status: "unknown" };
  return {
    status: "ready",
    relayerAvailable: s.relayerAvailable,
    relayerBlock: s.relayerAvailable ? null : (s.relayerBlock ?? null),
    aspCanPublish: s.aspCanPublish,
    aspPublishBlock: s.aspCanPublish ? null : (s.aspPublishBlock ?? null),
  };
}

/**
 * Whether this device has read a pool in this session, so that its notes and figures mean something:
 *   - "ready": its state was read at least once (a later failed sync keeps the last values read);
 *   - "loading": its first read has not finished;
 *   - "unavailable": its first read failed (an RPC down or rate limited, or the pool record does not match the
 *     contract). Its notes are unknown: views show "—" and say so, never 0 or "no notes".
 */
export function poolReadState(state: Pick<PoolState, "status" | "scope">): "ready" | "loading" | "unavailable" {
  if (state.scope !== null) return "ready";
  return state.status === "error" ? "unavailable" : "loading";
}

/** The Pools page's line for a pool whose public data cannot be read (Pools.tsx, PoolPage.tsx), in its short form. */
export const poolDataUnavailable = (name: string): string => `Pool data for ${name} is unavailable right now (public RPC).`;

// ─── the association-set publisher's status (privacy.asp.status) ─────────────

/**
 * One schedule for every privacy-area visitor for privacy.asp.status (PoolsShell fetches it): when a page opens, then
 * every minute. Never because of a note, a tab, the vault's lock state or a withdrawal.
 */
export const ASP_STATUS_SCHEDULE = { staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: false, retry: 1 } as const;

/**
 * An asp.status answer older than this is not used (two scheduled refetches failed): the device then works from
 * on-chain data alone, as with an older server that sends no screening block.
 */
export const ASP_STATUS_MAX_AGE_MS = 120_000;

/**
 * The active pool's association-set status, from the answer every visitor fetches alike:
 *   - "ready": the answer names this pool (same chain and address) and is at most ASP_STATUS_MAX_AGE_MS old;
 *     `screening` is its screening block when it has the shape this app reads (validScreening), else null (an older
 *     server: devices then decide from on-chain data, the open policy's rules);
 *   - "loading": no answer yet, and no failure;
 *   - "unavailable": the fetch failed with no answer to use, the answer is too old, the pool is listed under
 *     `unavailable`, or nothing matches (an entry for the same address on another chain does not).
 * An earlier answer stays usable after a failed refetch while it is young enough.
 */
export type ASPStatusState =
  | { status: "loading"; entry: null; screening: null }
  | { status: "unavailable"; entry: null; screening: null }
  | { status: "ready"; entry: ASPStatusEntry; screening: ASPScreening | null };

const STATUS_LOADING: ASPStatusState = { status: "loading", entry: null, screening: null };
const STATUS_UNAVAILABLE: ASPStatusState = { status: "unavailable", entry: null, screening: null };

export function activeASPStatus(
  answer: ASPStatusAnswer | undefined,
  failed: boolean,
  ref: PoolId | null,
  fetchedAtMs: number,
  nowMs: number,
): ASPStatusState {
  if (!answer) return failed || !ref ? STATUS_UNAVAILABLE : STATUS_LOADING;
  if (!ref) return STATUS_UNAVAILABLE;
  const age = nowMs - fetchedAtMs;
  if (!Number.isFinite(age) || age > ASP_STATUS_MAX_AGE_MS) return STATUS_UNAVAILABLE;
  const entry = Array.isArray(answer.pools) ? pickPoolEntry(answer.pools, ref) : null;
  if (!entry || listedUnavailable(answer.unavailable, ref)) return STATUS_UNAVAILABLE;
  return { status: "ready", entry, screening: validScreening(entry.screening) };
}

/** The synced pools with their fresh screening blocks (`screenings[i]` is states[i]'s pool's, or null). */
function readyPools(states: readonly (PoolState | null | undefined)[], screenings: readonly (ASPScreening | null | undefined)[]): PoolForPublish[] {
  const out: PoolForPublish[] = [];
  states.forEach((s, i) => {
    if (s && s.status === "ready") out.push({ events: s.events, currentRoot: s.aspRoot, screening: screenings[i] ?? null });
  });
  return out;
}

/**
 * Whether a private withdrawal, on any network, sends the input-less publish request (after the questions about its
 * crowd): for some synced pool, publishDue holds (shared/privacy/screening.ts): the operator's rootDue from its fresh
 * screening answer, or, without one (an older server, or an answer older than ASP_STATUS_MAX_AGE_MS), the open policy's
 * rule (the current root does not cover every deposit this device holds). Never while some pool's fresh answer has
 * announcements that alone shrink that pool's current root sharply (publishBlocked): one answer covers every network,
 * so that answer sends no request at all (screening.ts publishDueAcross). `screenings[i]` is states[i]'s pool's fresh
 * screening block, or null. It reads public data of every pool, never a note or a label, so every withdrawal on every
 * network decides the same.
 */
export function publishNeeded(states: readonly PoolState[], screenings: readonly (ASPScreening | null | undefined)[] = []): boolean {
  return publishDueAcross(readyPools(states, screenings));
}

/**
 * Some synced pool's fresh answer has announcements that alone shrink that pool's current root sharply: no withdrawal on
 * any network sends the publish request now (publishNeeded), so the withdraw form shows the current root's crowd
 * (previewAssociationSet's publishBlocked). Public data only.
 */
export function publishBlocked(states: readonly (PoolState | null | undefined)[], screenings: readonly (ASPScreening | null | undefined)[] = []): boolean {
  return announcementsShrinkSome(readyPools(states, screenings));
}

/** A pool's inclusion delay: its fresh screening answer's, else the network registry's (0 for a network it does not know). */
export function inclusionDelay(screening: Pick<ASPScreening, "delaySeconds"> | null | undefined, chainId: number | null | undefined): number {
  if (screening && Number.isSafeInteger(screening.delaySeconds) && screening.delaySeconds >= 0) return screening.delaySeconds;
  return (chainId !== null && chainId !== undefined ? networkById(chainId)?.aspInclusionDelaySeconds : undefined) ?? 0;
}

// ─── a note's screening state (worked out on this device) ─────────────────────

/**
 * Where one of the vault's deposits stands under the screening policy, worked out on this device from public data
 * every visitor gets alike: the pool's own events and current root, the pool's entry of privacy.asp.status, and the
 * deposit's block time from privacy.poolActivity (matched by its transaction hash: no block is read for it). Nothing
 * here is sent anywhere, and no request depends on it.
 */
export interface NoteScreening {
  /** shared/privacy/screening.ts screeningState: in_set, waiting, excluded, removal_announced, unverified or unknown */
  state: ScreeningState;
  /** the pool's fresh screening block (ASP_STATUS_MAX_AGE_MS), or null: on-chain data alone */
  screening: ASPScreening | null;
  /** the pool's inclusion delay (the screening answer's, else the registry's), seconds */
  delaySeconds: number;
  /** the deposit's block time (unix seconds) from the public activity list, or null */
  depositTime: number | null;
  /** depositTime + delaySeconds: from then on the deposit can join the set; null without the deposit's time */
  eligibleAt: number | null;
  /** that chain's time now (the activity entry's own `now` plus the time since the fetch); null without the list */
  now: number | null;
  /** the address that made the deposit (lowercase): the only address its public exit (ragequit) pays */
  depositor: string | null;
  /** the publisher can post on this pool now (the status entry's canPublish); null when unknown */
  canPublish: boolean | null;
  publishBlock: PublisherBlock | null;
  /** the reason of the operator's announced exclusion of this deposit (its claim), or null */
  announcedReason: ExclusionReason | null;
  /**
   * The current root excludes it, but the operator's snapshot admits it again (an exclusion lifted: it counts the
   * deposit, no longer names it, and a root is due, or will be once the operator's edit has settled for 30 s). The
   * operator's claim: the next root shows whether it holds. Never while the operator's list cannot be read (its answer
   * then cannot tell a lift from a list it lost).
   */
  readmitted: boolean;
  /** the pool has an association-set root on-chain (none: the first one comes from the publisher, never a withdrawal) */
  rootPosted: boolean;
}

/**
 * When this device first saw the operator announce the exclusion of one of the vault's deposits, in that chain's time
 * (`${chainId}:${pool}:${label}` → unix seconds), for the "overdue" words only: the status answer carries no time of the
 * operator's. Its keys name the vault's own deposits, so it lives only with the unlocked vault: PrivacyProvider empties
 * it on Lock, Forget, a restore and a new vault (forgetAnnouncedSightings), and the clock starts again at the next
 * unlock. An entry goes too once a fresh answer no longer announces the deposit.
 */
const announcedFirstSeen = new Map<string, number>();

/**
 * That chain's time when this device first saw `screening` (the pool's fresh status block; null: no fresh answer, so
 * nothing starts or ends) announce `label`'s exclusion, or null. `now`: that chain's time now.
 */
export function announcedSinceOf(ref: PoolId, label: bigint, screening: Pick<ASPScreening, "excluded"> | null, now: number | null): number | null {
  const key = `${ref.chainId}:${ref.pool.toLowerCase()}:${label}`;
  if (!screening) return announcedFirstSeen.get(key) ?? null;
  if (!announcedExclusions(screening).has(label)) {
    announcedFirstSeen.delete(key);
    return null;
  }
  if (!announcedFirstSeen.has(key) && now !== null) announcedFirstSeen.set(key, now);
  return announcedFirstSeen.get(key) ?? null;
}

/** Forgets every first sighting (they name the vault's deposits): on Lock, Forget, a restore and a new vault. */
export function forgetAnnouncedSightings(): void {
  announcedFirstSeen.clear();
}

const decimalBigint = (v: unknown): bigint | null => (typeof v === "string" && /^[0-9]{1,80}$/.test(v) ? BigInt(v) : null);

/**
 * The status answer's record of the pool's current root ({ root, cid }; input-less and the same for every visitor, like
 * privacy.asp.set's). For what the forms show only, and it counts only when its root is the root on-chain and its cid
 * rebuilds to that root from this device's own events (shared/privacy/screening.ts checkCurrentRoot).
 */
export function statusRecord(screening: Pick<ASPScreening, "current"> | null | undefined): { root: bigint; cid: string | null } | null {
  const current = screening?.current ?? null;
  const root = current ? decimalBigint(current.root) : null;
  return root !== null ? { root, cid: typeof current!.cid === "string" ? current!.cid : null } : null;
}

/**
 * A note's screening state. `pool` is the note's pool as this device read it (null-scope: never read yet, no state);
 * `status` its activeASPStatus; `activity` its activePoolActivity. A change note keeps its deposit's label, so it is
 * judged by that deposit. The status answer's record of the current root ({ root, cid }, input-less like asp.set) helps
 * only a device whose events lack that root's event, and only when it rebuilds to the root on-chain. `announcedSince`:
 * that chain's time when this device first saw the operator announce this deposit's exclusion (the reader keeps it in
 * memory for the session), for the "overdue" words only.
 */
export function noteScreening(i: {
  label: bigint;
  chainId: number;
  pool: Pick<PoolState, "scope" | "events" | "aspRoot">;
  status: Pick<ASPStatusState, "entry" | "screening">;
  activity: { entry: Pick<PoolActivityEntry, "activity"> | null; now: number | null };
  announcedSince?: number | null;
}): NoteScreening | null {
  if (i.pool.scope === null) return null;
  const events: readonly PoolEvent[] = i.pool.events;
  const screening = i.status.screening;
  const entry = i.status.entry;
  const own = depositOf(events, i.label);
  const tx = own?.deposit.txHash.toLowerCase() ?? null;
  const dated = tx && i.activity.entry ? i.activity.entry.activity.find((a) => a.kind === "deposit" && a.txHash.toLowerCase() === tx) : undefined;
  const depositTime = dated && Number.isFinite(dated.timestamp) ? dated.timestamp : null;
  const now = i.activity.now !== null && Number.isFinite(i.activity.now) ? i.activity.now : null;
  const delaySeconds = inclusionDelay(screening, i.chainId);
  const canPublish = entry && typeof entry.canPublish === "boolean" ? entry.canPublish : null;
  const record = statusRecord(screening);
  const announcedSince = typeof i.announcedSince === "number" && Number.isFinite(i.announcedSince) ? i.announcedSince : null;
  const state = screeningState({ label: i.label, events, currentRoot: i.pool.aspRoot, screening, canPublish, depositTime, now, delaySeconds, record, announcedSince });
  const announced = announcedExclusions(screening);
  // a lift: due now, or once the edit has settled (no exit advice meanwhile: offersPublicExit); never from an answer
  // whose list could not be read
  const readmitted =
    state.kind === "excluded" &&
    state.listed &&
    !!screening &&
    !!own &&
    screening.exclusions !== "invalid" &&
    (screening.rootDue || screening.settling === true) &&
    typeof screening.readmitted === "number" &&
    screening.readmitted > 0 &&
    !announced.has(i.label) &&
    own.ordinal < screening.snapshot.considered;
  return {
    state,
    screening,
    delaySeconds,
    depositTime,
    eligibleAt: depositTime !== null ? depositTime + delaySeconds : null,
    now,
    depositor: own ? own.deposit.depositor.toLowerCase() : null,
    canPublish,
    publishBlock: entry && canPublish === false ? (entry.publishBlock ?? null) : null,
    announcedReason: announced.get(i.label)?.reason ?? null,
    readmitted,
    rootPosted: i.pool.aspRoot !== 0n,
  };
}

/**
 * "Excluded: use the public exit" and the Ragequit emphasis: only for a note that still holds value and whose
 * deposit the chain itself shows excluded (a leaf in the verified current root's exclusions, or a member an earlier
 * root counted that the current one dropped). Never for a spent or empty note, an exclusion the operator only
 * announces (removal_announced, or waiting with an announcement), or one it is lifting (readmitted): the public exit
 * names the depositor, so an answer that may differ per visitor must never lead anyone to it.
 */
export function offersPublicExit(note: Pick<Note, "spent" | "value">, s: NoteScreening | null): boolean {
  return !!s && s.state.kind === "excluded" && !s.readmitted && !note.spent && note.value > 0n;
}

/**
 * Why the Withdraw form holds a note back before anything is sent (null: it does not). A hold sends nothing, so it
 * reveals nothing. The form lets a private withdrawal start only for a deposit that this device's own check of the
 * current root on-chain shows in the set, and that the operator does not announce for exclusion. Everything else is
 * held, however the operator's status answer words it: that answer can differ for each visitor, so if a field of it
 * (the snapshot's n, the delay, a lifted exclusion, the deposit times of privacy.poolActivity) could let one note start
 * an attempt that then fails after the label-free publish request, the operator would learn which note this visitor
 * holds. A deposit that is eligible joins with the next root the publisher posts (on its schedule, or on another
 * withdrawal's request), and only then can it leave privately.
 *   - delay: inside the inclusion delay;
 *   - next_root: eligible, waiting for the next root;
 *   - announced: the operator announces its exclusion before it entered a root (it never will while listed), or a
 *     server's record of the current root lists it (the operator's claim until this device sees the root's own event);
 *   - excluded: this device's own record of the verified current root excludes it;
 *   - readmitted: excluded on-chain, but the operator says it is lifting the exclusion (the next root shows it);
 *   - removal_announced: the operator announces the removal of a member (this app fails closed: REMOVAL_ANNOUNCED);
 *   - checking: this device is still reading the newest root (its copy of the pool is catching up);
 *   - unverified: the newest root does not verify on this device;
 *   - outdated: the current root follows a newer policy than this app knows (reload the page).
 */
export type WithdrawHold = "delay" | "next_root" | "announced" | "excluded" | "readmitted" | "removal_announced" | "checking" | "unverified" | "outdated";

export function withdrawHold(s: NoteScreening | null): WithdrawHold | null {
  if (!s) return null;
  const st = s.state;
  switch (st.kind) {
    case "in_set":
      return null;
    case "waiting":
      return st.announced ? "announced" : st.why === "delay" ? "delay" : "next_root";
    case "excluded":
      return s.readmitted ? "readmitted" : "excluded";
    case "removal_announced":
      return "removal_announced";
    case "unverified":
      return st.problem === "outdated" ? "outdated" : st.problem === "missing_deposits" || st.problem === "no_record" ? "checking" : "unverified";
    case "unknown":
      return "checking";
  }
}
