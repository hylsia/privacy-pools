/**
 * client/src/privacy/publicData.ts: the active pool's entry, picked from answers every visitor fetches alike
 * (final design §5 "Selectors"). The same deployer gives a pool the same address on two chains, so every case
 * here has the same address on two chains. Also the Phase 4 screening pieces the vault reads: the publisher's status
 * entry (activeASPStatus), the publish decision (publishNeeded with rootDue), and a note's screening state with what
 * the forms may offer for it (noteScreening, offersPublicExit, withdrawHold).
 */
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import type {
  ASPScreening,
  ASPStatusAnswer,
  ASPStatusEntry,
  ExcludedDeposit,
  PoolActivityAnswer,
  PoolActivityEntry,
  PoolsAnswer,
  PoolSummaryEntry,
} from "../../shared/privacy/api";
import { associationSetLabels, buildAssociationSet, previewAssociationSet } from "../../shared/privacy/associationSet";
import type { Note } from "../../shared/privacy/notes";
import { formatRecipe, recipeLabels, setRoot } from "../../shared/privacy/screening";
import type { ASPRootUpdatedEvent, DepositedEvent, PoolEvent } from "../../shared/privacy/types";
import {
  activeASPStatus,
  activePoolActivity,
  activePoolSize,
  announcedSinceOf,
  ASP_STATUS_MAX_AGE_MS,
  ASP_STATUS_SCHEDULE,
  forgetAnnouncedSightings,
  inclusionDelay,
  noteScreening,
  offersPublicExit,
  POOL_ACTIVITY_SCHEDULE,
  publishBlocked,
  publishNeeded,
  statusRecord,
  withdrawHold,
  type ASPStatusState,
} from "../../client/src/privacy/publicData";
import type { PoolState } from "../../client/src/privacy/PrivacyProvider";
import { MULTI_NETWORK } from "../../client/src/privacy/config";
import { firstRootClause, holdBlocker, screeningLine } from "../../client/src/components/privacy/Screening";

const POOL = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const OTHER = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const A = { chainId: 46630, pool: POOL };
const B = { chainId: 31338, pool: POOL };
const tx = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as const;

function activity(chainId: number, pool: Address, now: number, blocks: number[]): PoolActivityEntry {
  return {
    chainId,
    pool,
    now,
    activity: blocks.map((b, i) => ({
      kind: "deposit" as const,
      value: 10n ** 17n,
      fee: 0n,
      account: OTHER,
      relayer: null,
      txHash: tx(chainId * 1000 + i),
      blockNumber: BigInt(b),
      timestamp: now - 600 + i,
    })),
  };
}

const activityAnswer = (pools: PoolActivityEntry[], unavailable: PoolActivityAnswer["unavailable"] = []): PoolActivityAnswer => ({
  now: 1_900_000_000,
  pools,
  unavailable,
});

function summary(chainId: number, pool: Address, o: { published: number; all: number; rootPublished?: boolean }): PoolSummaryEntry {
  return { chainId, pool, aspRootMembers: o.published, aspRootPublished: o.rootPublished ?? o.published > 0, deposits: o.all, now: 0 } as PoolSummaryEntry;
}

const poolsAnswer = (pools: PoolSummaryEntry[], unavailable: PoolsAnswer["unavailable"] = []): PoolsAnswer => ({
  now: 1_900_000_000,
  networks: [
    { chainId: 46630, pool: POOL },
    { chainId: 31338, pool: POOL },
  ],
  pools,
  unavailable,
});

