/**
 * The association-set screening policy v1 (shared/privacy/screening.ts) and the device-side proof built on it
 * (shared/privacy/associationSet.ts): the recipe cid, the exclusion file, the publisher's snapshot, root checks, the
 * device's states, the label-independent request order, the shrink alarm, and the privacy check on a screened set
 * (shared/privacy/guidance.ts). Pure: synthetic public events, no RPC.
 */
import { describe, expect, it, vi } from "vitest";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import type { ASPScreening, ExcludedDeposit } from "../../shared/privacy/api";
import {
  AssociationProofError,
  buildAssociationProof,
  crowdShrankSinceForm,
  previewAssociationSet,
  resolveAssociationProof,
  setChangedMessage,
  SMALL_ASSOCIATION_SET,
  type AssociationProofInput,
  type WithdrawalQuestion,
} from "../../shared/privacy/associationSet";
import { ASP_ROOT_HISTORY_SIZE, SNARK_SCALAR_FIELD, TREE_DEPTH } from "../../shared/privacy/constants";
import { computeScope } from "../../shared/privacy/context";
import { withdrawCheck, type PublicDeposit } from "../../shared/privacy/guidance";
import { MerkleTree } from "../../shared/privacy/merkleTree";
import { networkById } from "../../shared/privacy/networks";
import { computeLabel } from "../../shared/privacy/notes";
import * as S from "../../shared/privacy/screening";
import type { ASPRootUpdatedEvent, DepositedEvent, PoolEvent, WithdrawnEvent } from "../../shared/privacy/types";

const POOL = "0x2222222222222222222222222222222222222222" as Address;
const SCOPE = computeScope(POOL, 31337);
const ALICE = "0x00000000000000000000000000000000000000A1" as Address;
const BOB = "0x00000000000000000000000000000000000000B0" as Address;
const CAROL = "0x00000000000000000000000000000000000000C0" as Address;
const T0 = 1_790_000_000;
/** one block every 12 s */
const timeOf = (block: bigint) => T0 + Number(block) * 12;
const EMPTY_ROOT = new MerkleTree(TREE_DEPTH).root;
const sentinel = "SENTINEL-note-7f3a";

/** A pool's public events, built the way the chain emits them (deposits and change notes share the leaf counter). */
function chain() {
  const events: PoolEvent[] = [];
  let leaf = 0;
  let nonce = 0n;
  const tx = (): Hex => keccak256(toBytes(`screening-tx-${events.length}`));
  const logIndex = (block: bigint) => events.filter((e) => e.blockNumber === block).length;
  return {
    events,
    deposit(block: bigint, by: Address = ALICE, value: bigint = 10n ** 17n): DepositedEvent {
      const e: DepositedEvent = {
        kind: "deposit",
        depositor: by,
        commitment: 1_000n + BigInt(leaf),
        label: computeLabel(SCOPE, ++nonce),
        value,
        precommitment: 7n,
        leafIndex: leaf++,
        blockNumber: block,
        txHash: tx(),
        logIndex: logIndex(block),
      };
      events.push(e);
      return e;
    },
    withdraw(block: bigint): WithdrawnEvent {
      const e: WithdrawnEvent = {
        kind: "withdraw",
        recipient: CAROL,
        relayer: CAROL,
        value: 1n,
        fee: 0n,
        spentNullifier: 5_000n + BigInt(leaf),
        newCommitment: 9_000n + BigInt(leaf),
        leafIndex: leaf++,
        blockNumber: block,
        txHash: tx(),
        logIndex: logIndex(block),
      };
      events.push(e);
      return e;
    },
    post(block: bigint, root: bigint, cid: string): ASPRootUpdatedEvent {
      const e: ASPRootUpdatedEvent = { kind: "asproot", root, cid, blockNumber: block, txHash: tx(), logIndex: logIndex(block) };
      events.push(e);
      return e;
    },
    /** a v1 root over the first n deposits minus the deposits in `x`, posted at `block` */
    postRecipe(block: bigint, n: number, x: readonly DepositedEvent[] = [], o: { delay?: number; conf?: number } = {}) {
      const recipe = {
        version: 1 as const,
        considered: n,
        excludedLeaves: x.map((d) => d.leafIndex).sort((a, b) => a - b),
        asOfBlock: block - 1n,
        asOfTime: timeOf(block - 1n),
        delaySeconds: o.delay ?? 0,
        confirmations: o.conf ?? 1,
      };
      const labels = S.recipeLabels(events, recipe);
      if (!labels) throw new Error("test recipe does not rebuild");
      const root = S.setRoot(labels);
      const cid = S.formatRecipe(recipe);
      this.post(block, root, cid);
      return { root, cid, labels, recipe };
    },
    /** what a device or server holds after a sync: a fresh array */
    view: (toBlock?: bigint) => events.filter((e) => toBlock === undefined || e.blockNumber <= toBlock),
  };
}

function screening(o: Partial<ASPScreening> = {}): ASPScreening {
  return {
    policyVersion: 1,
    delaySeconds: 3_600,
    confirmations: 1,
    autoPublish: { running: true, seconds: 600 },
    exclusions: "ok",
    snapshot: { asOfBlock: "0", asOfTime: 0, considered: 0, memberCount: 0, waiting: 0, root: "0", cid: null },
    current: null,
    rootDue: false,
    readmitted: 0,
    excluded: [],
    ...o,
  };
}

const announce = (d: DepositedEvent, reason: S.ExclusionReason = "test", o: Partial<ExcludedDeposit> = {}): ExcludedDeposit => ({
  leafIndex: d.leafIndex,
  label: d.label.toString(),
  reason,
  considered: true,
  ...o,
});

async function rejection(p: Promise<unknown>): Promise<AssociationProofError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AssociationProofError);
  return err as AssociationProofError;
}

const knownOnly = (...roots: bigint[]) => vi.fn(async (r: bigint) => roots.includes(r));

// ─── the recipe cid ───────────────────────────────────────────────────────────

describe("the recipe cid", () => {
  const recipe = { version: 1 as const, considered: 42, excludedLeaves: [17, 30], asOfBlock: 154_200_123n, asOfTime: 1_795_001_234, delaySeconds: 3_600, confirmations: 1 };

  it("round-trips in the fixed grammar", () => {
    const cid = S.formatRecipe(recipe);
    expect(cid).toBe("hylsia-asp:v1;n=42;x=17,30;asOf=154200123;t=1795001234;delay=3600;conf=1");
    expect(S.parseRecipe(cid)).toEqual(recipe);
    const none = S.formatRecipe({ ...recipe, excludedLeaves: [] });
    expect(none).toBe("hylsia-asp:v1;n=42;x=;asOf=154200123;t=1795001234;delay=3600;conf=1");
    expect(S.parseRecipe(none)).toEqual({ ...recipe, excludedLeaves: [] });
    expect(S.cidPolicyVersion(cid)).toBe(1);
    expect(S.isScreenedCid(cid)).toBe(true);
    expect(S.recipeMemberCount(recipe)).toBe(40);
  });

  it("parses strictly: order, every field, no repeats, ascending x, no leading zeros", () => {
    const base = "hylsia-asp:v1;n=42;x=17,30;asOf=154200123;t=1795001234;delay=3600;conf=1";
    for (const bad of [
      base.replace("n=42;x=17,30", "x=17,30;n=42"), // order
      base.replace(";conf=1", ""), // missing field
      base.replace("x=17,30", "x=17,17"), // repeat
      base.replace("x=17,30", "x=30,17"), // unsorted
      base.replace("n=42", "n=042"), // leading zero
      base.replace("x=17,30", "x=017,30"),
      base.replace("asOf=154200123", "asOf=0154200123"),
      base.replace("delay=3600", "delay=+3600"),
      base.replace("t=1795001234", "t=-1"),
      base.replace("x=17,30", "x=17,,30"),
      base.replace("x=17,30", "x=17, 30"),
      base + ";extra=1",
      base + " ",
      base.toUpperCase(),
      base.replace("n=42", "n=1"), // x holds more leaves than n considers
      base.replace("n=42", "n=9007199254740993"), // beyond a safe integer
      "hylsia-asp:v1",
      "",
    ]) {
      expect(S.parseRecipe(bad), bad).toBeNull();
    }
  });

  it("carries at most 500 excluded leaves", () => {
    const leaves = (k: number) => Array.from({ length: k }, (_, i) => i);
    const at500 = S.formatRecipe({ ...recipe, considered: 600, excludedLeaves: leaves(S.MAX_RECIPE_EXCLUSIONS) });
    expect(S.parseRecipe(at500)?.excludedLeaves).toHaveLength(500);
    expect(() => S.formatRecipe({ ...recipe, considered: 600, excludedLeaves: leaves(501) })).toThrow(RangeError);
    const by501 = `hylsia-asp:v1;n=600;x=${leaves(501).join(",")};asOf=1;t=1;delay=0;conf=1`;
    expect(S.parseRecipe(by501)).toBeNull();
  });

  it("formatRecipe refuses what it could not parse back", () => {
    expect(() => S.formatRecipe({ ...recipe, excludedLeaves: [30, 17] })).toThrow(/ascending/);
    expect(() => S.formatRecipe({ ...recipe, excludedLeaves: [17, 17] })).toThrow(/ascending/);
    expect(() => S.formatRecipe({ ...recipe, considered: -1 })).toThrow(RangeError);
    expect(() => S.formatRecipe({ ...recipe, considered: 1.5 })).toThrow(RangeError);
    expect(() => S.formatRecipe({ ...recipe, asOfTime: null } as never)).toThrow(/t must/);
    expect(() => S.formatRecipe({ ...recipe, delaySeconds: null } as never)).toThrow(/delay/);
    expect(() => S.formatRecipe({ ...recipe, confirmations: null } as never)).toThrow(/conf/);
    expect(() => S.formatRecipe({ ...recipe, asOfBlock: -1n })).toThrow(/asOf/);
    expect(() => S.formatRecipe({ ...recipe, version: 0 } as never)).toThrow(/version/);
  });

  it("reads the open policy's legacy cid as version 0, and names versions", () => {
    expect(S.parseRecipe("open-testnet-policy:count=6:head=20")).toEqual({
      version: 0,
      considered: 6,
      excludedLeaves: [],
      asOfBlock: 20n,
      asOfTime: null,
      delaySeconds: null,
      confirmations: null,
    });
    expect(S.parseRecipe("open-testnet-policy:count=06:head=20")).toBeNull();
    expect(S.cidPolicyVersion("open-testnet-policy:count=6:head=20")).toBe(0);
    expect(S.cidPolicyVersion("hylsia-asp:v2;n=1")).toBe(2);
    expect(S.parseRecipe("hylsia-asp:v2;n=1;x=;asOf=1;t=1;delay=0;conf=1")).toBeNull();
    expect(S.cidPolicyVersion("hylsia-asp:vx;n=1")).toBeNull();
    expect(S.isScreenedCid("hylsia-asp:vx;n=1")).toBe(true);
    expect(S.cidPolicyVersion("test:16")).toBeNull();
    expect(S.isScreenedCid("test:16")).toBe(false);
  });
});

// ─── the recipe's list ────────────────────────────────────────────────────────

describe("recipeLabels", () => {
  it("is the first n deposits in leaf order minus x, whatever the event order; change notes never count", () => {
    const c = chain();
    const d0 = c.deposit(10n);
    const d1 = c.deposit(10n);
    c.withdraw(11n); // a change note takes leaf 2
    const d2 = c.deposit(12n);
    const d3 = c.deposit(13n);
    const reversed = [...c.events].reverse();
    expect(S.recipeLabels(reversed, { considered: 3, excludedLeaves: [d1.leafIndex] })).toEqual([d0.label, d2.label]);
    expect(S.recipeLabels(c.view(), { considered: 4, excludedLeaves: [] })).toEqual([d0.label, d1.label, d2.label, d3.label]);
    expect(S.recipeLabels(c.view(), { considered: 0, excludedLeaves: [] })).toEqual([]);
    expect(d2.leafIndex).toBe(3);
    // fewer than n deposits, an x leaf beyond the first n, or a change-note leaf in x: no list
    expect(S.recipeLabels(c.view(), { considered: 5, excludedLeaves: [] })).toBeNull();
    expect(S.recipeLabels(c.view(), { considered: 2, excludedLeaves: [d2.leafIndex] })).toBeNull();
    expect(S.recipeLabels(c.view(), { considered: 4, excludedLeaves: [2] })).toBeNull();
  });
});

// ─── the exclusion file ───────────────────────────────────────────────────────