describe("activePoolActivity", () => {
  const onA = activity(46630, POOL, 1_800_000_000, [10, 11]);
  const onB = activity(31338, POOL, 1_700_000_000, [7_000_000]);

  it("picks the entry of the active chain AND address, with that chain's own time", () => {
    const answer = activityAnswer([onA, onB]);
    const a = activePoolActivity(answer, false, A, 1_000_000, 1_000_000);
    expect(a.times).toBe("ready");
    expect(a.entry).toBe(onA);
    expect(a.now).toBe(1_800_000_000);
    const b = activePoolActivity(answer, false, B, 1_000_000, 1_000_000);
    expect(b.entry).toBe(onB);
    expect(b.now).toBe(1_700_000_000); // never the other chain's head time, never the server clock
  });

  it("moves `now` on by whole seconds since the fetch, never backwards", () => {
    const answer = activityAnswer([onA]);
    expect(activePoolActivity(answer, false, A, 10_000, 10_000 + 61_900).now).toBe(1_800_000_061);
    expect(activePoolActivity(answer, false, A, 10_000, 5_000).now).toBe(1_800_000_000);
  });

  it("is unavailable when only the same address on the other chain is listed", () => {
    const r = activePoolActivity(activityAnswer([onB]), false, A, 0, 0);
    expect(r).toEqual({ entry: null, now: null, times: "unavailable" });
    expect(activePoolActivity(activityAnswer([activity(46630, OTHER, 1, [1])]), false, A, 0, 0).times).toBe("unavailable");
  });

  it("is unavailable when the pool is listed under unavailable (by pool, or chain-wide)", () => {
    expect(activePoolActivity(activityAnswer([onA], [{ chainId: 46630, pool: POOL, reason: "rpc_error" }]), false, A, 0, 0).times).toBe("unavailable");
    expect(activePoolActivity(activityAnswer([onA], [{ chainId: 46630, pool: null, reason: "config_error" }]), false, A, 0, 0).times).toBe("unavailable");
    // the other chain being down changes nothing here
    const r = activePoolActivity(activityAnswer([onA], [{ chainId: 31338, pool: POOL, reason: "rpc_error" }]), false, A, 0, 0);
    expect(r.times).toBe("ready");
  });

  it("is loading before the first answer, unavailable when that fetch failed or there is no pool", () => {
    expect(activePoolActivity(undefined, false, A, 0, 0)).toEqual({ entry: null, now: null, times: "loading" });
    expect(activePoolActivity(undefined, true, A, 0, 0)).toEqual({ entry: null, now: null, times: "unavailable" });
    expect(activePoolActivity(undefined, false, null, 0, 0).times).toBe("unavailable");
    expect(activePoolActivity(activityAnswer([onA]), false, null, 0, 0).times).toBe("unavailable");
  });

  it("keeps using an earlier answer after a failed refetch (dated from that fetch)", () => {
    const r = activePoolActivity(activityAnswer([onA]), true, A, 0, 30_000);
    expect(r.times).toBe("ready");
    expect(r.now).toBe(1_800_000_030);
  });

  it("fails closed on an answer of another shape (a single-pool server)", () => {
    const old = { chainId: 46630, now: 1, pool: POOL, activity: [] } as unknown as PoolActivityAnswer;
    expect(activePoolActivity(old, false, A, 0, 0).times).toBe("unavailable");
    const noNow = activityAnswer([{ ...onA, now: Number.NaN }]);
    expect(activePoolActivity(noNow, false, A, 0, 0).times).toBe("unavailable");
  });

  it("matches the address in any case", () => {
    const lower = { chainId: 46630, pool: POOL.toLowerCase() as Address };
    expect(activePoolActivity(activityAnswer([onA]), false, lower, 0, 0).entry).toBe(onA);
  });

  it("has one schedule for every visitor", () => {
    expect(POOL_ACTIVITY_SCHEDULE).toEqual({ staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: false });
  });
});

describe("activePoolSize", () => {
  const answer = poolsAnswer([summary(46630, POOL, { published: 12, all: 15 }), summary(31338, POOL, { published: 3, all: 4 })]);

  it("is the active pool's own row, never a sum and never the other network's", () => {
    expect(activePoolSize(answer, false, A)).toEqual({ status: "ready", published: 12, rootPublished: true, all: 15 });
    expect(activePoolSize(answer, false, B)).toEqual({ status: "ready", published: 3, rootPublished: true, all: 4 });
  });

  it("keeps the fix stage's shape before a root is published", () => {
    const fresh = poolsAnswer([summary(46630, POOL, { published: 0, all: 2, rootPublished: false })]);
    expect(activePoolSize(fresh, false, A)).toEqual({ status: "ready", published: 0, rootPublished: false, all: 2 });
  });

  it("is unavailable without a matching row, or when the pool is listed under unavailable", () => {
    expect(activePoolSize(poolsAnswer([summary(31338, POOL, { published: 3, all: 4 })]), false, A)).toEqual({ status: "unavailable" });
    expect(activePoolSize(poolsAnswer([summary(46630, POOL, { published: 1, all: 1 })], [{ chainId: 46630, pool: POOL, reason: "wrong_chain" }]), false, A)).toEqual({
      status: "unavailable",
    });
    expect(activePoolSize(answer, false, null)).toEqual({ status: "unavailable" });
  });

  it("is loading before the first answer, unavailable when it failed", () => {
    expect(activePoolSize(undefined, false, A)).toEqual({ status: "loading" });
    expect(activePoolSize(undefined, true, A)).toEqual({ status: "unavailable" });
    expect(activePoolSize(answer, true, A).status).toBe("ready");
  });
});

// ─── publishNeeded ────────────────────────────────────────────────────────────

function deposit(label: bigint, leafIndex: number): DepositedEvent {
  return {
    kind: "deposit",
    depositor: OTHER,
    commitment: 1000n + label,
    label,
    value: 10n ** 17n,
    precommitment: 2000n + label,
    leafIndex,
    blockNumber: BigInt(10 + leafIndex),
    txHash: tx(leafIndex + 1),
    logIndex: 0,
  };
}

function state(events: PoolEvent[], aspRoot: bigint, status: PoolState["status"] = "ready"): PoolState {
  return {
    status,
    scope: 1n,
    aspRoot,
    lastRoot: 0n,
    leafCount: events.length,
    dead: false,
    minDeposit: 0n,
    events,
    lastBlock: 20n,
    tree: null,
    inSync: true,
    syncedAt: 0,
  };
}

describe("publishNeeded", () => {
  const events = [deposit(11n, 0), deposit(22n, 1)];
  const covering = buildAssociationSet(associationSetLabels(events)).roots[2];
  const older = buildAssociationSet(associationSetLabels(events)).roots[1];

  it("is false when every ready pool's current root covers its deposits", () => {
    expect(publishNeeded([state(events, covering), state([], 0n)])).toBe(false);
  });

  it("is true when any ready pool's root is behind (another network's pool counts too)", () => {
    expect(publishNeeded([state(events, older)])).toBe(true);
    expect(publishNeeded([state(events, covering), state([deposit(33n, 0)], 0n)])).toBe(true);
  });

  it("ignores pools that are not synced, and pools without deposits", () => {
    expect(publishNeeded([state(events, 0n, "loading"), state(events, 0n, "error"), state(events, 0n, "idle")])).toBe(false);
    expect(publishNeeded([state([], 0n)])).toBe(false);
    expect(publishNeeded([])).toBe(false);
  });

  it("depends on public data only: the same answer whichever pool is active or holds notes", () => {
    const states = [state(events, covering), state([deposit(33n, 0)], 0n)];
    expect(publishNeeded(states)).toBe(publishNeeded([...states].reverse()));
  });
});