describe("the operator's exclusion file", () => {
  const file = (entries: unknown[], extra: Record<string, unknown> = {}) => JSON.stringify({ format: "hylsia-asp-exclusions", version: 1, entries, ...extra });
  const label = computeLabel(SCOPE, 3n);

  it("reads labels (decimal or hex), depositing addresses (any case), reasons, networks, notes and dates", () => {
    const r = S.parseExclusionFile(
      file(
        [
          { chainId: 46630, label: label.toString(), reason: "stolen-funds", note: "private: never published or logged" },
          { label: `0x${label.toString(16)}`, reason: "fraud" },
          { depositor: "0x00000000000000000000000000000000000000B0", reason: "test", added: "2026-11-20" },
        ],
        { comment: "optional, ignored" },
      ),
    );
    expect(r).toEqual({
      ok: true,
      warnings: [],
      entries: [
        { chainId: 46630, label, depositor: null, reason: "stolen-funds" },
        { chainId: null, label, depositor: null, reason: "fraud" },
        { chainId: null, label: null, depositor: "0x00000000000000000000000000000000000000b0", reason: "test" },
      ],
    });
    expect(S.parseExclusionFile(file([]))).toEqual({ ok: true, entries: [], warnings: [] });
  });

  it("refuses every malformed file, naming the entry and the field only", () => {
    const cases: [string, RegExp][] = [
      ["{", /not valid JSON/],
      ["[]", /must be a JSON object/],
      [JSON.stringify({ format: "hylsia-asp-exclusions", version: 1, entries: [], [sentinel]: 1 }), /top-level field that is not allowed/],
      [file([], { format: "other" }), /field "format" must be "hylsia-asp-exclusions"/],
      [file([], { version: 2 }), /field "version" must be 1/],
      [file([], { comment: 5 }), /field "comment" must be text/],
      [JSON.stringify({ format: "hylsia-asp-exclusions", version: 1, entries: {} }), /field "entries" must be a list/],
      [file(["x"]), /entry #1 must be an object/],
      [file([{ label: "5", reason: "test", [sentinel]: 1 }]), /entry #1 has a field that is not allowed/],
      [file([{ label: "5", depositor: BOB, reason: "test" }]), /entry #1 must name exactly one of "label" or "depositor"/],
      [file([{ reason: "test" }]), /entry #1 must name exactly one/],
      [file([{ label: 5, reason: "test" }]), /entry #1: field "label"/],
      [file([{ label: "0", reason: "test" }]), /entry #1: field "label"/],
      [file([{ label: SNARK_SCALAR_FIELD.toString(), reason: "test" }]), /entry #1: field "label"/],
      [file([{ label: `${sentinel}`, reason: "test" }]), /entry #1: field "label"/],
      [file([{ label: "5", reason: "test" }, { depositor: "0x1234", reason: "test" }]), /entry #2: field "depositor" must be an address/],
      [file([{ depositor: `0x${"g".repeat(40)}`, reason: "test" }]), /entry #1: field "depositor"/],
      [file([{ label: "5", reason: sentinel }]), /entry #1: field "reason" must be one of sanctions, stolen-funds, fraud, legal-order, test/],
      [file([{ label: "5", reason: "test", chainId: 0 }]), /entry #1: field "chainId" must be a whole number above 0/],
      [file([{ label: "5", reason: "test", chainId: "46630" }]), /entry #1: field "chainId"/],
      [file([{ label: "5", reason: "test", chainId: 1.5 }]), /entry #1: field "chainId"/],
      [file([{ label: "5", reason: "test", note: "x".repeat(501) }]), /entry #1: field "note" must be text of at most 500 characters/],
      [file([{ label: "5", reason: "test", note: 7 }]), /entry #1: field "note"/],
      [file([{ label: "5", reason: "test", added: "2026-02-30" }]), /entry #1: field "added" must be a date written YYYY-MM-DD/],
      [file([{ label: "5", reason: "test", added: "20/11/2026" }]), /entry #1: field "added"/],
    ];
    for (const [text, error] of cases) {
      const r = S.parseExclusionFile(text);
      expect(r.ok, text.slice(0, 80)).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatch(error);
        expect(r.error).not.toContain(sentinel);
        expect(r.error).not.toContain(BOB.slice(2));
      }
    }
    const many = S.parseExclusionFile(file(Array.from({ length: S.MAX_EXCLUSION_ENTRIES + 1 }, () => ({ label: "5", reason: "test" }))));
    expect(many).toEqual({ ok: false, error: 'field "entries" holds more than 10,000 entries' });
    expect(S.parseExclusionFile(file(Array.from({ length: S.MAX_EXCLUSION_ENTRIES }, () => ({ label: "5", reason: "test" })))).ok).toBe(true);
  });

  it("a JSON error says where, never what the text holds (it may hold notes)", () => {
    const text = `{"format":"hylsia-asp-exclusions","version":1,"entries":[{"label":"5","reason":"test","note":"${sentinel}"}`;
    const r = S.parseExclusionFile(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/^the exclusion list is not valid JSON/);
      expect(r.error).not.toContain(sentinel);
      expect(r.error).not.toContain("note");
    }
    const broken = S.parseExclusionFile(`{\n  "format": "hylsia-asp-exclusions",\n  "version": 1\n  "entries": []\n}`);
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error).toMatch(/not valid JSON \(line \d+, column \d+\)/);
  });

  it("an inline list (from the environment) may carry no notes", () => {
    expect(S.parseExclusionFile(file([{ label: "5", reason: "test", note: sentinel }]), { notes: "reject" })).toEqual({
      ok: false,
      error: 'entry #1: field "note" is not allowed in an inline list (keep notes in the file only)',
    });
    expect(S.parseExclusionFile(file([{ label: "5", reason: "test" }]), { notes: "reject" }).ok).toBe(true);
  });

  it("a repeated entry is a warning; the first one's reason counts", () => {
    const r = S.parseExclusionFile(
      file([
        { label: "5", reason: "fraud" },
        { label: "0x5", reason: "test" },
        { label: "5", reason: "test", chainId: 31337 },
      ]),
    );
    expect(r.ok && r.warnings).toEqual(["entry #2 repeats entry #1; the first one's reason counts"]);
    if (!r.ok) throw new Error("unreachable");
    const match = S.exclusionMatcher(r.entries, 31337);
    expect(match({ label: 5n, depositor: ALICE })).toBe("fraud");
  });

  it("matches by label or depositing address (any case), on its network or every network; the first entry wins", () => {
    const r = S.parseExclusionFile(
      file([
        { depositor: BOB.toUpperCase().replace("0X", "0x"), reason: "sanctions", chainId: 31337 },
        { label: "7", reason: "legal-order" },
        { label: "9", reason: "test", chainId: 46630 },
      ]),
    );
    if (!r.ok) throw new Error(r.error);
    const local = S.exclusionMatcher(r.entries, 31337);
    expect(local({ label: 1n, depositor: BOB.toLowerCase() as Address })).toBe("sanctions");
    expect(local({ label: 7n, depositor: ALICE })).toBe("legal-order");
    expect(local({ label: 7n, depositor: BOB })).toBe("sanctions"); // entry #1 comes first
    expect(local({ label: 9n, depositor: ALICE })).toBeNull(); // another network's entry
    const testnet = S.exclusionMatcher(r.entries, 46630);
    expect(testnet({ label: 9n, depositor: ALICE })).toBe("test");
    expect(testnet({ label: 1n, depositor: BOB })).toBeNull();
  });
});

// ─── the publisher's snapshot ─────────────────────────────────────────────────

describe("screenDeposits: the publisher's snapshot", () => {
  const none = () => null;

  it("considers confirmed deposits whose block time + delay is at or before the head's time (equality joins)", () => {
    const c = chain();
    const d = [c.deposit(100n), c.deposit(101n), c.deposit(102n), c.deposit(105n)];
    const base = { deposits: c.view(), confirmations: 1, exclude: none, previousConsidered: 0 };
    // delay 0: the confirmation cutoff alone (block <= head - c + 1)
    expect(S.screenDeposits({ ...base, head: { block: 104n, time: timeOf(104n) }, delaySeconds: 0, blockTime: () => undefined }).recipe.considered).toBe(3);
    // 3 confirmations at head 104: blocks up to 102 (102, 103, 104); 4 confirmations: up to 101
    expect(S.screenDeposits({ ...base, confirmations: 3, head: { block: 104n, time: timeOf(104n) }, delaySeconds: 0, blockTime: () => undefined }).recipe.considered).toBe(3);
    expect(S.screenDeposits({ ...base, confirmations: 4, head: { block: 104n, time: timeOf(104n) }, delaySeconds: 0, blockTime: () => undefined }).recipe.considered).toBe(2);
    // delay 3600: block 101's deposit joins at exactly timeOf(101) + 3600, not a second before
    const blockTime = vi.fn((b: bigint) => timeOf(b));
    const at = (time: number) => S.screenDeposits({ ...base, head: { block: 2_000n, time }, delaySeconds: 3_600, blockTime });
    expect(at(timeOf(101n) + 3_600).recipe.considered).toBe(2);
    expect(at(timeOf(101n) + 3_599).recipe.considered).toBe(1);
    const snap = at(timeOf(105n) + 3_600);
    expect(snap.recipe).toMatchObject({ version: 1, considered: 4, excludedLeaves: [], asOfBlock: 2_000n, asOfTime: timeOf(105n) + 3_600, delaySeconds: 3_600, confirmations: 1 });
    expect(snap.labels).toEqual(d.map((x) => x.label));
    expect(snap.root).toBe(new MerkleTree(TREE_DEPTH, d.map((x) => x.label)).root);
    expect(snap.cid).toBe(S.formatRecipe(snap.recipe));
    expect(S.parseRecipe(snap.cid!)).toEqual(snap.recipe);
    expect(S.verifySet(snap.root, snap.cid, c.view())?.labels).toEqual(snap.labels);
    expect(snap).toMatchObject({ memberCount: 4, waiting: 0, deposits: 4, excluded: [] });
  });

  it("a delay of 0 reads no block time; blocksNeedingTime names what a delay needs", () => {
    const c = chain();
    c.deposit(100n);
    c.deposit(100n);
    c.deposit(103n);
    c.deposit(109n);
    const blockTime = vi.fn(() => undefined);
    const head = { block: 108n, time: timeOf(108n) };
    S.screenDeposits({ deposits: c.view(), head, confirmations: 1, delaySeconds: 0, blockTime, exclude: none, previousConsidered: 0 });
    expect(blockTime).not.toHaveBeenCalled();
    const need = (previousConsidered: number, delaySeconds = 60) =>
      S.blocksNeedingTime({ deposits: c.view(), head, confirmations: 1, delaySeconds, exclude: none, previousConsidered });
    expect(need(0)).toEqual([100n, 103n]); // confirmed only (block 109 is beyond the head), no repeats
    expect(need(2)).toEqual([103n]); // earlier deposits stay members whatever their time
    expect(need(0, 0)).toEqual([]);
    expect(() => S.screenDeposits({ deposits: c.view(), head, confirmations: 1, delaySeconds: 60, blockTime, exclude: none, previousConsidered: 0 })).toThrow(
      /no block time for block 100/,
    );
  });

  it("never considers fewer than before (raising the delay drops no member), nor more deposits than there are", () => {
    const c = chain();
    for (let b = 100n; b < 106n; b++) c.deposit(b);
    const head = { block: 106n, time: timeOf(106n) };
    const base = { deposits: c.view(), head, confirmations: 1, blockTime: timeOf, exclude: none };
    expect(S.screenDeposits({ ...base, delaySeconds: 0, previousConsidered: 0 }).recipe.considered).toBe(6);
    expect(S.screenDeposits({ ...base, delaySeconds: 3_600, previousConsidered: 0 }).recipe.considered).toBe(0);
    expect(S.screenDeposits({ ...base, delaySeconds: 3_600, previousConsidered: 4 }).recipe.considered).toBe(4);
    // a reorg took deposits away: n is clamped, no phantom member
    expect(S.screenDeposits({ ...base, delaySeconds: 3_600, previousConsidered: 9 })).toMatchObject({ memberCount: 6, recipe: { considered: 6 } });
  });

  it("excludes listed deposits by label or depositor; a listed deposit beyond n is announced at once and never enters x", () => {
    const c = chain();
    const d0 = c.deposit(100n, ALICE);
    const d1 = c.deposit(101n, BOB);
    c.withdraw(101n);
    const d2 = c.deposit(102n, ALICE);
    const d3 = c.deposit(103n, BOB); // inside the delay
    const d4 = c.deposit(104n, ALICE); // inside the delay
    const list = S.parseExclusionFile(
      JSON.stringify({ format: "hylsia-asp-exclusions", version: 1, entries: [{ depositor: BOB, reason: "sanctions", chainId: 31337 }, { label: d2.label.toString(), reason: "fraud" }] }),
    );
    if (!list.ok) throw new Error(list.error);
    const snap = S.screenDeposits({
      deposits: c.view(),
      head: { block: 104n, time: timeOf(102n) + 600 },
      confirmations: 1,
      delaySeconds: 600,
      blockTime: timeOf,
      exclude: S.exclusionMatcher(list.entries, 31337),
      previousConsidered: 0,
    });
    expect(snap.recipe.considered).toBe(3);
    expect(snap.recipe.excludedLeaves).toEqual([d1.leafIndex, d2.leafIndex]);
    expect(snap.labels).toEqual([d0.label]);
    expect(snap.excluded).toEqual([
      { leafIndex: d1.leafIndex, label: d1.label, reason: "sanctions", considered: true },
      { leafIndex: d2.leafIndex, label: d2.label, reason: "fraud", considered: true },
      { leafIndex: d3.leafIndex, label: d3.label, reason: "sanctions", considered: false },
    ]);
    expect(snap.waiting).toBe(1); // d4: not considered yet, not listed
    expect(d4.leafIndex).toBe(5);
    // on another network the same file excludes only the label entry that names every network
    const other = S.screenDeposits({
      deposits: c.view(),
      head: { block: 104n, time: timeOf(102n) + 600 },
      confirmations: 1,
      delaySeconds: 600,
      blockTime: timeOf,
      exclude: S.exclusionMatcher(list.entries, 31338),
      previousConsidered: 0,
    });
    expect(other.recipe.excludedLeaves).toEqual([d2.leafIndex]);
  });

  it("when every member is excluded the root is the empty tree's root (posted to remove the last member)", () => {
    const c = chain();
    c.deposit(100n, BOB);
    const snap = S.screenDeposits({ deposits: c.view(), head: { block: 100n, time: timeOf(100n) }, confirmations: 1, delaySeconds: 0, blockTime: timeOf, exclude: () => "test", previousConsidered: 1 });
    expect(snap).toMatchObject({ memberCount: 0, labels: [], root: EMPTY_ROOT, waiting: 0 });
    expect(snap.root).not.toBe(0n);
    expect(S.verifySet(snap.root, snap.cid, c.view())?.memberCount).toBe(0);
  });

  it("more than 500 exclusions cannot be posted (no cid); 500 can", () => {
    const c = chain();
    for (let k = 0; k < 502; k++) c.deposit(100n);
    const all = c.view();
    const deps = S.depositsInLeafOrder(all);
    const snapWith = (excluded: number) =>
      S.screenDeposits({
        deposits: all,
        head: { block: 100n, time: timeOf(100n) },
        confirmations: 1,
        delaySeconds: 0,
        blockTime: timeOf,
        exclude: (d) => (d.leafIndex < excluded ? "test" : null),
        previousConsidered: 0,
      });
    const at500 = snapWith(500);
    expect(at500.cid).not.toBeNull();
    expect(S.parseRecipe(at500.cid!)?.excludedLeaves).toHaveLength(500);
    expect(S.verifySet(at500.root, at500.cid, all)?.labels).toEqual(deps.slice(500).map((d) => d.label));
    const at501 = snapWith(501);
    expect(at501.cid).toBeNull();
    expect(at501.recipe.excludedLeaves).toHaveLength(501);
  });

  it("refuses inputs a publisher never sends", () => {
    const base = { deposits: [], head: { block: 1n, time: 1 }, confirmations: 1, delaySeconds: 0, blockTime: timeOf, exclude: none, previousConsidered: 0 };
    expect(() => S.screenDeposits({ ...base, delaySeconds: -1 })).toThrow(RangeError);
    expect(() => S.screenDeposits({ ...base, confirmations: 1.5 })).toThrow(RangeError);
    expect(() => S.screenDeposits({ ...base, head: { block: 1n, time: Number.NaN } })).toThrow(RangeError);
    const one = chain();
    one.deposit(1n);
    expect(() => S.screenDeposits({ ...base, deposits: one.view(), exclude: () => "nope" as S.ExclusionReason })).toThrow(/unknown reason/);
  });
});

// ─── the tree ─────────────────────────────────────────────────────────────────

describe("setRoot and the verified set's proofs", () => {
  it("equal MerkleTree's root and proofs at every size", () => {
    const labels = Array.from({ length: 17 }, (_, i) => computeLabel(SCOPE, BigInt(i + 1)));
    for (const size of [0, 1, 2, 3, 4, 5, 8, 9, 16, 17]) {
      const list = labels.slice(0, size);
      const tree = new MerkleTree(TREE_DEPTH, list);
      expect(S.setRoot(list)).toBe(tree.root);
      if (size === 0) continue;
      const c = chain();
      for (let k = 0; k < size; k++) c.deposit(100n);
      const posted = c.postRecipe(101n, size);
      const set = S.verifySet(posted.root, posted.cid, c.view())!;
      for (const index of new Set([0, Math.floor(size / 2), size - 1])) {
        expect(set.proof(index)).toEqual(new MerkleTree(TREE_DEPTH, posted.labels).proof(index));
        expect(MerkleTree.verify(set.proof(index))).toBe(true);
      }
      expect(set.tree.root).toBe(posted.root);
    }
    expect(() => S.setRoot([SNARK_SCALAR_FIELD])).toThrow(RangeError);
  });
});

// ─── checking a root ──────────────────────────────────────────────────────────

describe("checkRoot: a root is checked against the device's own deposits", () => {
  function six() {
    const c = chain();
    const d = [c.deposit(10n), c.deposit(10n)];
    c.withdraw(11n);
    d.push(c.deposit(12n), c.deposit(13n), c.deposit(14n, BOB), c.deposit(15n));
    return { c, d };
  }

  it("verifies a recipe that rebuilds to the root, and refuses dropped, invented or reordered members", () => {
    const { c, d } = six();
    const ok = c.postRecipe(20n, 6, [d[1]]);
    const events = c.view();
    const check = S.checkRoot({ root: ok.root, cid: ok.cid, events, at: S.rootRecordOf(events, ok.root)!.at });
    expect(check.status).toBe("verified");
    if (check.status !== "verified") throw new Error("unreachable");
    expect(check.set.labels).toEqual([d[0], d[2], d[3], d[4], d[5]].map((x) => x.label));
    expect(check.set).toMatchObject({ memberCount: 5, root: ok.root, cid: ok.cid, recipe: { considered: 6, excludedLeaves: [d[1].leafIndex] } });

    const members = d.map((x) => x.label);
    const cid = (n: number, x: number[] = []) => `hylsia-asp:v1;n=${n};x=${x.join(",")};asOf=1;t=1;delay=0;conf=1`;
    const verdict = (root: bigint, c2: string) => S.checkRoot({ root, cid: c2, events }).status === "mismatch";
    expect(verdict(S.setRoot(members.slice(0, 5)), cid(6))).toBe(true); // a member dropped without being listed
    expect(verdict(S.setRoot([...members, 424242n]), cid(6))).toBe(true); // an invented member
    expect(verdict(S.setRoot([members[1], members[0], ...members.slice(2)]), cid(6))).toBe(true); // reordered
    expect(verdict(ok.root + 1n, ok.cid)).toBe(true); // another root
    expect(S.checkRoot({ root: ok.root, cid: cid(6, [2]), events })).toMatchObject({ status: "mismatch", problem: "exclusions" }); // a change-note leaf
  });

  it("cannot-check is never does-not-match: missing deposits or a hole in the events give unknown", () => {
    const { c, d } = six();
    const ok = c.postRecipe(20n, 6, [d[1]]);
    // the device's RPC is behind: it holds 4 of the 6 deposits
    expect(S.checkRoot({ root: ok.root, cid: ok.cid, events: c.view(13n) })).toMatchObject({ status: "unknown", problem: "missing_deposits" });
    // a hole: the change note at leaf 2 is missing, so the device cannot know the first n deposits
    const holed = c.view().filter((e) => e.kind !== "withdraw");
    expect(S.checkRoot({ root: ok.root, cid: ok.cid, events: holed })).toMatchObject({ status: "unknown", problem: "missing_deposits" });
    // a hole after the n-th deposit does not matter
    const c2 = chain();
    for (let k = 0; k < 3; k++) c2.deposit(10n);
    c2.withdraw(11n);
    c2.deposit(12n);
    const two = c2.postRecipe(20n, 2);
    expect(S.checkRoot({ root: two.root, cid: two.cid, events: c2.view().filter((e) => e.kind !== "withdraw") }).status).toBe("verified");
  });

  it("accepts the open policy's prefix roots (legacy), but never after a screened root", () => {
    const { c, d } = six();
    const prefix4 = S.setRoot(d.slice(0, 4).map((x) => x.label));
    c.post(16n, prefix4, "open-testnet-policy:count=4:head=16");
    const prefix6 = S.setRoot(d.map((x) => x.label));
    c.post(17n, prefix6, "test:17");
    let events = c.view();
    expect(S.checkRoot({ root: prefix4, cid: "open-testnet-policy:count=4:head=16", events, at: { blockNumber: 16n, logIndex: 0 } })).toMatchObject({
      status: "verified",
      set: { memberCount: 4, recipe: { version: 0, considered: 4 } },
    });
    expect(S.checkRoot({ root: prefix6, cid: "test:17", events, at: { blockNumber: 17n, logIndex: 0 } })).toMatchObject({ status: "verified", set: { memberCount: 6 } });
    expect(S.checkRoot({ root: prefix6, cid: null, events })).toMatchObject({ status: "verified" }); // no record: the prefix alone
    // a root that is no prefix, with its own event here and no hole: mismatch; without its event: unknown
    const odd = S.setRoot([d[3].label]);
    c.post(18n, odd, "test:18");
    events = c.view();
    expect(S.checkRoot({ root: odd, cid: "test:18", events, at: { blockNumber: 18n, logIndex: 0 } })).toMatchObject({ status: "mismatch", problem: "root" });
    expect(S.checkRoot({ root: odd, cid: null, events })).toMatchObject({ status: "unknown", problem: "no_record" });

    // a screened root, then an older publisher's prefix root: the policy version went backwards
    const screened = c.postRecipe(19n, 6, [d[4]]);
    c.post(21n, prefix6, "open-testnet-policy:count=6:head=21");
    events = c.view();
    expect(S.checkRoot({ root: prefix6, cid: "open-testnet-policy:count=6:head=21", events, at: { blockNumber: 21n, logIndex: 0 } })).toMatchObject({
      status: "mismatch",
      problem: "version_backwards",
    });
    expect(S.checkRoot({ root: prefix6, cid: null, events })).toMatchObject({ status: "unknown", problem: "no_record" });
    expect(S.checkRoot({ root: screened.root, cid: screened.cid, events, at: { blockNumber: 19n, logIndex: 0 } }).status).toBe("verified");
    expect(S.highestPolicyVersion(events)).toBe(1);
  });

  it("a newer policy version is 'outdated'; a malformed screening cid is a mismatch", () => {
    const { c } = six();
    const events = c.view();
    expect(S.checkRoot({ root: 5n, cid: "hylsia-asp:v2;n=6;anything", events })).toEqual({ status: "outdated", problem: "outdated", version: 2 });
    expect(S.checkRoot({ root: 5n, cid: "hylsia-asp:v1;n=6", events })).toMatchObject({ status: "mismatch", problem: "malformed" });
    expect(S.checkRoot({ root: 5n, cid: "hylsia-asp:version-one", events })).toMatchObject({ status: "mismatch", problem: "malformed" });
    c.post(30n, 77n, "hylsia-asp:v3;n=1");
    expect(S.highestPolicyVersion(c.view())).toBe(3);
  });

  it("n never decreases: a lower n is a policy violation, unless the deposits themselves dropped (a reorg)", () => {
    const { c, d } = six();
    c.postRecipe(20n, 5);
    const lower = c.postRecipe(21n, 4);
    const events = c.view();
    expect(S.considerationFloor(events)).toBe(5);
    expect(S.considerationFloor(events, { blockNumber: 20n, logIndex: 0 })).toBe(0);
    expect(S.checkRoot({ root: lower.root, cid: lower.cid, events, at: { blockNumber: 21n, logIndex: 0 } })).toMatchObject({ status: "mismatch", problem: "lowered" });
    // the device holds only four deposits now (a reorg dropped two): n = 4 is no violation
    const reorged = events.filter((e) => !(e.kind === "deposit" && e.leafIndex > d[3].leafIndex));
    expect(S.checkRoot({ root: lower.root, cid: lower.cid, events: reorged, at: { blockNumber: 21n, logIndex: 0 } }).status).toBe("verified");
  });

  it("the root binds the members, not the split: with duplicates the newest event's cid wins", () => {
    const c = chain();
    const d = [c.deposit(10n), c.deposit(11n), c.deposit(12n), c.deposit(13n), c.deposit(14n)];
    const waitingCut = c.postRecipe(20n, 4); // n=4: deposit 5 not considered yet
    const excludedCut = c.postRecipe(21n, 5, [d[4]]); // n=5, x={deposit 5}: the same members
    expect(excludedCut.root).toBe(waitingCut.root);
    const events = c.view();
    for (const at of [20n, 21n]) {
      const rec = S.rootRecordOf(events.filter((e) => e.blockNumber <= at), waitingCut.root)!;
      expect(S.checkRoot({ root: rec.root, cid: rec.cid, events, at: rec.at }).status).toBe("verified");
    }
    // the newest event decides what the device shows for the tail deposit (the operator's claim)
    const state = (evs: PoolEvent[]) => S.screeningState({ label: d[4].label, events: evs, currentRoot: waitingCut.root });
    expect(state(c.view(20n))).toMatchObject({ kind: "waiting" });
    expect(state(events)).toEqual({ kind: "excluded", reason: null, removed: false, listed: true });
    // the other order lowers n after the fact: a policy violation
    const c2 = chain();
    const e = [c2.deposit(10n), c2.deposit(11n), c2.deposit(12n), c2.deposit(13n), c2.deposit(14n)];
    c2.postRecipe(20n, 5, [e[4]]);
    const after = c2.postRecipe(21n, 4);
    expect(S.checkCurrentRoot({ events: c2.view(), currentRoot: after.root })?.check).toMatchObject({ status: "mismatch", problem: "lowered" });
  });

  it("is memoized per events array, and a record is used only for the root it names", () => {
    const { c, d } = six();
    const ok = c.postRecipe(20n, 6, [d[1]]);
    const events = c.view();
    const a = S.checkRoot({ root: ok.root, cid: ok.cid, events });
    expect(S.checkRoot({ root: ok.root, cid: ok.cid, events })).toBe(a);
    const lagging = c.view(15n); // no event for the root
    expect(S.checkCurrentRoot({ events: lagging, currentRoot: ok.root })).toMatchObject({ source: "none", check: { status: "unknown", problem: "no_record" } });
    expect(S.checkCurrentRoot({ events: lagging, currentRoot: ok.root, record: { root: ok.root, cid: ok.cid } })).toMatchObject({ source: "record", check: { status: "verified" } });
    expect(S.checkCurrentRoot({ events: lagging, currentRoot: ok.root, record: { root: ok.root + 1n, cid: ok.cid } })).toMatchObject({ source: "none" });
    expect(S.checkCurrentRoot({ events: lagging, currentRoot: 0n })).toBeNull();
  });
});

// ─── the device's proof ───────────────────────────────────────────────────────

describe("the device proves against the current root only, in a label-independent order", () => {
  /** eight deposits (a change note in between), R1 = first 4, R2 = first 6 minus deposit 1; R2 is current */
  function scene() {
    const c = chain();
    const d = [c.deposit(10n), c.deposit(10n, BOB)];
    c.withdraw(11n);
    d.push(c.deposit(12n), c.deposit(13n), c.deposit(14n), c.deposit(15n), c.deposit(16n), c.deposit(17n));
    const r1 = c.postRecipe(18n, 4);
    const r2 = c.postRecipe(19n, 6, [d[1]]);
    return { c, d, r1, r2 };
  }

  it("proves a member against the current root; a member of an older root only is never proved against that root", async () => {
    const { c, d, r1, r2 } = scene();
    const isKnownRoot = knownOnly(r1.root, r2.root);
    const proof = await buildAssociationProof({ label: d[3].label, events: c.view(), currentRoot: r2.root, isKnownRoot });
    expect(proof).toMatchObject({ root: r2.root, size: 5, index: 2, leaf: d[3].label, source: "device", recipe: { version: 1, considered: 6 }, shrink: null });
    expect(MerkleTree.verify(proof)).toBe(true);
    expect(isKnownRoot.mock.calls).toEqual([[r2.root]]);
    // deposit 1 is in R1 (still known) but excluded from R2: EXCLUDED, never a proof against R1
    const err = await rejection(buildAssociationProof({ label: d[1].label, events: c.view(), currentRoot: r2.root, isKnownRoot }));
    expect(err).toMatchObject({ code: "EXCLUDED", reason: null });
    expect(err.message).toMatch(/excluded from the association set, so it cannot be withdrawn privately\. Use the public exit \(ragequit\)/);
    expect(err.message).toMatch(/No withdrawal was sent\.$/);
    const waiting = await rejection(buildAssociationProof({ label: d[6].label, events: c.view(), currentRoot: r2.root, isKnownRoot }));
    expect(waiting.code).toBe("WAITING");
    expect(waiting.message).toBe("This deposit is waiting for screening, so it cannot be withdrawn privately yet. No withdrawal was sent. Ragequit (public exit) works now.");
    expect(SMALL_ASSOCIATION_SET).toBe(10);
  });

  it("announced exclusions never outrank the chain: in-root gives REMOVAL_ANNOUNCED (no public-exit advice), in x takes the reason", async () => {
    const { c, d, r2 } = scene();
    const announced = S.announcedExclusions(screening({ excluded: [announce(d[3], "stolen-funds"), announce(d[1], "sanctions"), announce(d[7], "fraud", { considered: false })] }));
    const base = { events: c.view(), currentRoot: r2.root, isKnownRoot: knownOnly(r2.root), announced };
    const inRoot = await rejection(buildAssociationProof({ ...base, label: d[3].label }));
    expect(inRoot).toMatchObject({ code: "REMOVAL_ANNOUNCED", reason: "stolen-funds" });
    expect(inRoot.message).toMatch(/announced that this deposit will be excluded from the association set \(reason: Stolen funds\), but the association set on-chain still includes it/);
    expect(inRoot.message).not.toMatch(/ragequit|public exit/i);
    const inX = await rejection(buildAssociationProof({ ...base, label: d[1].label }));
    expect(inX).toMatchObject({ code: "EXCLUDED", reason: "sanctions" });
    expect(inX.message).toMatch(/excluded from the association set \(reason: Sanctions\)/);
    const beyond = await rejection(buildAssociationProof({ ...base, label: d[7].label }));
    expect(beyond).toMatchObject({ code: "WAITING", detail: "announced", reason: "fraud" });
    expect(beyond.message).not.toMatch(/ragequit|public exit/i);
    // an unannounced member still proves
    expect((await buildAssociationProof({ ...base, label: d[0].label })).size).toBe(5);
  });

  it("asks the chain and the server the same questions for an in-set note, a waiting note, a note in x and a note it does not hold", async () => {
    const { c, d, r2 } = scene();
    const full = c.view();
    // a device whose RPC is behind: no event for R2, and only five deposits (R2 needs six)
    const lagging = c.view(14n);
    const notHeld = computeLabel(SCOPE, 999n);
    const record = { root: r2.root, cid: r2.cid };
    const runs: string[][] = [];
    const outcomes: string[] = [];
    for (const label of [d[0].label, d[6].label, d[1].label, notHeld]) {
      const calls: string[] = [];
      const input = {
        label,
        state: { events: lagging, currentRoot: r2.root },
        reload: async () => (calls.push("reload()"), { events: full, currentRoot: r2.root }),
        isKnownRoot: async (root: bigint) => (calls.push(`isKnownASPRoot(${root})`), root === r2.root),
        fetchRootRecord: async (...args: unknown[]) => (calls.push(`asp.set(${args.length})`), record),
        requestPublish: async (...args: unknown[]) => (calls.push(`asp.publish(${args.length})`), null),
        publishDue: true,
      };
      outcomes.push(
        await resolveAssociationProof(input).then(
          (p) => `proof:${p.size}`,
          (e: unknown) => (e instanceof AssociationProofError ? e.code : String(e)),
        ),
      );
      runs.push(calls);
    }
    expect(outcomes).toEqual(["proof:5", "WAITING", "EXCLUDED", "NOT_MEMBER"]);
    // the same label-free reads for every note, up to the label; only a note the root holds then sends the request
    // for a newer root (a note it does not hold stops before any request about the withdrawal)
    const checks = [`isKnownASPRoot(${r2.root})`, "reload()", `isKnownASPRoot(${r2.root})`];
    // one re-sync first (it brings the root's own event), so no server record is needed
    expect(runs[0]).toEqual([...checks, "asp.publish(0)"]);
    for (const r of runs.slice(1)) expect(r).toEqual(checks);

    // a re-sync that still lacks the root's event: then the record, once; the same calls again for every note, and a
    // server's record never makes a deposit "excluded" (EXCLUDED points at the public exit): its x is the operator's claim
    const noRootEvent = c.view(18n);
    const runs2: string[][] = [];
    const outcomes2: string[] = [];
    for (const label of [d[0].label, d[6].label, d[1].label, notHeld]) {
      const calls: string[] = [];
      outcomes2.push(
        await resolveAssociationProof({
          label,
          state: { events: lagging, currentRoot: r2.root },
          reload: async () => (calls.push("reload()"), { events: noRootEvent, currentRoot: r2.root }),
          isKnownRoot: async (root: bigint) => (calls.push(`isKnownASPRoot(${root})`), root === r2.root),
          fetchRootRecord: async (...args: unknown[]) => (calls.push(`asp.set(${args.length})`), record),
          requestPublish: async (...args: unknown[]) => (calls.push(`asp.publish(${args.length})`), null),
          publishDue: true,
        }).then(
          (p) => `proof:${p.size}`,
          (e: unknown) => (e instanceof AssociationProofError ? `${e.code}${e.detail ? `/${e.detail}` : ""}` : String(e)),
        ),
      );
      runs2.push(calls);
    }
    expect(outcomes2).toEqual(["proof:5", "WAITING", "WAITING/announced", "NOT_MEMBER"]);
    const checks2 = [`isKnownASPRoot(${r2.root})`, "reload()", `isKnownASPRoot(${r2.root})`, "asp.set(0)"];
    expect(runs2[0]).toEqual([...checks2, "asp.publish(0)"]);
    for (const r of runs2.slice(1)) expect(r).toEqual(checks2);

    // the status answer's record, already on the device, is used first: then no record request at all
    const calls: string[] = [];
    const viaStatus = await resolveAssociationProof({
      label: d[0].label,
      state: { events: noRootEvent, currentRoot: r2.root },
      reload: async () => (calls.push("reload()"), { events: noRootEvent, currentRoot: r2.root }),
      isKnownRoot: async (root: bigint) => (calls.push(`isKnownASPRoot(${root})`), root === r2.root),
      record: { root: r2.root, cid: r2.cid },
      fetchRootRecord: async () => (calls.push("asp.set(0)"), record),
      publishDue: false,
    });
    expect(viaStatus).toMatchObject({ source: "status", size: 5 });
    expect(calls).toEqual([`isKnownASPRoot(${r2.root})`, "reload()", `isKnownASPRoot(${r2.root})`]);
  });

  it("uses the record only without the root's event, once, without arguments, and only when it rebuilds to the root", async () => {
    const { c, d, r2 } = scene();
    const noRootEvent = c.view(18n); // every deposit, R1, but not R2's event
    const good = vi.fn(async () => ({ root: r2.root, cid: r2.cid }));
    const proof = await buildAssociationProof({ label: d[0].label, events: noRootEvent, currentRoot: r2.root, isKnownRoot: knownOnly(r2.root), fetchRootRecord: good });
    expect(proof).toMatchObject({ source: "full-set", root: r2.root, size: 5 });
    expect(good.mock.calls).toEqual([[]]);
    // the record proves membership (the root binds the members), but its exclusions are the operator's claim: a leaf it
    // lists is held back (WAITING, announced), never EXCLUDED with public-exit advice
    const listed = await rejection(buildAssociationProof({ label: d[1].label, events: noRootEvent, currentRoot: r2.root, isKnownRoot: knownOnly(r2.root), fetchRootRecord: good }));
    expect(listed).toMatchObject({ code: "WAITING", detail: "announced" });
    expect(listed.message).not.toMatch(/ragequit|public exit/i);
    // with the root's own event at hand the same deposit is EXCLUDED: on-chain evidence
    expect((await rejection(buildAssociationProof({ label: d[1].label, events: c.view(), currentRoot: r2.root, isKnownRoot: knownOnly(r2.root) }))).code).toBe("EXCLUDED");
    // with the event at hand the record is never asked for
    const unused = vi.fn(async () => ({ root: r2.root, cid: r2.cid }));
    expect((await buildAssociationProof({ label: d[0].label, events: c.view(), currentRoot: r2.root, isKnownRoot: knownOnly(r2.root), fetchRootRecord: unused })).source).toBe("device");
    expect(unused).not.toHaveBeenCalled();
    // a crafted record (a cid that drops a member without listing it) does not rebuild to the root
    const crafted = vi.fn(async () => ({ root: r2.root, cid: S.formatRecipe({ ...r2.recipe, considered: 6, excludedLeaves: [] }) }));
    const refused = await rejection(buildAssociationProof({ label: d[0].label, events: noRootEvent, currentRoot: r2.root, isKnownRoot: knownOnly(r2.root), fetchRootRecord: crafted }));
    expect(refused).toMatchObject({ code: "UNVERIFIED_ROOT", detail: "root" });
    // a record of another root is ignored: no cid at all after screened roots
    const other = vi.fn(async () => ({ root: 12345n, cid: r2.cid }));
    const none = await rejection(buildAssociationProof({ label: d[0].label, events: noRootEvent, currentRoot: r2.root, isKnownRoot: knownOnly(r2.root), fetchRootRecord: other }));
    expect(none).toMatchObject({ code: "UNVERIFIED_ROOT", detail: "no_record" });
    expect(none.message).toMatch(/could not be checked on this device.*Sync and try again\./);
    // a failing record request is no record
    const failing = vi.fn(async () => {
      throw new Error("HTTP 500");
    });
    expect(
      (await rejection(buildAssociationProof({ label: d[0].label, events: noRootEvent, currentRoot: r2.root, isKnownRoot: knownOnly(r2.root), fetchRootRecord: failing }))).detail,
    ).toBe("no_record");
  });

  it("fails closed with UNVERIFIED_ROOT for a lowered n, an older policy after a screened root, or a newer policy", async () => {
    const { c, d, r2 } = scene();
    const low = c.postRecipe(20n, 5, [d[1]]); // n 6 → 5: deposit 6 dropped without being listed
    const isKnownRoot = knownOnly(r2.root, low.root);
    for (const label of [d[0].label, d[5].label]) {
      const err = await rejection(buildAssociationProof({ label, events: c.view(), currentRoot: low.root, isKnownRoot }));
      expect(err).toMatchObject({ code: "UNVERIFIED_ROOT", detail: "lowered" });
      expect(err.message).toMatch(/leaves out deposits that an earlier root counted, without listing them as excluded/);
    }
    const prefix = S.setRoot(d.map((x) => x.label));
    c.post(21n, prefix, "open-testnet-policy:count=8:head=21");
    const back = await rejection(buildAssociationProof({ label: d[0].label, events: c.view(), currentRoot: prefix, isKnownRoot: knownOnly(prefix) }));
    expect(back).toMatchObject({ code: "UNVERIFIED_ROOT", detail: "version_backwards" });
    c.post(22n, 77n, "hylsia-asp:v2;whatever");
    const newer = await rejection(buildAssociationProof({ label: d[0].label, events: c.view(), currentRoot: 77n, isKnownRoot: knownOnly(77n) }));
    expect(newer).toMatchObject({ code: "UNVERIFIED_ROOT", detail: "outdated" });
    expect(newer.message).toMatch(/This app is out of date: reload the page\./);
    for (const e of [back, newer]) expect(e.message).not.toMatch(/\bASP\b/);
  });

  it("asks for a publish only when publishDue says so and the note is in the checked root, then proves against the re-read current root", async () => {
    const { c, d, r2 } = scene();
    const before = c.view();
    const r3 = c.postRecipe(30n, 8, [d[1]]);
    const after = c.view();
    const reload = vi.fn(async () => ({ events: after, currentRoot: r3.root }));
    const isKnownRoot = knownOnly(r2.root, r3.root);
    const notDue = vi.fn(async () => r3.root);
    expect(await resolveAssociationProof({ label: d[0].label, state: { events: before, currentRoot: r2.root }, reload, isKnownRoot, requestPublish: notDue, publishDue: false })).toMatchObject({
      root: r2.root,
      size: 5,
    });
    expect(notDue).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    const due = vi.fn(async () => r3.root);
    const proof = await resolveAssociationProof({ label: d[0].label, state: { events: before, currentRoot: r2.root }, reload, isKnownRoot, requestPublish: due, publishDue: true });
    expect(due.mock.calls).toEqual([[]]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(proof).toMatchObject({ root: r3.root, size: 7 });
    // a deposit the checked root does not hold yet stops before the request, due or not: it never asks for its own root
    const held = vi.fn(async () => r3.root);
    expect((await rejection(resolveAssociationProof({ label: d[7].label, state: { events: before, currentRoot: r2.root }, reload, isKnownRoot, requestPublish: held, publishDue: true }))).code).toBe(
      "WAITING",
    );
    expect(held).not.toHaveBeenCalled();
    // the deprecated inputs are accepted and ignored
    const fetchFullSet = vi.fn(async () => [d[7].label]);
    const legacy: AssociationProofInput = { label: d[0].label, events: after, currentRoot: r3.root, isKnownRoot, fetchFullSet, extraRoots: [r2.root] };
    expect((await buildAssociationProof(legacy)).root).toBe(r3.root);
    expect(fetchFullSet).not.toHaveBeenCalled();
  });

  it("raises the shrink alarm for a root that suddenly excludes many deposits (a targeted small crowd), not for one exclusion", async () => {
    const c = chain();
    const d = Array.from({ length: 30 }, (_, k) => c.deposit(10n + BigInt(k), k % 3 === 0 ? BOB : ALICE));
    const full = c.postRecipe(50n, 30);
    const one = c.postRecipe(51n, 30, [d[29]]);
    let events = c.view();
    const isKnownRoot = knownOnly(full.root, one.root);
    expect((await buildAssociationProof({ label: d[0].label, events, currentRoot: one.root, isKnownRoot })).shrink).toBeNull();
    // the operator answers a publish request with 15 deposits left: the suspects plus its own
    const keep = new Set([0, 1, 2, 3, 4, 10, 11, 12, 13, 14, 20, 21, 22, 23, 24]);
    const small = c.postRecipe(52n, 30, d.filter((_, k) => !keep.has(k)));
    events = c.view();
    const announced = S.announcedExclusions(screening({ excluded: [5, 6, 7, 8, 9].map((k) => announce(d[k], "fraud")) }));
    const proof = await buildAssociationProof({ label: d[0].label, events, currentRoot: small.root, isKnownRoot: knownOnly(full.root, one.root, small.root), announced });
    expect(proof).toMatchObject({ size: 15, effectiveSize: 15, announcedOut: 0 });
    expect(proof.shrink).toEqual({ from: 30, to: 15, removed: 15, unexplained: 10, announced: 0, basis: "history", largerRoot: full.root, atBlock: 52n });
    expect(S.shrinkAlarm({ events, current: S.verifySet(small.root, small.cid, events)! })?.unexplained).toBe(15);
    // the threshold: at least max(10, 20% of the larger root)
    expect(S.SHRINK_ALARM_MIN).toBe(10);
    expect(S.SHRINK_ALARM_SHARE).toBe(0.2);
    expect([S.sharpDrop(30, 20), S.sharpDrop(30, 21), S.sharpDrop(100, 80), S.sharpDrop(100, 81)]).toEqual([true, false, true, false]);
  });

  it("a burst or heartbeat of copies never hides the larger root: the last 16 DIFFERENT roots of the device's own history count", () => {
    const c = chain();
    const d = Array.from({ length: 30 }, (_, k) => c.deposit(10n + BigInt(k)));
    const full = c.postRecipe(50n, 30);
    const small = c.postRecipe(51n, 30, d.slice(15));
    // the operator re-posts the small root 15 times (an eviction burst): the large root leaves the contract's ring
    for (let k = 0; k < ASP_ROOT_HISTORY_SIZE - 1; k++) c.post(52n + BigInt(k), small.root, small.cid);
    let events = c.view();
    expect(S.aspRing(events)).toHaveLength(ASP_ROOT_HISTORY_SIZE);
    expect(S.aspRing(events).every((e) => e.root === small.root)).toBe(true);
    expect(S.shrinkAlarm({ events, current: S.verifySet(small.root, small.cid, events)! })).toMatchObject({ from: 30, to: 15, basis: "history", largerRoot: full.root });

    // only 16 more DIFFERENT roots push it out of the comparison: the residual (each a public mass exclusion, on-chain)
    const c2 = chain();
    const e = Array.from({ length: 30 }, (_, k) => c2.deposit(10n + BigInt(k)));
    c2.postRecipe(50n, 30);
    let last = c2.postRecipe(51n, 30, e.filter((_, j) => j < 0 || j >= 14)); // members 0..13
    for (let k = 1; k <= S.SHRINK_ALARM_ROOTS; k++) last = c2.postRecipe(51n + BigInt(k), 30, e.filter((_, j) => j < k || j >= k + 14)); // members k..k+13
    events = c2.view();
    expect(S.shrinkAlarm({ events, current: S.verifySet(last.root, last.cid, events)! })).toBeNull();
    // one different root fewer, and the large root still counts
    const before = c2.view(50n + BigInt(S.SHRINK_ALARM_ROOTS));
    const cur = before.filter((x): x is ASPRootUpdatedEvent => x.kind === "asproot").at(-1)!;
    expect(S.shrinkAlarm({ events: before, current: S.verifySet(cur.root, cur.cid, before)! })).toMatchObject({ from: 30, to: 14, basis: "history" });
  });

  it("an answer that announces every member but one counts them out: the crowd is 1, and the alarm asks (never silently)", async () => {
    const c = chain();
    const d = Array.from({ length: 34 }, (_, k) => c.deposit(10n + BigInt(k)));
    const r = c.postRecipe(50n, 34);
    const events = c.view();
    const target = d[17];
    // the operator tells this one visitor that every member but deposit 17 will be excluded
    const all = S.announcedExclusions(screening({ rootDue: true, excluded: d.filter((x) => x !== target).map((x) => announce(x, "fraud")) }));
    const isKnownRoot = knownOnly(r.root);
    for (const other of [d[0], d[16], d[33]]) {
      expect((await rejection(buildAssociationProof({ label: other.label, events, currentRoot: r.root, isKnownRoot, announced: all }))).code).toBe("REMOVAL_ANNOUNCED");
    }
    const proof = await buildAssociationProof({ label: target.label, events, currentRoot: r.root, isKnownRoot, announced: all });
    expect(proof).toMatchObject({ size: 34, effectiveSize: 1, announcedOut: 33 });
    expect(proof.shrink).toEqual({ from: 34, to: 1, removed: 33, unexplained: 0, announced: 33, basis: "current", largerRoot: r.root, atBlock: 50n });
    // the withdraw form counts the same crowd: 1 (the note itself), not 34
    const preview = previewAssociationSet({ label: target.label, events, currentRoot: r.root, screening: screening({ excluded: d.filter((x) => x !== target).map((x) => announce(x, "fraud")) }) });
    expect(preview).toMatchObject({ covered: 1, announcedOut: 33 });
    expect([...preview.members!]).toEqual([17]);
    // a few announcements (an honest removal) shrink it a little, without a question
    const few = S.announcedExclusions(screening({ excluded: [announce(d[3], "test")] }));
    expect(await buildAssociationProof({ label: target.label, events, currentRoot: r.root, isKnownRoot, announced: few })).toMatchObject({ effectiveSize: 33, shrink: null });
  });
});

// ─── round 2: nothing after a request the operator sees depends on the note ───

describe("withdrawal order: every question before any request, nothing note-dependent after one (review round 2)", () => {
  type State = { events: PoolEvent[]; currentRoot: bigint };
  const asText = (q: WithdrawalQuestion) =>
    `question ${q.kind === "shrink" ? `shrink/${q.alarm.basis} ${q.alarm.from}->${q.alarm.to}` : `small ${q.crowd}`}${q.beforeRequest ? " (before any request)" : ""}`;

  /** WithdrawPanel's crowd for the form (useNext decided the same way for every note: never by nextMembers). */
  function formCrowd(label: bigint, s: State, answer: ASPScreening | null, publisherDown = false): number | null {
    const p = previewAssociationSet({ label, events: s.events, currentRoot: s.currentRoot, screening: answer, record: null });
    const useNext = p.behind && !publisherDown && p.next !== null;
    const members = useNext ? p.nextMembers : p.members;
    return members ? (useNext ? p.next : p.covered) : null;
  }

  /**
   * One attempt as PrivacyProvider.withdraw makes it: the publish decision (publishDue: no label), then
   * resolveAssociationProof with the form's crowd, recording, in order, every request the operator sees and every
   * question; "proof in N" stands for what follows (the relayer's quote), which reads no label.
   */
  async function attempt(o: {
    label: bigint;
    state: State;
    answer: ASPScreening | null;
    onPublish?: () => State | null;
    yes?: boolean;
    /** the person's answer per question (default: `yes`) */
    say?: (q: WithdrawalQuestion) => boolean;
    /** every question asked, in order */
    questions?: WithdrawalQuestion[];
    publishDue?: boolean;
  }) {
    const seq: string[] = [];
    let state = o.state;
    const screening = S.validScreening(o.answer);
    const due = o.publishDue ?? S.publishDue({ events: state.events, currentRoot: state.currentRoot, screening });
    const outcome = await resolveAssociationProof({
      label: o.label,
      state,
      reload: async () => state,
      isKnownRoot: async () => true,
      fetchRootRecord: async () => (seq.push("asp.set"), null),
      announced: S.announcedExclusions(screening),
      publishDue: due,
      expectedCrowd: formCrowd(o.label, o.state, screening),
      ask: async (q) => (seq.push(asText(q)), o.questions?.push(q), o.say ? o.say(q) : (o.yes ?? false)),
      requestPublish: async () => {
        seq.push("asp.publish");
        const next = o.onPublish?.() ?? null;
        if (!next) return null;
        state = next;
        return next.currentRoot;
      },
    }).then(
      (p) => (seq.push(`proof in ${p.effectiveSize}`), "proved"),
      (e: unknown) => (e instanceof AssociationProofError ? e.code : String(e)),
    );
    return { seq, outcome, due };
  }

  /** n deposits, and a v1 root over the first `k` of them minus `x` as the current root (posted at block 100) */
  function pool(n: number, k: number, x: number[] = []) {
    const c = chain();
    const d = Array.from({ length: n }, (_, i) => c.deposit(10n + BigInt(i)));
    const r = c.postRecipe(100n, k, x.map((i) => d[i]));
    return { c, d, r, state: { events: c.view(), currentRoot: r.root } as State };
  }
  const snapshotOf = (c: ReturnType<typeof chain>, n: number, x: DepositedEvent[], memberCount: number) =>
    ({ asOfBlock: "200", asOfTime: 0, considered: n, memberCount, waiting: 0, root: "1", cid: S.formatRecipe({ version: 1, considered: n, excludedLeaves: x.map((e) => e.leafIndex).sort((a, b) => a - b), asOfBlock: 200n, asOfTime: 0, delaySeconds: 0, confirmations: 1 }) }) as ASPScreening["snapshot"];

  it("an answer that announces every member but one, with a root due: the question comes before any request, and no request goes out for it", async () => {
    const { d, r, state } = pool(34, 34);
    const target = d[17];
    const answer = screening({ rootDue: true, current: { root: r.root.toString(), cid: r.cid, status: "verified", considered: 34, memberCount: 34 }, excluded: d.filter((x) => x !== target).map((x) => announce(x, "fraud")) });
    // its announcements alone shrink the root sharply: its rootDue is not followed (publishDue), whatever the note
    expect(S.announcementsShrinkCurrent({ events: state.events, currentRoot: state.currentRoot, screening: answer })).toBe(true);
    const declined = await attempt({ label: target.label, state, answer });
    expect(declined).toMatchObject({ due: false, outcome: "DECLINED", seq: ["question shrink/current 34->1 (before any request)"] });
    const accepted = await attempt({ label: target.label, state, answer, yes: true });
    expect(accepted.seq).toEqual(["question shrink/current 34->1 (before any request)", "proof in 1"]);
    // whatever the caller decides (an explicit publishDue: since round 3 no pool's due root makes it true while this
    // answer holds, publicData.test.ts), the request goes out only after the question
    const due = await attempt({ label: target.label, state, answer, yes: true, publishDue: true });
    expect(due.seq).toEqual(["question shrink/current 34->1 (before any request)", "asp.publish", "proof in 1"]);
    // an honest server announces a removal next to rootDue: a few announcements are followed
    const few = screening({ rootDue: true, excluded: [announce(d[3])] });
    expect(S.publishDue({ events: state.events, currentRoot: state.currentRoot, screening: few })).toBe(true);
  });

  it("a small pool: announcements that leave a crowd below 10 (no sharp drop) are asked about before the request", async () => {
    const { d, state } = pool(9, 9);
    const answer = screening({ rootDue: true, excluded: d.slice(1).map((x) => announce(x)) }); // all but deposit 0
    const r = await attempt({ label: d[0].label, state, answer });
    expect(r).toMatchObject({ due: true, outcome: "DECLINED", seq: ["question small 1 (before any request)"] });
    expect((await attempt({ label: d[0].label, state, answer, yes: true })).seq).toEqual(["question small 1 (before any request)", "asp.publish", "proof in 1"]);
    // the same when the pool is just small (no announcement): the request would come from one of these 9
    expect((await attempt({ label: d[0].label, state, answer: screening({ rootDue: true }) })).seq).toEqual(["question small 9 (before any request)"]);
  });

  it("two notes the root holds make the same requests and get the same questions, whatever the answer and whatever is posted in reply", async () => {
    const { c, d, r, state } = pool(50, 30);
    const [A, B] = [d[5], d[6]];
    const current = { root: r.root.toString(), cid: r.cid, status: "verified" as const, considered: 30, memberCount: 30 };
    // what the operator posts when the publish request arrives
    const bigger = () => {
      const c2 = chain();
      for (const e of c.events) c2.events.push(e);
      const next = c2.postRecipe(300n, 50);
      return { events: c2.view(), currentRoot: next.root };
    };
    const dropping = (victim: DepositedEvent) => () => {
      const c2 = chain();
      for (const e of c.events) c2.events.push(e);
      const next = c2.postRecipe(300n, 30, [victim]);
      return { events: c2.view(), currentRoot: next.root };
    };
    const answers: [string, ASPScreening][] = [
      ["honest, nothing due", screening({ current })],
      ["honest, a root due", screening({ rootDue: true, current, snapshot: snapshotOf(c, 50, [], 50) })],
      // round 2, finding privacy-2: B's leaf in the snapshot's x without announcing B, n inflated
      ["a snapshot that lists an unannounced member", screening({ rootDue: true, current, snapshot: snapshotOf(c, 50, [B], 49) })],
      ["an inflated snapshot, posted or not", screening({ rootDue: true, current, snapshot: snapshotOf(c, 50, [], 50) })],
      ["a few announcements", screening({ rootDue: true, current, excluded: [announce(d[20]), announce(d[21])] })],
    ];
    const replies: [string, (() => State | null) | undefined][] = [
      ["nothing posted", undefined],
      ["a larger root", bigger],
      ["a root that drops A", dropping(A)],
      ["a root that drops B", dropping(B)],
    ];
    for (const [what, answer] of answers) {
      expect(formCrowd(A.label, state, answer), what).toBe(formCrowd(B.label, state, answer));
      for (const [reply, onPublish] of replies) {
        for (const yes of [false, true]) {
          const a = await attempt({ label: A.label, state, answer, onPublish, yes });
          const b = await attempt({ label: B.label, state, answer, onPublish, yes });
          expect({ what, reply, yes, ...b }).toEqual({ what, reply, yes, ...a });
        }
      }
    }
    // the finding's case, exactly: the forged snapshot shows every note the current crowd (30), and nothing differs
    const forged = answers[2][1];
    expect(formCrowd(A.label, state, forged)).toBe(30);
    expect((await attempt({ label: B.label, state, answer: forged })).seq).toEqual(["asp.publish", "proof in 30"]);
    // the inflated snapshot (consistent): every note sees 50, and every note is asked again once nothing came
    expect((await attempt({ label: A.label, state, answer: answers[3][1] })).seq).toEqual(["asp.publish", "question shrink/form 50->30"]);
  });

  it("a root posted in reply that drops a member nobody announced stops the withdrawal for every note alike (SET_CHANGED)", async () => {
    // review round 2, finding docs-1: an operator that suspects deposit 5 excludes it right after a withdrawal asks
    const { c, d, state } = pool(13, 12);
    const suspect = d[5];
    const answer = screening({ rootDue: true, snapshot: snapshotOf(c, 13, [], 13) });
    const reply = () => {
      const c2 = chain();
      for (const e of c.events) c2.events.push(e);
      const next = c2.postRecipe(300n, 13, [suspect]);
      return { events: c2.view(), currentRoot: next.root };
    };
    const runs = await Promise.all([suspect, d[7], d[0]].map((x) => attempt({ label: x.label, state, answer, onPublish: reply })));
    for (const r of runs) expect(r).toEqual({ due: true, outcome: "SET_CHANGED", seq: ["asp.publish"] });
    expect(setChangedMessage(1)).toMatch(
      /leaves out 1 deposit that was in it a moment ago, whose exclusion the operator's status, as this app last read it, did not announce \(an exclusion announced since then stops a withdrawal this way too\)\. No withdrawal was sent\. A new attempt is proved against the new set; the app asks first only if that set is small or shrank sharply/,
    );
    expect(setChangedMessage(3)).toMatch(/leaves out 3 deposits that were in it a moment ago/);
    // round 3: it promises no question the retry may not ask
    expect(setChangedMessage(1)).not.toMatch(/asks about the new set first/);
    // an honest removal root (it drops only the deposit the answer announced) goes on, for every note alike
    const honest = screening({ rootDue: true, excluded: [announce(suspect)], snapshot: snapshotOf(c, 13, [suspect], 12) });
    const removal = await Promise.all([d[7], d[0]].map((x) => attempt({ label: x.label, state, answer: honest, onPublish: reply })));
    for (const r of removal) expect(r).toEqual({ due: true, outcome: "proved", seq: ["asp.publish", "proof in 12"] });
  });

  /** a reply root posted after the base pool's events: a v1 root over the first n deposits minus x */
  const replyRoot = (c: ReturnType<typeof chain>, n: number, x: DepositedEvent[]) => () => {
    const c2 = chain();
    for (const e of c.events) c2.events.push(e);
    const next = c2.postRecipe(300n, n, x);
    return { events: c2.view(), currentRoot: next.root };
  };

  it("after a question asked before the request, the crowd proved in is still compared with the form's figure (review round 3)", async () => {
    // the docs review's case D: a current root of 8, a snapshot that fits with 40 (the form shows 40), a reply root of 9
    {
      const { c, d, state } = pool(40, 8);
      const answer = screening({ rootDue: true, snapshot: snapshotOf(c, 40, [], 40) });
      expect(formCrowd(d[2].label, state, answer)).toBe(40);
      const smaller = await attempt({ label: d[2].label, state, answer, yes: true, onPublish: replyRoot(c, 9, []) });
      expect(smaller.seq).toEqual(["question small 8 (before any request)", "asp.publish", "question shrink/form 40->9", "proof in 9"]);
      const declined = await attempt({ label: d[2].label, state, answer, say: (q) => q.kind === "small", onPublish: replyRoot(c, 9, []) });
      expect(declined).toMatchObject({ outcome: "DECLINED", seq: ["question small 8 (before any request)", "asp.publish", "question shrink/form 40->9"] });
      // the root the form described: no second question
      expect((await attempt({ label: d[2].label, state, answer, yes: true, onPublish: replyRoot(c, 40, []) })).seq).toEqual([
        "question small 8 (before any request)",
        "asp.publish",
        "proof in 40",
      ]);
      // no new root came (an unfunded publisher, say): proved in the current 8, not the 40 the first question quoted
      expect((await attempt({ label: d[2].label, state, answer, yes: true })).seq).toEqual([
        "question small 8 (before any request)",
        "asp.publish",
        "question shrink/form 40->8",
        "proof in 8",
      ]);
    }
    // the verifier's case V5: a root of 10 whose every member but T is announced (no sharp drop: the request is due),
    // the form shows the snapshot's 3; a reply root that holds T alone is a public link: asked again, 3 -> 1
    {
      const { c, d, state } = pool(12, 10);
      const T = d[0];
      const out = d.slice(1, 10);
      const answer = screening({ rootDue: true, excluded: out.map((x) => announce(x)), snapshot: snapshotOf(c, 12, out, 3) });
      expect(S.publishDue({ events: state.events, currentRoot: state.currentRoot, screening: answer })).toBe(true);
      expect(formCrowd(T.label, state, answer)).toBe(3);
      const questions: WithdrawalQuestion[] = [];
      const alone = await attempt({ label: T.label, state, answer, yes: true, questions, onPublish: replyRoot(c, 12, d.slice(1)) });
      expect(alone.seq).toEqual(["question small 1 (before any request)", "asp.publish", "question shrink/form 3->1", "proof in 1"]);
      // the small question names the root on-chain apart from what this app counts (finding docs-1)
      expect(questions[0]).toMatchObject({ kind: "small", crowd: 1, onChain: 10, announced: 9, expected: 3, beforeRequest: true, publishes: true });
      // the operator's own snapshot posted in reply: the crowd the first question quoted, no second question
      expect((await attempt({ label: T.label, state, answer, yes: true, onPublish: replyRoot(c, 12, out) })).seq).toEqual([
        "question small 1 (before any request)",
        "asp.publish",
        "proof in 3",
      ]);
    }
  });

  it("the small-set question counts the announced members apart, with or without a request (round 3)", async () => {
    const { d, state } = pool(10, 10);
    const answer = screening({ rootDue: false, excluded: d.slice(1).map((x) => announce(x)) }); // all but d[0], nothing due
    const questions: WithdrawalQuestion[] = [];
    const r = await attempt({ label: d[0].label, state, answer, questions });
    expect(r).toMatchObject({ due: false, outcome: "DECLINED", seq: ["question small 1 (before any request)"] });
    expect(questions).toEqual([{ kind: "small", crowd: 1, onChain: 10, announced: 9, expected: 1, beforeRequest: true, publishes: false }]);
    // a plain small pool: nothing announced, the crowd is the set on-chain
    const small = pool(9, 9);
    const plain: WithdrawalQuestion[] = [];
    await attempt({ label: small.d[0].label, state: small.state, answer: screening(), questions: plain });
    expect(plain).toEqual([{ kind: "small", crowd: 9, onChain: 9, announced: 0, expected: 9, beforeRequest: true, publishes: false }]);
  });

  it("the shrink alarm counts only roots that verify: 16 garbage roots never push a larger root out; 16 real smaller roots still do", () => {
    const c = chain();
    const d = Array.from({ length: 34 }, (_, k) => c.deposit(10n + BigInt(k)));
    c.postRecipe(50n, 34);
    const keep = new Set([1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 33]);
    const x = d.filter((_, k) => !keep.has(k));
    const base = c.view();
    const small = (() => {
      const recipe = { version: 1 as const, considered: 34, excludedLeaves: x.map((e) => e.leafIndex), asOfBlock: 90n, asOfTime: timeOf(90n), delaySeconds: 0, confirmations: 1 };
      return { root: S.setRoot(S.recipeLabels(base, recipe)!), cid: S.formatRecipe(recipe), recipe };
    })();
    const withPosts = (posts: { root: bigint; cid: string }[]) => {
      const ev: PoolEvent[] = [...base];
      let li = 0;
      for (const p of [...posts, small]) ev.push({ kind: "asproot", root: p.root, cid: p.cid, blockNumber: 91n, txHash: keccak256(toBytes(`g-${li}-${p.root}`)), logIndex: li++ });
      return ev;
    };
    const alarm = (ev: PoolEvent[]) => S.shrinkAlarm({ events: ev, current: S.verifySet(small.root, small.cid, ev)! });
    // the review's case G: 16 different values no record of which rebuilds to them, in one block (a cid that is not
    // a recipe, the small root's own cid, or none), then the small root
    for (const cid of ["x", small.cid, ""]) {
      const garbage = Array.from({ length: S.SHRINK_ALARM_ROOTS }, (_, k) => ({ root: 987_654_321n + BigInt(k) * 7_777n, cid }));
      expect(alarm(withPosts(garbage)), `garbage cid ${JSON.stringify(cid)}`).toMatchObject({ from: 34, to: 12, basis: "history" });
    }
    // what is left (documented): 16 different smaller roots that verify, each a public mass exclusion with its record
    const real = Array.from({ length: S.SHRINK_ALARM_ROOTS }, (_, k) => {
      const out = [...x, d[[...keep][k % keep.size]]].map((e) => e.leafIndex);
      const extra = k >= keep.size ? [d[[...keep][(k + 1) % keep.size]].leafIndex] : [];
      const recipe = { ...small.recipe, excludedLeaves: [...new Set([...out, ...extra])].sort((a, b) => a - b) };
      return { root: S.setRoot(S.recipeLabels(base, recipe)!), cid: S.formatRecipe(recipe) };
    });
    expect(new Set(real.map((p) => p.root)).size).toBe(S.SHRINK_ALARM_ROOTS);
    expect(alarm(withPosts(real))).toBeNull();
    // the work is bounded: SHRINK_ALARM_SCAN different values are looked at; one more garbage value than that, and the
    // larger root is out of reach (it costs the operator four times the posts of the cheaper way above)
    expect(S.SHRINK_ALARM_SCAN).toBe(4 * S.SHRINK_ALARM_ROOTS);
    const many = (k: number) => Array.from({ length: k }, (_, i) => ({ root: 555_000_000n + BigInt(i), cid: "x" }));
    expect(alarm(withPosts(many(S.SHRINK_ALARM_SCAN - 1)))).toMatchObject({ from: 34, to: 12 });
    expect(alarm(withPosts(many(S.SHRINK_ALARM_SCAN)))).toBeNull();
  });

  it("a recipe's root is checked from shared layers, the same as setRoot, at every size and exclusion set", () => {
    const c = chain();
    const d = Array.from({ length: 37 }, (_, k) => c.deposit(10n + BigInt(k)));
    c.withdraw(60n); // a change note between deposits: its leaf never counts
    d.push(c.deposit(61n), c.deposit(62n));
    const events = c.view();
    const sets = [[], [0], [5, 6, 7], [38], d.filter((_, k) => k % 3 === 1).map((_, k) => k * 3 + 1)];
    for (const ks of sets) {
      for (const n of [0, 1, 2, 3, 7, 8, 16, 17, 31, 32, 33, 38, 39]) {
        const x = ks.filter((k) => k < n).map((k) => d[k]);
        if (x.length > n) continue;
        const recipe = { version: 1 as const, considered: n, excludedLeaves: x.map((e) => e.leafIndex).sort((a, b) => a - b), asOfBlock: 70n, asOfTime: 1, delaySeconds: 0, confirmations: 1 };
        const members = d.slice(0, n).filter((e) => !x.includes(e)).map((e) => e.label);
        const root = new MerkleTree(TREE_DEPTH, members).root;
        const cid = S.formatRecipe(recipe);
        expect(S.verifySet(root, cid, events)?.memberCount, `n=${n} x=${recipe.excludedLeaves}`).toBe(members.length);
        expect(S.checkRoot({ root: root + 1n, cid, events }).status).toBe("mismatch");
      }
    }
  });

  it("the shrink alarm gives the same answer when it skips roots whose records cannot claim enough members (round 3)", () => {
    // reference: every candidate checked (the newest SHRINK_ALARM_SCAN different values, the first SHRINK_ALARM_ROOTS
    // that verify), no claim bound
    const reference = (events: readonly PoolEvent[], current: S.VerifiedSet): number | null => {
      const posts = events
        .filter((e): e is ASPRootUpdatedEvent => e.kind === "asproot" && e.root !== 0n)
        .sort((a, b) => (a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber < b.blockNumber ? 1 : -1));
      const records = new Map<bigint, ASPRootUpdatedEvent[]>();
      for (const e of posts) {
        if (e.root === current.root) continue;
        if (!records.has(e.root)) {
          if (records.size === S.SHRINK_ALARM_SCAN) continue;
          records.set(e.root, []);
        }
        records.get(e.root)!.push(e);
      }
      let verified = 0;
      let best = 0;
      for (const [root, recs] of records) {
        if (verified === S.SHRINK_ALARM_ROOTS) break;
        const hit = recs.map((e) => S.checkRoot({ root, cid: e.cid, events, at: { blockNumber: e.blockNumber, logIndex: e.logIndex } })).find((c) => c.status === "verified");
        if (hit?.status !== "verified") continue;
        verified++;
        best = Math.max(best, hit.set.memberCount);
      }
      const from = Math.max(best, current.memberCount);
      return S.sharpDrop(from, current.memberCount) ? from : null;
    };
    // a seeded generator (mulberry32): the same histories on every run
    let seed = 0x5eed;
    const rand = (k: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % k;
    };
    let alarms = 0;
    let cases = 0;
    for (let run = 0; run < 30; run++) {
      const c = chain();
      const n = 30 + rand(24);
      const d = Array.from({ length: n }, (_, k) => c.deposit(10n + BigInt(k)));
      const pick = (m: number, oneIn: number) => d.slice(0, m).filter(() => rand(oneIn) === 0);
      let block = 100n;
      for (let p = rand(14); p > 0; p--, block++) {
        const kind = rand(4);
        const m = Math.ceil(n / 2) + rand(Math.floor(n / 2));
        if (kind === 0 || kind === 1) c.postRecipe(block, m, pick(m, 8)); // a real root, often of another exclusion set
        else if (kind === 2) c.post(block, 900_000n + BigInt(rand(1_000)), S.formatRecipe({ version: 1, considered: m, excludedLeaves: [], asOfBlock: block, asOfTime: 0, delaySeconds: 0, confirmations: 1 })); // garbage with a claim
        else {
          const earlier = c.events.filter((e): e is ASPRootUpdatedEvent => e.kind === "asproot");
          if (earlier.length > 0) {
            const e = earlier[rand(earlier.length)];
            c.post(block, e.root, e.cid); // a re-post
          }
        }
      }
      // the current root: a few exclusions (no alarm can come), or many (some histories raise it)
      const m = n - rand(3);
      const cur = c.postRecipe(block, m, pick(m, rand(3) === 0 ? 10 : 2));
      const events = c.view();
      const set = S.checkRoot({ root: cur.root, cid: cur.cid, events, at: { blockNumber: block, logIndex: 0 } });
      if (set.status !== "verified") continue; // a lowered n: not a root a device proves against
      cases++;
      const alarm = S.shrinkAlarm({ events: c.view(), current: set.set });
      expect(alarm?.from ?? null, `run ${run}`).toBe(reference(c.view(), set.set));
      if (alarm) alarms++;
    }
    expect(cases).toBeGreaterThan(20);
    expect(alarms).toBeGreaterThan(5);
    expect(cases - alarms).toBeGreaterThan(5);
  });

  it("the shrink alarm verifies no earlier root that could not raise it: 16 different exclusion sets cost little (round 3)", () => {
    const c = chain();
    const d = Array.from({ length: 400 }, (_, k) => c.deposit(10n + BigInt(k)));
    // 16 real roots, each of another exclusion set of 20 deposits: 380 members each
    for (let k = 0; k < S.SHRINK_ALARM_ROOTS; k++) c.postRecipe(100n + BigInt(k), 400, d.filter((_, i) => i % 16 === k).slice(0, 20));
    const base = c.view();
    const withCurrent = (x: DepositedEvent[]) => {
      const c2 = chain();
      for (const e of base) c2.events.push(e);
      const r = c2.postRecipe(200n, 400, x);
      const events = c2.view();
      const set = S.checkRoot({ root: r.root, cid: r.cid, events, at: { blockNumber: 200n, logIndex: 0 } });
      if (set.status !== "verified") throw new Error("current root does not verify");
      return { events, current: set.set };
    };
    const timed = (o: { events: PoolEvent[]; current: S.VerifiedSet }) => {
      const t = performance.now();
      const alarm = S.shrinkAlarm(o);
      return { alarm, ms: performance.now() - t };
    };
    // a crowd of 395: no root of 380 can shrink it, so none is verified
    const fast = timed(withCurrent(d.slice(0, 5)));
    // a crowd of 300: 380 -> 300 is a sharp drop, so the earlier roots are verified (and one raises the alarm)
    const slow = timed(withCurrent(d.slice(100, 200)));
    expect(fast.alarm).toBeNull();
    expect(slow.alarm).toMatchObject({ from: 380, to: 300, basis: "history" });
    expect(fast.ms * 5).toBeLessThan(slow.ms);
  });

  it("the publisher's snapshot keeps exclusions it is told to keep (the chain's own, while its list cannot be read), without announcing them", () => {
    const c = chain();
    const d = Array.from({ length: 5 }, (_, k) => c.deposit(10n + BigInt(k)));
    const snap = S.screenDeposits({
      deposits: c.view(),
      head: { block: 30n, time: timeOf(30n) },
      confirmations: 1,
      delaySeconds: 0,
      blockTime: timeOf,
      exclude: () => null, // no list read
      previousConsidered: 5,
      keepExcluded: new Set([d[1].leafIndex, d[3].leafIndex]),
    });
    expect(snap).toMatchObject({ recipe: { considered: 5, excludedLeaves: [d[1].leafIndex, d[3].leafIndex] }, memberCount: 3, excluded: [], waiting: 0 });
    expect(snap.labels).toEqual([d[0].label, d[2].label, d[4].label]);
  });
});

// ─── the device's states ──────────────────────────────────────────────────────

describe("screeningState: worked out on the device", () => {
  function scene() {
    const c = chain();
    const d = [c.deposit(10n), c.deposit(10n, BOB)];
    c.withdraw(11n);
    d.push(c.deposit(12n), c.deposit(13n), c.deposit(14n), c.deposit(15n), c.deposit(16n), c.deposit(17n));
    const r1 = c.postRecipe(18n, 4);
    const r2 = c.postRecipe(19n, 6, [d[1]]);
    return { c, d, r1, r2 };
  }

  it("in the set, with the next root's size when one is due", () => {
    const { c, d, r2 } = scene();
    const base = { events: c.view(), currentRoot: r2.root };
    expect(S.screeningState({ ...base, label: d[0].label })).toEqual({ kind: "in_set", size: 5, next: null });
    const s = screening({ rootDue: true, snapshot: { asOfBlock: "20", asOfTime: 0, considered: 8, memberCount: 7, waiting: 0, root: "1", cid: null } });
    expect(S.screeningState({ ...base, label: d[0].label, screening: s })).toEqual({ kind: "in_set", size: 5, next: 7 });
  });

  it("waiting: inside the delay, or eligible for the next root", () => {
    const { c, d, r2 } = scene();
    const base = { events: c.view(), currentRoot: r2.root, label: d[6].label };
    const t = timeOf(16n);
    expect(S.screeningState({ ...base, depositTime: t, now: t + 100, delaySeconds: 3_600 })).toEqual({ kind: "waiting", why: "delay", eligibleAt: t + 3_600, announced: false });
    expect(S.screeningState({ ...base, depositTime: t, now: t + 3_600, delaySeconds: 3_600 })).toMatchObject({ why: "next_root", eligibleAt: t + 3_600 });
    expect(S.screeningState({ ...base, delaySeconds: 0 })).toMatchObject({ kind: "waiting", why: "next_root" });
    expect(S.screeningState(base)).toEqual({ kind: "waiting", why: "delay", eligibleAt: null, announced: false });
    // the operator's snapshot already counts it: eligible, with the next root
    const s = screening({ rootDue: true, snapshot: { asOfBlock: "20", asOfTime: 0, considered: 7, memberCount: 6, waiting: 1, root: "1", cid: null } });
    expect(S.screeningState({ ...base, screening: s, depositTime: t, now: t + 10 })).toMatchObject({ kind: "waiting", why: "next_root" });
    // the screening answer's delay wins over the registry's
    expect(S.screeningState({ ...base, screening: screening({ delaySeconds: 60 }), depositTime: t, now: t + 61, delaySeconds: 3_600 })).toMatchObject({ why: "next_root", eligibleAt: t + 60 });
    // nothing published yet
    expect(S.screeningState({ ...base, currentRoot: 0n, delaySeconds: 0 })).toMatchObject({ kind: "waiting", why: "next_root" });
    // announced beyond n: waiting, exclusion announced
    expect(S.screeningState({ ...base, screening: screening({ excluded: [announce(d[6], "fraud", { considered: false })] }) })).toMatchObject({ kind: "waiting", announced: true });
  });

  it("excluded only on on-chain evidence: a leaf in the verified root's x; removed when an earlier root counted it", () => {
    const { c, d, r2 } = scene();
    const base = { events: c.view(), currentRoot: r2.root, label: d[1].label };
    expect(S.screeningState(base)).toEqual({ kind: "excluded", reason: null, removed: true, listed: true });
    expect(S.screeningState({ ...base, screening: screening({ excluded: [announce(d[1], "sanctions")] }) })).toEqual({ kind: "excluded", reason: "sanctions", removed: true, listed: true });
    // excluded before it ever joined: not "removed"
    const c2 = chain();
    const e = [c2.deposit(10n), c2.deposit(11n)];
    const r = c2.postRecipe(12n, 2, [e[1]]);
    expect(S.screeningState({ events: c2.view(), currentRoot: r.root, label: e[1].label })).toEqual({ kind: "excluded", reason: null, removed: false, listed: true });
  });

  it("an exclusion lifted: back in the set with the next root", () => {
    const { c, d } = scene();
    const r3 = c.postRecipe(20n, 6);
    expect(S.screeningState({ events: c.view(), currentRoot: r3.root, label: d[1].label })).toEqual({ kind: "in_set", size: 6, next: null });
  });

  it("an announced removal of a member is removal_announced, never excluded; overdue when the operator's answer and the chain disagree", () => {
    const { c, d, r2 } = scene();
    const t = timeOf(19n);
    // timed from when this device first saw the announcement (the answer carries no time of the operator's)
    const base = { events: c.view(), currentRoot: r2.root, label: d[3].label, now: t + 100, announcedSince: t };
    const ann = (o: Partial<ExcludedDeposit> = {}) => [announce(d[3], "stolen-funds", o)];
    // the answer's own record of the current root: the same root this device holds
    const current = { root: r2.root.toString(), cid: r2.cid, status: "verified" as const, considered: 6, memberCount: 5 };
    const answer = (o: Partial<ASPScreening>) => screening({ current, excluded: ann(), ...o });
    expect(S.screeningState({ ...base, screening: answer({ rootDue: true }) })).toEqual({
      kind: "removal_announced",
      reason: "stolen-funds",
      size: 5,
      overdue: false,
    });
    // no removal root although the publisher runs and could post: past one interval + the settle time + grace
    const late = { ...base, now: t + 600 + 30 + S.ANNOUNCEMENT_GRACE_SECONDS + 1 };
    expect(S.screeningState({ ...late, screening: answer({ rootDue: true }) })).toMatchObject({ overdue: true });
    expect(S.screeningState({ ...late, now: late.now - 1, screening: answer({ rootDue: true }) })).toMatchObject({ overdue: false });
    expect(S.screeningState({ ...late, canPublish: false, screening: answer({ rootDue: true }) })).toMatchObject({ overdue: false });
    expect(S.screeningState({ ...late, screening: answer({ rootDue: true, autoPublish: { running: false, seconds: 600 } }) })).toMatchObject({ overdue: false });
    // not timed (this device has not dated it yet): never overdue by time
    expect(S.screeningState({ ...late, announcedSince: null, screening: answer({ rootDue: true }) })).toMatchObject({ overdue: false });
    // the answer says no root is due while it announces a removal the chain does not show
    expect(S.screeningState({ ...base, screening: answer({ rootDue: false }) })).toMatchObject({ kind: "removal_announced", overdue: true });
    // ... no contradiction while its list is settling (an edit that also lifts an exclusion waits 30 s) ...
    expect(S.screeningState({ ...base, screening: answer({ rootDue: false, settling: true }) })).toMatchObject({ kind: "removal_announced", overdue: false });
    // ... nor when the answer is about another root than this device's (one of them is behind), or names none
    const newer = { ...current, root: (r2.root + 1n).toString() };
    expect(S.screeningState({ ...base, screening: answer({ rootDue: false, current: newer }) })).toMatchObject({ kind: "removal_announced", overdue: false });
    expect(S.screeningState({ ...late, screening: answer({ rootDue: true, current: null }) })).toMatchObject({ kind: "removal_announced", overdue: false });
  });

  it("a record that lies about the split never marks a deposit excluded: a lowered cid on an unchanged root, or a server's record", async () => {
    const c = chain();
    const d = Array.from({ length: 20 }, (_, k) => c.deposit(10n + BigInt(k)));
    const full = c.postRecipe(40n, 20);
    // one duplicate post of the CURRENT root whose cid claims n=0: the newest cid wins, but its list does not hash to
    // the root, so it is no "lowered" root and nothing is shown as excluded
    c.post(41n, full.root, "hylsia-asp:v1;n=0;x=;asOf=40;t=1;delay=0;conf=1");
    const events = c.view();
    expect(S.checkCurrentRoot({ events, currentRoot: full.root })?.check).toMatchObject({ status: "mismatch", problem: "root" });
    for (const x of [d[0], d[7], d[19]]) expect(S.screeningState({ events, currentRoot: full.root, label: x.label })).toEqual({ kind: "unverified", problem: "root" });

    // two splits of one root: posted n=19 (deposit 19 not considered yet); a server's record claims n=20, x={19}
    const c2 = chain();
    const e = Array.from({ length: 20 }, (_, k) => c2.deposit(10n + BigInt(k)));
    const posted = c2.postRecipe(40n, 19);
    const lying = S.formatRecipe({ ...posted.recipe, considered: 20, excludedLeaves: [e[19].leafIndex] });
    expect(S.recipeLabels(c2.view(), S.parseRecipe(lying)!)).toEqual(posted.labels); // the same members: the same root
    const lagging = c2.view(39n); // this device lacks the root's own event
    const viaRecord = S.screeningState({ events: lagging, currentRoot: posted.root, label: e[19].label, record: { root: posted.root, cid: lying } });
    expect(viaRecord).toMatchObject({ kind: "waiting", announced: true });
    // its own event decides once it has it: the honest split (waiting, nothing announced)
    expect(S.screeningState({ events: c2.view(), currentRoot: posted.root, label: e[19].label, record: { root: posted.root, cid: lying } })).toMatchObject({
      kind: "waiting",
      announced: false,
    });
    // members are members either way
    expect(S.screeningState({ events: lagging, currentRoot: posted.root, label: e[0].label, record: { root: posted.root, cid: lying } })).toMatchObject({ kind: "in_set" });
    // the withdraw path: the same lying split through privacy.asp.set (fetchRootRecord) holds the tail deposit back
    // (WAITING, announced), with no ragequit advice; the honest record says WAITING; a member proves either way
    const isKnownRoot = knownOnly(posted.root);
    const proveWith = (label: bigint, cid: string) => buildAssociationProof({ label, events: lagging, currentRoot: posted.root, isKnownRoot, fetchRootRecord: async () => ({ root: posted.root, cid }) });
    const held = await rejection(proveWith(e[19].label, lying));
    expect(held).toMatchObject({ code: "WAITING", detail: "announced" });
    expect(held.message).not.toMatch(/ragequit|public exit/i);
    expect(await rejection(proveWith(e[19].label, posted.cid))).toMatchObject({ code: "WAITING", detail: null });
    expect(await proveWith(e[0].label, lying)).toMatchObject({ root: posted.root, size: 19, source: "full-set" });
  });

  it("a lowered n shows the dropped deposit as excluded with no reason, and the root as unverified for the others", () => {
    const { c, d } = scene();
    const low = c.postRecipe(20n, 3); // R1 counted four deposits: the fourth (d[3]) is dropped unlisted
    const base = { events: c.view(), currentRoot: low.root };
    expect(S.screeningState({ ...base, label: d[3].label })).toEqual({ kind: "excluded", reason: null, removed: true, listed: false });
    expect(S.screeningState({ ...base, label: d[0].label })).toEqual({ kind: "unverified", problem: "lowered" });
    expect(S.screeningState({ ...base, label: d[7].label })).toEqual({ kind: "unverified", problem: "lowered" });
  });

  it("unverified roots, deposits this device does not hold, and answers of another shape", () => {
    const { c, d, r2 } = scene();
    expect(S.screeningState({ events: c.view(16n), currentRoot: r2.root, label: d[0].label })).toEqual({ kind: "unverified", problem: "no_record" });
    expect(S.screeningState({ events: c.view(16n), currentRoot: r2.root, label: d[0].label, record: { root: r2.root, cid: r2.cid } })).toEqual({ kind: "in_set", size: 5, next: null });
    expect(S.screeningState({ events: c.view(), currentRoot: r2.root, label: computeLabel(SCOPE, 999n) })).toEqual({ kind: "unknown" });
    c.post(30n, 99n, "hylsia-asp:v2;n=1");
    expect(S.screeningState({ events: c.view(), currentRoot: 99n, label: d[0].label })).toEqual({ kind: "unverified", problem: "outdated" });
    // an answer of another shape is ignored: the device uses on-chain data only
    const odd = { ...screening({ rootDue: true, excluded: [announce(d[0])] }), autoPublish: "yes" } as unknown as ASPScreening;
    expect(S.validScreening(odd)).toBeNull();
    expect(S.screeningState({ events: c.view(19n), currentRoot: r2.root, label: d[0].label, screening: odd })).toEqual({ kind: "in_set", size: 5, next: null });
  });
});

// ─── the publish decision, the preview, the wording ───────────────────────────

describe("publishDue: no label, the operator's rootDue or the open policy's rule", () => {
  it("follows a valid screening answer, else compares the current root with every deposit held", () => {
    const c = chain();
    const d = [c.deposit(10n), c.deposit(11n)];
    const events = c.view();
    const all = S.setRoot(d.map((x) => x.label));
    expect(S.publishDue({ events, currentRoot: 0n })).toBe(true);
    expect(S.publishDue({ events, currentRoot: all })).toBe(false);
    expect(S.publishDue({ events: [], currentRoot: 0n })).toBe(false);
    expect(S.publishDue({ events, currentRoot: all, screening: screening({ rootDue: true }) })).toBe(true);
    expect(S.publishDue({ events, currentRoot: 0n, screening: screening({ rootDue: false }) })).toBe(false);
    expect(S.publishDue({ events, currentRoot: 0n, screening: { rootDue: false } as unknown as ASPScreening })).toBe(true); // malformed: fallback
  });

  it("rootDueFor counts a mismatch, never an unknown, and nothing for an empty pool", () => {
    const snap = { root: 5n, memberCount: 1 };
    expect(S.rootDueFor({ currentRoot: 0n, current: null, snapshot: { root: EMPTY_ROOT, memberCount: 0 } })).toBe(false);
    expect(S.rootDueFor({ currentRoot: 0n, current: null, snapshot: snap })).toBe(true);
    expect(S.rootDueFor({ currentRoot: 5n, current: { status: "unknown", problem: "missing_deposits", recipe: null }, snapshot: snap })).toBe(false);
    expect(S.rootDueFor({ currentRoot: 5n, current: { status: "mismatch", problem: "version_backwards", recipe: null }, snapshot: snap })).toBe(true);
    expect(S.rootDueFor({ currentRoot: 6n, current: null, snapshot: snap })).toBe(true);
    // a removal of the last member: the empty-set root is due
    expect(S.rootDueFor({ currentRoot: 5n, current: null, snapshot: { root: EMPTY_ROOT, memberCount: 0 } })).toBe(true);
    // no root yet and no member, but an exclusion to record (the only deposit, listed before it was eligible)
    expect(S.rootDueFor({ currentRoot: 0n, current: null, snapshot: { root: EMPTY_ROOT, memberCount: 0, recipe: { excludedLeaves: [0] } } })).toBe(true);
    expect(S.readmittedLeaves({ excludedLeaves: [3, 7] }, { considered: 9, excludedLeaves: [7] })).toEqual([3]);
    expect(S.readmittedLeaves(null, { considered: 9, excludedLeaves: [] })).toEqual([]);
  });

  it("the newest deposit, listed before it became eligible, changes no member: its record alone is due, once it is listed", () => {
    const c = chain();
    const d = [c.deposit(10n), c.deposit(11n), c.deposit(12n), c.deposit(13n)];
    const cur = c.postRecipe(20n, 3); // n=3: deposit 3 not considered yet
    const events = c.view();
    const current = S.checkCurrentRoot({ events, currentRoot: cur.root })!.check;
    // deposit 3 is eligible now and listed: n=4, x={3}: the same members, so the same root
    const snap = S.screenDeposits({ deposits: events, head: { block: 30n, time: timeOf(30n) }, confirmations: 1, delaySeconds: 0, blockTime: timeOf, exclude: (x) => (x.label === d[3].label ? "test" : null), previousConsidered: 3 });
    expect(snap).toMatchObject({ root: cur.root, recipe: { considered: 4, excludedLeaves: [d[3].leafIndex] } });
    expect(S.newlyListedLeaves(current, snap.recipe)).toEqual([d[3].leafIndex]);
    expect(S.rootDueFor({ currentRoot: cur.root, current, snapshot: snap })).toBe(true);
    // the same root and record as on-chain: nothing is due; once the record that lists it is on-chain, nothing more either
    expect(S.rootDueFor({ currentRoot: cur.root, current, snapshot: { root: cur.root, memberCount: 3, recipe: cur.recipe } })).toBe(false);
    c.post(31n, snap.root, snap.cid!);
    const after = c.view();
    const posted = S.checkCurrentRoot({ events: after, currentRoot: cur.root })!.check;
    expect(S.rootDueFor({ currentRoot: cur.root, current: posted, snapshot: snap })).toBe(false);
    // and the device now shows the exclusion: on-chain, from its own event of the root
    expect(S.screeningState({ events: after, currentRoot: cur.root, label: d[3].label })).toEqual({ kind: "excluded", reason: null, removed: false, listed: true });
  });

  it("a root whose record does not rebuild to it never raises the floor (no delay bypass, no 'lowered' for honest roots)", () => {
    const c = chain();
    const d = Array.from({ length: 6 }, (_, k) => c.deposit(10n + BigInt(k)));
    c.postRecipe(20n, 3);
    // another publisher (delay 0, or a typo) posts a root that claims n=6 but does not rebuild to it
    c.post(21n, 4242n, S.formatRecipe({ version: 1, considered: 6, excludedLeaves: [], asOfBlock: 20n, asOfTime: 1, delaySeconds: 0, confirmations: 1 }));
    expect(S.considerationFloor(c.view())).toBe(3);
    // the honest publisher's next root (n=4) is no violation
    const next = c.postRecipe(22n, 4);
    expect(S.checkCurrentRoot({ events: c.view(), currentRoot: next.root })?.check.status).toBe("verified");
    expect(S.considerationFloor(c.view())).toBe(4);
    void d;
  });
});

describe("previewAssociationSet: what the withdraw form shows", () => {
  it("the current root's members and the next root's (rebuilt from the snapshot recipe), by position; a screened set is no prefix", () => {
    const c = chain();
    const d = [c.deposit(10n), c.deposit(10n, BOB)];
    c.withdraw(11n);
    d.push(c.deposit(12n), c.deposit(13n), c.deposit(14n), c.deposit(15n), c.deposit(16n), c.deposit(17n));
    const r2 = c.postRecipe(19n, 6, [d[1]]);
    const events = c.view();
    const nextCid = S.formatRecipe({ ...r2.recipe, considered: 8 });
    // the honest answer: its snapshot's x (deposit 1) is the deposit it announces
    const s = screening({ rootDue: true, excluded: [announce(d[1])], snapshot: { asOfBlock: "20", asOfTime: 0, considered: 8, memberCount: 7, waiting: 0, root: "1", cid: nextCid } });
    const member = previewAssociationSet({ label: d[0].label, events, currentRoot: r2.root, screening: s });
    expect(member).toMatchObject({ deposits: 8, covered: 5, behind: true, next: 7, state: { kind: "in_set", size: 5, next: 7 } });
    expect([...member.members!].sort()).toEqual([0, 2, 3, 4, 5]);
    expect([...member.nextMembers!].sort()).toEqual([0, 2, 3, 4, 5, 6, 7]);
    const waiting = previewAssociationSet({ label: d[6].label, events, currentRoot: r2.root, screening: s });
    expect(waiting).toMatchObject({ covered: null, members: null, next: 7, state: { kind: "waiting", why: "next_root" } });
    expect(waiting.nextMembers?.has(6)).toBe(true);
    const excluded = previewAssociationSet({ label: d[1].label, events, currentRoot: r2.root, screening: s });
    expect(excluded).toMatchObject({ covered: null, members: null, nextMembers: null, state: { kind: "excluded" } });
    const settled = previewAssociationSet({ label: d[0].label, events, currentRoot: r2.root, screening: screening({ rootDue: false }) });
    expect(settled).toMatchObject({ behind: false, next: null, nextMembers: null, covered: 5, announcedOut: 0 });
    // the next root's crowd is the recipe rebuilt here, never the member count the answer claims
    const boasting = screening({ rootDue: true, excluded: [announce(d[1])], snapshot: { asOfBlock: "20", asOfTime: 0, considered: 8, memberCount: 50, waiting: 0, root: "1", cid: nextCid } });
    expect(previewAssociationSet({ label: d[0].label, events, currentRoot: r2.root, screening: boasting })).toMatchObject({ next: 7, covered: 5 });
    // a recipe that does not rebuild here: no next crowd at all (the form shows the current root's)
    const odd = screening({ rootDue: true, snapshot: { asOfBlock: "20", asOfTime: 0, considered: 99, memberCount: 50, waiting: 0, root: "1", cid: S.formatRecipe({ ...r2.recipe, considered: 99 }) } });
    expect(previewAssociationSet({ label: d[0].label, events, currentRoot: r2.root, screening: odd })).toMatchObject({ behind: true, next: null, nextMembers: null, covered: 5 });

    // a snapshot that does not fit the answer counts for no note (round 2, finding privacy-2): one that lists a leaf the
    // answer does not announce (here deposit 3, a member of the current root), or one that considers fewer deposits
    // than the current root. Otherwise its next crowd would hold some members and not others, and the form would show
    // different numbers for different notes
    const silent = S.formatRecipe({ ...r2.recipe, considered: 8, excludedLeaves: [d[1].leafIndex, d[3].leafIndex].sort((a, b) => a - b) });
    const unannounced = screening({ rootDue: true, excluded: [announce(d[1])], snapshot: { asOfBlock: "20", asOfTime: 0, considered: 8, memberCount: 6, waiting: 0, root: "1", cid: silent } });
    const lowered = screening({ rootDue: true, excluded: [announce(d[1])], snapshot: { asOfBlock: "20", asOfTime: 0, considered: 5, memberCount: 4, waiting: 0, root: "1", cid: S.formatRecipe({ ...r2.recipe, considered: 5 }) } });
    for (const lie of [unannounced, lowered]) {
      for (const x of [d[0], d[3], d[6]]) {
        expect(previewAssociationSet({ label: x.label, events, currentRoot: r2.root, screening: lie })).toMatchObject({ behind: true, next: null, nextMembers: null });
      }
    }
    // the honest snapshot gives every note the current root holds the same next crowd
    for (const x of [d[0], d[2], d[3], d[5]]) {
      const p = previewAssociationSet({ label: x.label, events, currentRoot: r2.root, screening: s });
      expect(p.next).toBe(7);
      expect(p.nextMembers).not.toBeNull();
    }
  });

  it("the app asks again when the proof's crowd is materially smaller than the form showed", () => {
    expect(crowdShrankSinceForm(40, 40)).toBe(false);
    expect(crowdShrankSinceForm(40, 41)).toBe(false);
    expect(crowdShrankSinceForm(40, 35)).toBe(false); // the same band, a small drop
    expect(crowdShrankSinceForm(40, 30)).toBe(true); // 10 fewer
    expect(crowdShrankSinceForm(60, 49)).toBe(true); // strong to moderate
    expect(crowdShrankSinceForm(12, 9)).toBe(true); // moderate to weak
    expect(crowdShrankSinceForm(5, 1)).toBe(true); // weak to linked
    expect(crowdShrankSinceForm(null, 1)).toBe(false); // the form showed no crowd
    expect(crowdShrankSinceForm(undefined, 1)).toBe(false);
  });
});

describe("wording", () => {
  it("formatDelay", () => {
    expect(S.formatDelay(0)).toBe("right away");
    expect(S.formatDelay(3_600)).toBe("1 hour");
    expect(S.formatDelay(7_200)).toBe("2 hours");
    expect(S.formatDelay(5_400)).toBe("1 hour 30 minutes");
    expect(S.formatDelay(60)).toBe("1 minute");
    expect(S.formatDelay(45)).toBe("45 seconds");
    expect(S.formatDelay(86_400)).toBe("1 day");
    expect(S.formatDelay(90_000)).toBe("1 day 1 hour");
    expect(S.formatDelay(S.MAX_INCLUSION_DELAY_SECONDS)).toBe("7 days");
    expect(S.formatDelay(Number.NaN)).toBe("right away");
  });

  it("the exclusion reasons read as on the screening policy page", () => {
    expect(S.EXCLUSION_REASON_CODES).toEqual(["sanctions", "stolen-funds", "fraud", "legal-order", "test"]);
    expect(S.EXCLUSION_REASON_CODES.map((k) => `${S.EXCLUSION_REASONS[k].title}: ${S.EXCLUSION_REASONS[k].text}`)).toEqual([
      "Sanctions: the depositing address is on a public sanctions list.",
      "Stolen funds: the deposit was reported as coming from stolen funds.",
      "Fraud: the deposit was reported as coming from a scam or fraud.",
      "Legal order: a court or regulator ordered the operator to exclude it.",
      "Test: an exclusion made on the testnet to test screening.",
    ]);
    expect(S.isExclusionReason("fraud")).toBe(true);
    expect(S.isExclusionReason("Fraud")).toBe(false);
  });

  it("the registry carries each network's inclusion delay", () => {
    expect(networkById(46630)?.aspInclusionDelaySeconds).toBe(3_600);
    expect(networkById(31337)?.aspInclusionDelaySeconds).toBe(0);
    expect(networkById(31338)?.aspInclusionDelaySeconds).toBe(0);
  });
});

// ─── the privacy check on a screened set ──────────────────────────────────────

describe("the privacy check on a screened set (guidance.ts)", () => {
  const ETH = 10n ** 18n;
  const now = 1_900_000_000;
  /** ten deposits of 1 ETH, one an hour, the newest an hour ago; yours is the last */
  const deposits: PublicDeposit[] = Array.from({ length: 10 }, (_, k) => ({ value: ETH, timestamp: now - (10 - k) * 3_600, own: k === 9 }));
  const base = { deposits, deposit: 9, hop: 0, noteValue: ETH, amount: ETH / 2n, now };

  it("counts the members, not a prefix: excluded deposits are no cover, a later member is", () => {
    const members = new Set([0, 1, 3, 4, 6, 7, 8, 9]); // deposits 2 and 5 excluded
    const r = withdrawCheck({ ...base, members });
    expect(r).toMatchObject({ setSize: 8, couldFund: 8 });
    // the note is the last deposit, beyond the member count: still checked
    expect(() => withdrawCheck({ ...base, members: new Set([0, 1, 2]) })).toThrow(/association set does not hold/);
    expect(() => withdrawCheck({ ...base, setSize: 9 })).toThrow(/association set does not hold/);
    expect(withdrawCheck({ ...base, setSize: 10 }).couldFund).toBe(10);
    // an exited member is no cover either
    const exited = deposits.map((x, k) => (k === 0 ? { ...x, exited: true } : x));
    expect(withdrawCheck({ ...base, deposits: exited, members }).couldFund).toBe(7);
  });

  it("projects new deposits only once the inclusion delay has passed, and never withdraws before eligibility", () => {
    // your deposit a week ago, then 45 others since (about 6.6 a day): four more make the estimate strong
    const week: PublicDeposit[] = Array.from({ length: 46 }, (_, k) => ({ value: ETH, timestamp: now - 7 * 86_400 + Math.floor((k * 7 * 86_400) / 46), own: k === 0 }));
    const input = { ...base, deposits: week, deposit: 0, setSize: 46 };
    const quick = withdrawCheck(input);
    const delayed = withdrawCheck({ ...input, delaySeconds: 86_400 });
    expect(quick.wait).toEqual({ kind: "wait", seconds: 86_400 });
    expect(delayed.wait).toEqual({ kind: "wait", seconds: 172_800 }); // new deposits join a day after they are made
    // a note still inside its delay: the withdrawal is projected at eligibility, which widens the timing window
    const recent: PublicDeposit[] = deposits.map((x, k) => (k === 9 ? { ...x, timestamp: now - 600 } : x));
    const atNow = withdrawCheck({ ...base, deposits: recent, setSize: 10 });
    const atEligibility = withdrawCheck({ ...base, deposits: recent, setSize: 10, eligibleAt: now + 3_000 });
    expect(atEligibility.elapsed).toBe(atNow.elapsed);
    expect(atEligibility.timingCrowd!).toBeGreaterThan(atNow.timingCrowd!);
  });
});