// ─── the association-set publisher's status (privacy.asp.status) ───────────────

function screeningBlock(o: Partial<ASPScreening> = {}): ASPScreening {
  return {
    policyVersion: 1,
    delaySeconds: 3_600,
    confirmations: 1,
    autoPublish: { running: true, seconds: 600 },
    exclusions: "ok",
    snapshot: { asOfBlock: "20", asOfTime: 1_800_000_000, considered: 0, memberCount: 0, waiting: 0, root: "0", cid: null },
    current: null,
    rootDue: false,
    readmitted: 0,
    excluded: [],
    ...o,
  };
}

function statusEntry(chainId: number, pool: Address, o: { screening?: unknown; canPublish?: boolean } = {}): ASPStatusEntry {
  return {
    chainId,
    pool,
    confirmations: 1,
    memberCount: 0,
    localRoot: "0",
    onChainRoot: "0",
    onChainIsCurrent: true,
    canPublish: o.canPublish ?? true,
    publishBlock: o.canPublish === false ? "publisher_unfunded" : null,
    head: "20",
    ...(o.screening !== undefined ? { screening: o.screening as ASPScreening } : {}),
  };
}

const statusAnswer = (pools: ASPStatusEntry[], unavailable: ASPStatusAnswer["unavailable"] = []): ASPStatusAnswer => ({ pools, unavailable });

describe("activeASPStatus", () => {
  const onA = statusEntry(46630, POOL, { screening: screeningBlock({ delaySeconds: 3_600 }) });
  const onB = statusEntry(31338, POOL, { screening: screeningBlock({ delaySeconds: 0 }) });

  it("picks the entry of the active chain AND address, with its own screening block", () => {
    const answer = statusAnswer([onA, onB]);
    const a = activeASPStatus(answer, false, A, 1_000, 1_000);
    expect(a.status).toBe("ready");
    expect(a.entry).toBe(onA);
    expect(a.screening?.delaySeconds).toBe(3_600);
    const b = activeASPStatus(answer, false, B, 1_000, 1_000);
    expect(b.entry).toBe(onB);
    expect(b.screening?.delaySeconds).toBe(0);
    // the same address on the other chain is not this pool
    expect(activeASPStatus(statusAnswer([onB]), false, A, 0, 0)).toEqual({ status: "unavailable", entry: null, screening: null });
    expect(activeASPStatus(statusAnswer([statusEntry(46630, OTHER)]), false, A, 0, 0).status).toBe("unavailable");
  });

  it("uses an answer for at most ASP_STATUS_MAX_AGE_MS (two missed refetches), a failed refetch included", () => {
    const answer = statusAnswer([onA]);
    expect(ASP_STATUS_MAX_AGE_MS).toBe(120_000);
    expect(activeASPStatus(answer, false, A, 0, ASP_STATUS_MAX_AGE_MS).status).toBe("ready");
    expect(activeASPStatus(answer, true, A, 0, 61_000).status).toBe("ready");
    expect(activeASPStatus(answer, true, A, 0, ASP_STATUS_MAX_AGE_MS + 1)).toEqual({ status: "unavailable", entry: null, screening: null });
    expect(activeASPStatus(answer, false, A, 0, Number.NaN).status).toBe("unavailable");
  });

  it("is loading before the first answer; unavailable when that fetch failed, without a pool, or listed unavailable", () => {
    expect(activeASPStatus(undefined, false, A, 0, 0)).toEqual({ status: "loading", entry: null, screening: null });
    expect(activeASPStatus(undefined, true, A, 0, 0).status).toBe("unavailable");
    expect(activeASPStatus(undefined, false, null, 0, 0).status).toBe("unavailable");
    expect(activeASPStatus(statusAnswer([onA]), false, null, 0, 0).status).toBe("unavailable");
    expect(activeASPStatus(statusAnswer([onA], [{ chainId: 46630, pool: POOL, reason: "rpc_error" }]), false, A, 0, 0).status).toBe("unavailable");
    expect(activeASPStatus(statusAnswer([onA], [{ chainId: 46630, pool: null, reason: "config_error" }]), false, A, 0, 0).status).toBe("unavailable");
    expect(activeASPStatus(statusAnswer([onA], [{ chainId: 31338, pool: POOL, reason: "rpc_error" }]), false, A, 0, 0).status).toBe("ready");
  });

  it("reads an entry without a screening block (an older server), or one of another shape, as on-chain data only", () => {
    expect(activeASPStatus(statusAnswer([statusEntry(46630, POOL)]), false, A, 0, 0)).toMatchObject({ status: "ready", screening: null });
    const odd = statusEntry(46630, POOL, { screening: { rootDue: "yes", delaySeconds: 3_600 } });
    expect(activeASPStatus(statusAnswer([odd]), false, A, 0, 0)).toMatchObject({ status: "ready", screening: null });
    const old = { chainId: 46630, pool: POOL, memberCount: 1 } as unknown as ASPStatusAnswer;
    expect(activeASPStatus(old, false, A, 0, 0).status).toBe("unavailable");
  });

  it("has one schedule for every visitor (on open, then every minute, never on focus)", () => {
    expect(ASP_STATUS_SCHEDULE).toEqual({ staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: false, retry: 1 });
  });
});

describe("publishNeeded with the operator's rootDue", () => {
  const events = [deposit(11n, 0), deposit(22n, 1)];
  const covering = buildAssociationSet(associationSetLabels(events)).roots[2];
  const older = buildAssociationSet(associationSetLabels(events)).roots[1];

  it("follows a pool's fresh rootDue instead of the open rule", () => {
    // the root is behind the deposits, but the newer deposit is still inside the inclusion delay: nothing is due
    expect(publishNeeded([state(events, older)], [screeningBlock({ rootDue: false })])).toBe(false);
    // the root covers every deposit, but the operator removes one (an exclusion): a new root is due
    expect(publishNeeded([state(events, covering)], [screeningBlock({ rootDue: true })])).toBe(true);
    // the first root of a pool whose deposits are all past the delay
    expect(publishNeeded([state(events, 0n)], [screeningBlock({ rootDue: true })])).toBe(true);
  });

  it("falls back to the open rule, per pool, without a valid screening block", () => {
    expect(publishNeeded([state(events, covering), state(events, older)], [screeningBlock({ rootDue: false }), null])).toBe(true);
    expect(publishNeeded([state(events, older)], [{ rootDue: false } as unknown as ASPScreening])).toBe(true);
    expect(publishNeeded([state(events, covering)], [undefined])).toBe(false);
  });

  it("ignores pools that are not synced, whatever their answer says", () => {
    expect(publishNeeded([state(events, older, "loading"), state(events, older, "error")], [screeningBlock({ rootDue: true }), screeningBlock({ rootDue: true })])).toBe(
      false,
    );
  });
});

describe("inclusionDelay and statusRecord", () => {
  it("takes the screening answer's delay, else the registry's", () => {
    expect(inclusionDelay(screeningBlock({ delaySeconds: 120 }), 46630)).toBe(120);
    expect(inclusionDelay(screeningBlock({ delaySeconds: 0 }), 46630)).toBe(0);
    expect(inclusionDelay(null, 46630)).toBe(3_600);
    expect(inclusionDelay(null, 31338)).toBe(0);
    expect(inclusionDelay(null, 1)).toBe(3600);
    expect(inclusionDelay(null, 999)).toBe(0);
    expect(inclusionDelay({ delaySeconds: -5 }, 46630)).toBe(3_600);
    expect(inclusionDelay(undefined, null)).toBe(0);
  });

  it("reads the current root's record only from a decimal root", () => {
    const current = { root: "123", cid: "hylsia-asp:v1;n=1;x=;asOf=1;t=1;delay=0;conf=1", status: "verified" as const, considered: 1, memberCount: 1 };
    expect(statusRecord(screeningBlock({ current }))).toEqual({ root: 123n, cid: current.cid });
    expect(statusRecord(screeningBlock({ current: { ...current, cid: null } }))).toEqual({ root: 123n, cid: null });
    expect(statusRecord(screeningBlock({ current: { ...current, root: "0x7b" } }))).toBeNull();
    expect(statusRecord(screeningBlock({ current: null }))).toBeNull();
    expect(statusRecord(null)).toBeNull();
  });
});

// ─── a note's screening state, and what the forms offer for it ────────────────

describe("noteScreening, offersPublicExit and withdrawHold", () => {
  const NOW = 1_800_000_000;
  const BOB = "0x00000000000000000000000000000000000000B0" as Address;
  // five deposits: d0, d2 are members of the current root; d1 is in its exclusions; d3, d4 came after its n = 3
  const d = [deposit(101n, 0), deposit(102n, 1), { ...deposit(103n, 2), depositor: BOB }, deposit(104n, 3), deposit(105n, 4)];
  const recipe = { version: 1 as const, considered: 3, excludedLeaves: [1], asOfBlock: 29n, asOfTime: NOW - 100, delaySeconds: 3_600, confirmations: 1 };
  const root = setRoot(recipeLabels(d, recipe)!);
  const cid = formatRecipe(recipe);
  const post: ASPRootUpdatedEvent = { kind: "asproot", root, cid, blockNumber: 30n, txHash: tx(99) as Hex, logIndex: 0 };
  const events: PoolEvent[] = [...d, post];
  const pool = { scope: 1n, events, aspRoot: root };
  // the deposits' block times, in the public activity list (matched by transaction hash)
  const times = [NOW - 20_000, NOW - 20_000, NOW - 20_000, NOW - 600, NOW - 4_000];
  const list = activity(31338, POOL, NOW, []);
  list.activity = d.map((e, i) => ({ ...activity(31338, POOL, NOW, [Number(e.blockNumber)]).activity[0], txHash: e.txHash, timestamp: times[i] }));
  const base = screeningBlock({ delaySeconds: 3_600, snapshot: { asOfBlock: "40", asOfTime: NOW, considered: 3, memberCount: 2, waiting: 2, root: root.toString(), cid } });

  const screen = (label: bigint, screening: ASPScreening | null = base, o: { canPublish?: boolean; events?: PoolEvent[]; scope?: bigint | null } = {}) => {
    const status: Pick<ASPStatusState, "entry" | "screening"> = {
      entry: statusEntry(31338, POOL, { screening: screening ?? undefined, canPublish: o.canPublish }),
      screening,
    };
    return noteScreening({
      label,
      chainId: 31338,
      pool: { ...pool, events: o.events ?? events, scope: o.scope === undefined ? pool.scope : o.scope },
      status,
      activity: { entry: list, now: NOW },
    });
  };
  const note = (o: Partial<Pick<Note, "spent" | "value">> = {}) => ({ spent: false, value: 10n ** 17n, ...o });
  const excludedItem = (e: DepositedEvent, considered: boolean): ExcludedDeposit => ({
    leafIndex: e.leafIndex,
    label: e.label.toString(),
    reason: "test",
    considered,
  });

  it("a member of the verified current root is in the set: nothing to hold, no public exit", () => {
    const s = screen(101n)!;
    expect(s.state).toEqual({ kind: "in_set", size: 2, next: null });
    expect(withdrawHold(s)).toBeNull();
    expect(offersPublicExit(note(), s)).toBe(false);
    expect(s.depositor).toBe(OTHER.toLowerCase());
    expect(screen(103n)!.depositor).toBe(BOB.toLowerCase());
  });

  it("a deposit inside the delay waits for screening (held back, its eligibility from its own block time)", () => {
    const s = screen(104n)!;
    expect(s.state).toMatchObject({ kind: "waiting", why: "delay", announced: false });
    expect(s.depositTime).toBe(NOW - 600);
    expect(s.eligibleAt).toBe(NOW - 600 + 3_600);
    expect(s.now).toBe(NOW);
    expect(withdrawHold(s)).toBe("delay");
    expect(offersPublicExit(note(), s)).toBe(false);
  });

  it("an eligible deposit waits for the next root: held too (only a member of the root on-chain starts a withdrawal)", () => {
    const s = screen(105n)!;
    expect(s.state).toMatchObject({ kind: "waiting", why: "next_root" });
    expect(withdrawHold(s)).toBe("next_root");
    expect(offersPublicExit(note(), s)).toBe(false);
  });

  it("no field of a per-visitor answer lifts the hold of a note the root on-chain does not hold", () => {
    // what an operator could tell one visitor to make one waiting note look ready: its snapshot already counts it, a
    // delay of 0, an exclusion being lifted, an old deposit time; the note stays held whatever it says
    const lies: ASPScreening[] = [
      screeningBlock({ ...base, rootDue: true, snapshot: { ...base.snapshot, considered: 5, memberCount: 4 } }),
      screeningBlock({ ...base, delaySeconds: 0 }),
      screeningBlock({ ...base, rootDue: true, readmitted: 1, snapshot: { ...base.snapshot, considered: 5, memberCount: 5 } }),
    ];
    for (const label of [104n, 105n]) for (const lie of lies) expect(withdrawHold(screen(label, lie))).not.toBeNull();
    const oldTimes = { ...list, activity: list.activity.map((a) => ({ ...a, timestamp: NOW - 100_000 })) };
    const s = noteScreening({ label: 104n, chainId: 31338, pool, status: { entry: null, screening: base }, activity: { entry: oldTimes, now: NOW } })!;
    expect(s.state).toMatchObject({ kind: "waiting", why: "next_root" });
    expect(withdrawHold(s)).toBe("next_root");
    // and an excluded note stays held while the operator says it lifts the exclusion
    expect(withdrawHold(screen(102n, lies[2]))).toBe("readmitted");
  });

  it("a deposit the chain shows excluded offers the public exit, but never for a spent or empty note", () => {
    const s = screen(102n)!;
    expect(s.state).toMatchObject({ kind: "excluded", listed: true, reason: null });
    expect(withdrawHold(s)).toBe("excluded");
    expect(offersPublicExit(note(), s)).toBe(true);
    expect(offersPublicExit(note({ spent: true }), s)).toBe(false);
    expect(offersPublicExit(note({ value: 0n }), s)).toBe(false);
    // with an older server (no screening answer) the chain's own exclusion still shows; the reason only decorates it
    expect(offersPublicExit(note(), screen(102n, null))).toBe(true);
    const reasoned = screen(102n, screeningBlock({ ...base, excluded: [excludedItem(d[1], true)] }))!;
    expect(reasoned.state).toMatchObject({ kind: "excluded", reason: "test" });
  });

  it("an exclusion the operator only announces never offers the public exit (it holds the app back)", () => {
    // a member of the verified root: removal announced, not excluded
    const member = screen(101n, screeningBlock({ ...base, rootDue: true, excluded: [excludedItem(d[0], true)] }))!;
    expect(member.state).toMatchObject({ kind: "removal_announced", reason: "test" });
    expect(member.announcedReason).toBe("test");
    expect(withdrawHold(member)).toBe("removal_announced");
    expect(offersPublicExit(note(), member)).toBe(false);
    // a deposit beyond n: waiting, with the exclusion announced
    const later = screen(104n, screeningBlock({ ...base, excluded: [excludedItem(d[3], false)] }))!;
    expect(later.state).toMatchObject({ kind: "waiting", announced: true });
    expect(withdrawHold(later)).toBe("announced");
    expect(offersPublicExit(note(), later)).toBe(false);
  });

  it("a lifted exclusion (the operator's snapshot admits it again) offers no exit, and stays held until a root holds it", () => {
    const lifting = screeningBlock({ ...base, rootDue: true, readmitted: 1, snapshot: { ...base.snapshot, considered: 5, memberCount: 5 } });
    const s = screen(102n, lifting)!;
    expect(s.state.kind).toBe("excluded");
    expect(s.readmitted).toBe(true);
    expect(withdrawHold(s)).toBe("readmitted");
    expect(offersPublicExit(note(), s)).toBe(false);
    // still named on the list: not lifted
    const named = screen(102n, screeningBlock({ ...lifting, excluded: [excludedItem(d[1], true)] }))!;
    expect(named.readmitted).toBe(false);
    expect(offersPublicExit(note(), named)).toBe(true);
    // no root due: nothing is being lifted
    expect(screen(102n, screeningBlock({ ...lifting, rootDue: false }))!.readmitted).toBe(false);
  });

  it("a lift is a lift during the 30 s settle too: no public exit for a deposit the operator says it re-admits (round 2)", () => {
    // the operator removed the entry a moment ago: the answer holds the root back while the edit settles
    const settling = screeningBlock({ ...base, rootDue: false, settling: true, readmitted: 1, snapshot: { ...base.snapshot, considered: 5, memberCount: 5 } });
    const s = screen(102n, settling)!;
    expect(s.state.kind).toBe("excluded");
    expect(s.readmitted).toBe(true);
    expect(offersPublicExit(note(), s)).toBe(false);
    expect(withdrawHold(s)).toBe("readmitted");
    // neither due nor settling: not being lifted
    expect(screen(102n, screeningBlock({ ...settling, settling: false }))!.readmitted).toBe(false);
  });

  it("an answer whose list could not be read never lifts anything: the chain's exclusion keeps its public exit (round 2)", () => {
    // after a restart without the list: nothing announced, and a snapshot that (on an older server) re-admits it
    const lost = screeningBlock({ ...base, exclusions: "invalid", rootDue: true, readmitted: 1, snapshot: { ...base.snapshot, considered: 5, memberCount: 5 } });
    const s = screen(102n, lost)!;
    expect(s.state).toMatchObject({ kind: "excluded", listed: true });
    expect(s.readmitted).toBe(false);
    expect(offersPublicExit(note(), s)).toBe(true);
    expect(withdrawHold(s)).toBe("excluded");
  });

  it("an announced removal is timed from when this device first saw it, never from a time the operator sends (round 2)", () => {
    const current = { root: root.toString(), cid, status: "verified" as const, considered: 3, memberCount: 2 };
    const answer = screeningBlock({ ...base, rootDue: true, current, excluded: [excludedItem(d[0], true)] });
    const at = (announcedSince: number | null) =>
      noteScreening({ label: 101n, chainId: 31338, pool, status: { entry: statusEntry(31338, POOL, { screening: answer }), screening: answer }, activity: { entry: list, now: NOW }, announcedSince })!;
    expect(at(NOW - 60).state).toMatchObject({ kind: "removal_announced", overdue: false });
    expect(at(NOW - 600 - 30 - 121).state).toMatchObject({ kind: "removal_announced", overdue: true });
    expect(at(null).state).toMatchObject({ kind: "removal_announced", overdue: false });
    // an older server's `since` is not read
    const old = screeningBlock({ ...answer, excluded: [{ ...excludedItem(d[0], true), since: NOW - 100_000 } as ExcludedDeposit] });
    expect(noteScreening({ label: 101n, chainId: 31338, pool, status: { entry: null, screening: old }, activity: { entry: list, now: NOW } })!.state).toMatchObject({ overdue: false });
    // and whether the pool has a root at all (the words for a first root)
    expect(at(null).rootPosted).toBe(true);
    expect(screen(104n, base, { events: d.slice() })!.rootPosted).toBe(true);
    expect(noteScreening({ label: 104n, chainId: 31338, pool: { ...pool, aspRoot: 0n }, status: { entry: null, screening: base }, activity: { entry: list, now: NOW } })!.rootPosted).toBe(false);
  });

  it("without a screening answer the registry's delay applies (local chain: 0, so eligible at once)", () => {
    const s = screen(104n, null)!;
    expect(s.delaySeconds).toBe(0);
    expect(s.state).toMatchObject({ kind: "waiting", why: "next_root" });
    expect(withdrawHold(s)).toBe("next_root");
  });

  it("dates a deposit only by its own transaction in this pool's list (no block read)", () => {
    const other = { ...list, activity: list.activity.map((a) => ({ ...a, txHash: tx(5_000 + Number(a.blockNumber)) })) };
    const s = noteScreening({ label: 104n, chainId: 31338, pool, status: { entry: null, screening: base }, activity: { entry: other, now: NOW } })!;
    expect(s.depositTime).toBeNull();
    expect(s.eligibleAt).toBeNull();
    expect(s.state).toMatchObject({ kind: "waiting", why: "delay" });
  });

  it("a device without the root's event uses the status answer's record of it, only when it rebuilds to the root", () => {
    const lagging = d.slice();
    const withRecord = screeningBlock({ ...base, current: { root: root.toString(), cid, status: "verified", considered: 3, memberCount: 2 } });
    expect(screen(101n, withRecord, { events: lagging })!.state).toMatchObject({ kind: "in_set", size: 2 });
    // without a record it cannot be checked yet: shown as checking, and held until this device has checked it
    const unchecked = screen(101n, base, { events: lagging })!;
    expect(unchecked.state).toEqual({ kind: "unverified", problem: "no_record" });
    expect(withdrawHold(unchecked)).toBe("checking");
    // a record whose cid does not rebuild to the root is not taken
    const wrong = screeningBlock({ ...base, current: { root: root.toString(), cid: formatRecipe({ ...recipe, excludedLeaves: [] }), status: "verified", considered: 3, memberCount: 3 } });
    expect(screen(101n, wrong, { events: lagging })!.state).toMatchObject({ kind: "unverified", problem: "root" });
    expect(withdrawHold(screen(101n, wrong, { events: lagging }))).toBe("unverified");
    // the status answer's record proves membership, but its exclusions are the operator's claim: never the public exit
    const listed = screen(102n, withRecord, { events: lagging })!;
    expect(listed.state).toMatchObject({ kind: "waiting", announced: true });
    expect(offersPublicExit(note(), listed)).toBe(false);
    expect(withdrawHold(listed)).toBe("announced");
    // with the root's own event the same deposit is excluded on-chain
    expect(offersPublicExit(note(), screen(102n, withRecord))).toBe(true);
    // a record that splits the same root another way (n=4, x={d3}: deposit 3 "excluded") changes nothing on-chain
    const split = formatRecipe({ ...recipe, considered: 4, excludedLeaves: [1, 3] });
    const splitBlock = screeningBlock({ ...base, current: { root: root.toString(), cid: split, status: "verified", considered: 4, memberCount: 2 } });
    const tail = screen(104n, splitBlock, { events: lagging })!;
    expect(tail.state).toMatchObject({ kind: "waiting", announced: true });
    expect(offersPublicExit(note(), tail)).toBe(false);
  });

  it("says nothing before the pool was read, and holds no note of an outdated policy back silently", () => {
    expect(screen(101n, base, { scope: null })).toBeNull();
    const v2 = { ...post, cid: "hylsia-asp:v2;anything" };
    const s = screen(101n, base, { events: [...d, v2] })!;
    expect(s.state).toEqual({ kind: "unverified", problem: "outdated" });
    expect(withdrawHold(s)).toBe("outdated");
  });
});

// ─── review round 3 ───────────────────────────────────────────────────────────

/** A pool with a verified v1 root over its first `n` deposits (labels from `first`), posted at block 50. */
function v1Pool(first: bigint, count: number, n: number) {
  const d = Array.from({ length: count }, (_, i) => deposit(first + BigInt(i), i));
  const recipe = { version: 1 as const, considered: n, excludedLeaves: [], asOfBlock: 40n, asOfTime: 1_800_000_000, delaySeconds: 0, confirmations: 1 };
  const root = setRoot(recipeLabels(d, recipe)!);
  const cid = formatRecipe(recipe);
  const events: PoolEvent[] = [...d, { kind: "asproot", root, cid, blockNumber: 50n, txHash: tx(77) as Hex, logIndex: 0 }];
  const current = { root: root.toString(), cid, status: "verified" as const, considered: n, memberCount: n };
  return { d, root, events, current };
}
const announceAll = (ds: DepositedEvent[]): ExcludedDeposit[] => ds.map((e) => ({ leafIndex: e.leafIndex, label: e.label.toString(), reason: "fraud", considered: true }));

describe("one status answer covers every network: announcements that shrink one pool's root sharply send no request on any (round 3)", () => {
  // pool A: 12 members; pool B: 3 deposits, a root over the first 2, and a snapshot of all 3 (a root is due)
  const a = v1Pool(500n, 12, 12);
  const allButOne = screeningBlock({ rootDue: true, current: a.current, excluded: announceAll(a.d.slice(1)) }); // 11 of 12: sharp
  const fewer = screeningBlock({ rootDue: true, current: a.current, excluded: announceAll(a.d.slice(1, 3)) }); // 2 of 12: not sharp
  const b = v1Pool(600n, 3, 2);
  const next = { version: 1 as const, considered: 3, excludedLeaves: [], asOfBlock: 45n, asOfTime: 1_800_000_100, delaySeconds: 0, confirmations: 1 };
  const dueB = screeningBlock({
    rootDue: true,
    current: b.current,
    snapshot: { asOfBlock: "45", asOfTime: 1_800_000_100, considered: 3, memberCount: 3, waiting: 0, root: setRoot(recipeLabels(b.d, next)!).toString(), cid: formatRecipe(next) },
  });
  const A_ = state(a.events, a.root);
  const B_ = state(b.events, b.root);

  it("publishNeeded is false on every network while one pool's answer shrinks its root sharply", () => {
    // A alone: its rootDue is not followed (round 2)
    expect(publishNeeded([A_], [allButOne])).toBe(false);
    // B's root is due by the same answer, or B has no fresh answer and its root is behind: still no request (round 3)
    expect(publishNeeded([A_, B_], [allButOne, dueB])).toBe(false);
    expect(publishNeeded([A_, B_], [allButOne, null])).toBe(false);
    expect(publishNeeded([B_, A_], [dueB, allButOne])).toBe(false);
    expect(publishBlocked([A_, B_], [allButOne, dueB])).toBe(true);
    // a few announcements (no sharp drop) are followed, and B's due root sends the request as before
    expect(publishNeeded([A_, B_], [fewer, dueB])).toBe(true);
    expect(publishBlocked([A_, B_], [fewer, dueB])).toBe(false);
    expect(publishNeeded([B_], [dueB])).toBe(true);
    expect(publishNeeded([A_, B_], [screeningBlock({ current: a.current }), dueB])).toBe(true);
    // a pool this device has not synced does not count, either way
    expect(publishNeeded([state(a.events, a.root, "loading"), B_], [allButOne, dueB])).toBe(true);
    expect(publishBlocked([state(a.events, a.root, "loading"), B_], [allButOne, dueB])).toBe(false);
  });

  it("the withdraw form follows: B's form shows its current root's crowd, not the next root's, while the request is blocked", () => {
    const preview = (blocked: boolean) => previewAssociationSet({ label: 600n, events: b.events, currentRoot: b.root, screening: dueB, publishBlocked: blocked });
    expect(preview(false)).toMatchObject({ behind: true, next: 3, nextSize: 3, covered: 2 });
    expect(preview(true)).toMatchObject({ behind: false, next: null, nextSize: null, nextMembers: null, covered: 2 });
    // a snapshot that keeps a member the answer announces: the next root would hold it on-chain, this app does not count it
    const keeps = screeningBlock({ ...dueB, excluded: announceAll(b.d.slice(1, 2)) });
    expect(previewAssociationSet({ label: 600n, events: b.events, currentRoot: b.root, screening: keeps })).toMatchObject({ next: 2, nextSize: 3, covered: 1, announcedOut: 1 });
  });
});

describe("first sightings of an announced exclusion live only with the unlocked vault (round 3)", () => {
  const ref = { chainId: 31338, pool: POOL };
  const announced = screeningBlock({ excluded: [{ leafIndex: 0, label: "101", reason: "test", considered: true }] });

  it("start at the first fresh answer that announces the deposit, and are forgotten on Lock, Forget, a restore or a new vault", () => {
    forgetAnnouncedSightings();
    expect(announcedSinceOf(ref, 101n, announced, 1_000)).toBe(1_000);
    expect(announcedSinceOf(ref, 101n, announced, 1_500)).toBe(1_000);
    expect(announcedSinceOf(ref, 101n, null, 2_000)).toBe(1_000); // no fresh answer: neither started nor ended
    expect(announcedSinceOf({ ...ref, pool: OTHER }, 101n, announced, 2_000)).toBe(2_000); // another pool: its own clock
    forgetAnnouncedSightings(); // what PrivacyProvider calls on Lock, Forget, a restore and a new vault
    expect(announcedSinceOf(ref, 101n, null, 3_000)).toBeNull();
    expect(announcedSinceOf({ ...ref, pool: OTHER }, 101n, null, 3_000)).toBeNull();
    expect(announcedSinceOf(ref, 101n, announced, 3_000)).toBe(3_000); // the clock starts again at the next unlock
    expect(announcedSinceOf(ref, 101n, screeningBlock(), 3_500)).toBeNull(); // no longer announced: gone
    expect(announcedSinceOf(ref, 101n, null, 3_600)).toBeNull();
    expect(announcedSinceOf(ref, 101n, announced, null)).toBeNull(); // no chain time yet: not started
    forgetAnnouncedSightings();
  });
});

describe("the words about the next root claim nothing about a schedule no fresh answer told (round 3)", () => {
  // an eligible deposit (local chain B: no delay) in a pool with no root yet
  const events = [deposit(701n, 0)];
  const pool = { scope: 1n, events, aspRoot: 0n };
  const at = (screening: ASPScreening | null) =>
    noteScreening({ label: 701n, chainId: 31338, pool, status: { entry: screening ? statusEntry(31338, POOL, { screening }) : null, screening }, activity: { entry: null, now: null } })!;
  const words = (s: ReturnType<typeof at>) => `${screeningLine(s, "Local chain B")} | ${holdBlocker({ depositIndex: 0, hop: 0 }, s, "Local chain B")}`;

  it("without a fresh status answer: neither 'no periodic publisher' nor a time", () => {
    const s = at(null);
    expect(s.state).toMatchObject({ kind: "waiting", why: "next_root" });
    expect(words(s)).not.toMatch(/no periodic publisher|within about/);
    expect(words(s)).toMatch(/which the publisher posts/);
    // the pool page's line for its first root says as little
    expect(firstRootClause(null)).not.toMatch(/no periodic publisher/);
  });

  it("with a fresh answer: the schedule it reports", () => {
    const running = at(screeningBlock({ delaySeconds: 0, autoPublish: { running: true, seconds: 600 } }));
    expect(running.state).toMatchObject({ kind: "waiting", why: "next_root" });
    expect(words(running)).toMatch(/within about 10 minutes/);
    const none = words(at(screeningBlock({ delaySeconds: 0, autoPublish: { running: false, seconds: 0 } })));
    expect(none).toMatch(MULTI_NETWORK ? /asks for one/ : /this server runs no periodic publisher/);
    expect(firstRootClause(screeningBlock({ autoPublish: { running: false, seconds: 0 } }))).toMatch(/this server runs no periodic publisher/);
  });

  it("with several networks, the first root's words say a withdrawal on another network can bring it", () => {
    for (const s of [null, screeningBlock({ autoPublish: { running: false, seconds: 0 } })]) {
      expect(firstRootClause(s).includes("another network")).toBe(MULTI_NETWORK);
    }
  });
});
