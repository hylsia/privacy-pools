/**
 * The publisher's side of screening policy v1 (Phase 4): the inclusion delay, the operator's exclusion list, removals
 * and their roots, policy_error, the screening block of privacy.asp.status, privacy.asp.set's on-chain record, the
 * exclusion file's watcher, the relayer's refusal of older roots that hold an excluded deposit, the eviction burst and
 * the dashboard's figures.
 *
 * One fake chain (31337, 12 s blocks) with the pool contract's real ring of 16 association-set roots (updateASPRoot
 * writes slot (index + 1) % 16, isKnownASPRoot scans every slot, duplicates allowed). ./chain is mocked; config, the
 * event sync, the screening snapshot, the publisher, funding, the periodic publisher, the relayer, eviction, the pools
 * explorer and the router run for real. The device's side is shared/privacy/screening.ts (screening.test.ts); here it
 * only checks what the server posts.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

type FakeLog = { eventName: string; args: Record<string, unknown>; blockNumber: bigint; transactionHash: Hex; logIndex: number };

const fake = vi.hoisted(() => {
  const POOL = "0x2222222222222222222222222222222222222222";
  const T0 = 1_790_000_000n;
  const FUNDED = 10n ** 19n;
  const fresh = () => ({
    head: 0n,
    logs: [] as FakeLog[],
    /** the contract's ring: aspRoots[16] and currentASPRootIndex */
    ring: Array.from({ length: 16 }, () => 0n),
    index: 0,
    scope: 0n,
    postman: "0x0000000000000000000000000000000000000001",
    gasPrice: 1_000_000_000n,
    keyBalances: new Map<string, bigint>(),
    calls: [] as string[],
    sent: [] as { functionName: string; args: readonly unknown[]; from: string; hash: Hex; block: bigint }[],
    receipts: new Map<Hex, { status: "success" | "reverted"; blockNumber: bigint; gasUsed: bigint }>(),
    txCount: 0,
    /** the next N sends fail like a nonce clash with another process (viem's own error: NonceTooLowError inside) */
    nonceClashes: 0,
    /** what the other process's transaction did when it took the nonce (run once, at the clash) */
    clashHook: null as null | (() => void),
    /** logs above this block are not served yet (an RPC whose logs lag its state); null: none held back */
    logsUpTo: null as bigint | null,
    /** transactions sent but not mined yet (another process of the same key): their nonces are taken, nothing is on-chain */
    mempool: [] as { functionName: string; args: readonly unknown[]; from: string; hash: Hex }[],
    /** getTransactionCount("pending") reads so far, and the read at which the mempool gets mined (null: never by itself) */
    pendingReads: 0,
    mineOnPendingRead: null as number | null,
    /** the next N updateASPRoot posts sent with this fake's wallet stay in the mempool (never mined in the test) */
    stickNextPosts: 0,
  });
  const chain = {
    state: fresh(),
    T0,
    POOL,
    FUNDED,
    reset: () => {},
    mine: (_n?: number) => {},
    post: (_root: bigint, _cid: string) => ({}) as Hex,
    /** another process of the same key sends a post that is not mined yet */
    sendPending: (_from: string, _root: bigint, _cid: string) => ({}) as Hex,
    client: {} as Record<string, unknown>,
    wallet: (_a: string) => ({}) as unknown,
  };
  chain.reset = () => {
    chain.state = fresh();
  };
  const hit = (name: string) => chain.state.calls.push(name);
  chain.mine = (n = 1) => {
    chain.state.head += BigInt(n);
  };
  /** what updateASPRoot does on-chain, mined in a new block */
  const applyRoot = (root: bigint, cid: string, hash: Hex) => {
    const s = chain.state;
    s.head += 1n;
    s.index = (s.index + 1) % 16;
    const filled = s.ring[s.index] !== 0n;
    s.ring[s.index] = root;
    s.logs.push({ eventName: "ASPRootUpdated", args: { root, cid }, blockNumber: s.head, transactionHash: hash, logIndex: 0 });
    s.receipts.set(hash, { status: "success", blockNumber: s.head, gasUsed: filled ? 38_000n : 71_000n });
  };
  chain.post = (root: bigint, cid: string) => {
    const hash = `0x${(++chain.state.txCount).toString(16).padStart(64, "e")}` as Hex;
    applyRoot(root, cid, hash);
    return hash;
  };
  chain.sendPending = (from: string, root: bigint, cid: string) => {
    const hash = `0x${(++chain.state.txCount).toString(16).padStart(64, "f")}` as Hex;
    chain.state.mempool.push({ functionName: "updateASPRoot", args: [root, cid], from, hash });
    return hash;
  };
  /** the mempool's transactions are mined, in order (each takes its nonce for good) */
  const mineMempool = () => {
    const s = chain.state;
    for (const t of s.mempool.splice(0)) {
      if (t.functionName === "updateASPRoot") applyRoot(t.args[0] as bigint, String(t.args[1]), t.hash);
      s.sent.push({ ...t, block: s.head });
    }
  };
  const minedBy = (address: string) => chain.state.sent.filter((t) => t.from.toLowerCase() === address.toLowerCase()).length;
  const pendingBy = (address: string) => minedBy(address) + chain.state.mempool.filter((t) => t.from.toLowerCase() === address.toLowerCase()).length;
  chain.client = {
    getChainId: async () => (hit("getChainId"), 31337),
    getCode: async () => (hit("getCode"), "0x6080"),
    getBlockNumber: async () => (hit("getBlockNumber"), chain.state.head),
    getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => {
      hit("getBlock");
      const number = blockNumber ?? chain.state.head;
      return { number, timestamp: T0 + number * 12n };
    },
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      hit("getLogs");
      const cap = chain.state.logsUpTo;
      return chain.state.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock && (cap === null || l.blockNumber <= cap));
    },
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      hit(`readContract:${functionName}`);
      const s = chain.state;
      switch (functionName) {
        case "SCOPE":
          return s.scope;
        case "currentASPRoot":
          return s.ring[s.index];
        case "isKnownASPRoot":
          return (args?.[0] as bigint) !== 0n && s.ring.includes(args?.[0] as bigint);
        case "aspRoots":
          return s.ring[Number(args?.[0] as bigint)];
        case "currentASPRootIndex":
          return s.index;
        case "ASP_ROOT_HISTORY_SIZE":
          return 16;
        case "aspPostman":
          return s.postman;
        case "owner":
          return "0x0000000000000000000000000000000000000002";
        case "dead":
          return false;
        case "minDeposit":
          return 0n;
        case "nextIndex":
          return s.logs.filter((l) => "leafIndex" in l.args).length;
        case "getLastRoot":
          return 31_337_000n;
      }
      throw new Error(`unexpected read ${functionName}`);
    },
    getBalance: async ({ address }: { address: string }) => {
      hit("getBalance");
      const a = address.toLowerCase();
      return a === POOL ? 0n : (chain.state.keyBalances.get(a) ?? FUNDED);
    },
    getGasPrice: async () => (hit("getGasPrice"), chain.state.gasPrice),
    getTransactionCount: async ({ address, blockTag }: { address: string; blockTag?: string }) => {
      hit("getTransactionCount");
      const s = chain.state;
      if (blockTag === "pending") {
        s.pendingReads++;
        if (s.mineOnPendingRead !== null && s.pendingReads >= s.mineOnPendingRead) {
          s.mineOnPendingRead = null;
          mineMempool();
        }
        return pendingBy(address);
      }
      return minedBy(address);
    },
    simulateContract: async (p: { functionName: string; args: readonly unknown[]; account: { address: string } }) => {
      hit(`simulateContract:${p.functionName}`);
      return { request: { functionName: p.functionName, args: p.args, account: p.account } };
    },
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      hit("waitForTransactionReceipt");
      const r = chain.state.receipts.get(hash);
      if (!r && chain.state.mempool.some((t) => t.hash === hash)) {
        // what viem throws when a transaction it waits for is not mined in time
        const { WaitForTransactionReceiptTimeoutError } = await import("viem");
        throw new WaitForTransactionReceiptTimeoutError({ hash });
      }
      if (!r) throw new Error("timed out");
      return { ...r, transactionHash: hash };
    },
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      hit("getTransactionReceipt");
      const r = chain.state.receipts.get(hash);
      if (!r) throw new Error("not found");
      return { ...r, transactionHash: hash };
    },
  };
  chain.wallet = (address: string) => ({
    account: { address },
    writeContract: async (request: { functionName: string; args: readonly unknown[]; nonce?: number }) => {
      hit(`writeContract:${request.functionName}`);
      const s = chain.state;
      // an explicit nonce another transaction already took (mined or in the mempool): the node refuses it
      const taken = request.nonce !== undefined && request.nonce < pendingBy(address);
      if (taken) s.nonceClashes = Math.max(s.nonceClashes, 1);
      // no nonce given: viem takes the pending count, so this one is mined behind whatever is in the mempool
      else if (request.nonce === undefined) mineMempool();
      if (s.nonceClashes > 0) {
        s.nonceClashes--;
        const hook = s.clashHook;
        s.clashHook = null;
        hook?.();
        // what viem throws when the node answers "nonce too low": its short message never says "nonce too low"
        const { ContractFunctionExecutionError, NonceTooLowError, parseAbi } = await import("viem");
        throw new ContractFunctionExecutionError(new NonceTooLowError({ nonce: 6 }), {
          abi: parseAbi(["function updateASPRoot(uint256 root, string cid)"]),
          functionName: request.functionName,
          args: request.args,
        });
      }
      const hash = `0x${(++s.txCount).toString(16).padStart(64, "a")}` as Hex;
      if (request.functionName === "updateASPRoot" && s.stickNextPosts > 0) {
        // sent, never mined here: its nonce is taken, nothing is on-chain
        s.stickNextPosts--;
        s.mempool.push({ functionName: request.functionName, args: request.args, from: address, hash });
        return hash;
      }
      if (request.functionName === "updateASPRoot") applyRoot(request.args[0] as bigint, String(request.args[1]), hash);
      else {
        s.head += 1n;
        s.receipts.set(hash, { status: "success", blockNumber: s.head, gasUsed: 1_100_000n });
      }
      s.sent.push({ functionName: request.functionName, args: request.args, from: address, hash, block: s.head });
      return hash;
    },
  });
  return chain;
});

vi.mock("./chain", async () => {
  const { privateKeyToAccount } = await import("viem/accounts");
  return {
    getPublicClient: (chainId?: number) => {
      if (chainId !== undefined && chainId !== 31337) throw new Error(`no fake client for chain ${chainId}`);
      return fake.client;
    },
    makeWalletClient: (key: Hex) => fake.wallet(privateKeyToAccount(key).address),
    resetClients: () => {},
  };
});

import { privateKeyToAccount } from "viem/accounts";
import { anvilKey } from "../../scripts/privacy/anvilKeys";
import { computeContext, computeScope } from "../../shared/privacy/context";
import { computeLabel } from "../../shared/privacy/notes";
import {
  checkCurrentRoot,
  formatRecipe,
  MAX_RECIPE_EXCLUSIONS,
  parseExclusionFile,
  parseRecipe,
  rootRecordOf,
  screeningState,
  setRoot,
  validScreening,
  type ExclusionReason,
} from "../../shared/privacy/screening";
import { noteScreening, offersPublicExit, withdrawHold } from "../../client/src/privacy/publicData";
import { fetchPoolEvents } from "../../shared/privacy/indexer";
import type { PoolEvent } from "../../shared/privacy/types";
import {
  getASPStatus,
  getPublicAssociationSet,
  getScreenedSet,
  policyErrorReason,
  publishASPRoot,
  refusedASPRoot,
  resetASPCache,
} from "./asp";
import { autoPublishTick, startAutoPublisher } from "./autoPublish";
import { logPrivacyConfigSummary, privacyConfig, resetPrivacyConfig } from "./config";
import { evictExcludedRoots, isNonceClash, planEviction } from "./evict";
import { readExclusions, resetExclusionsCache } from "./exclusions";
import { oneTransactionCost, PUBLISH_GAS } from "./funding";
import { getPoolDetail, listPools, resetPoolCaches } from "./pools";
import { ASP_ROOT_REFUSED, relayWithdrawal } from "./relayer";
import { privacyRouter } from "./router";

const POOL = fake.POOL as Address;
const SCOPE = computeScope(POOL, 31337);
const POSTMAN_KEY = anvilKey(0);
const RELAYER_KEY = anvilKey(1);
const POSTMAN = privateKeyToAccount(POSTMAN_KEY).address;
const RELAYER = privateKeyToAccount(RELAYER_KEY).address;
const ALICE = "0x00000000000000000000000000000000000a11ce" as Address;
const BOB = "0x00000000000000000000000000000000000000b0" as Address;
/** what a note in the exclusion file holds: it must never reach an answer or a log */
const SENTINEL = "SENTINEL-NOTE-do-not-publish-7f3c";
/** a listed address that never deposited: it must never reach an answer or a log */
const STRANGER = "0x5555555555555555555555555555555555555555";
const time = (block: bigint) => Number(fake.T0 + block * 12n);
const caller = () => privacyRouter.createCaller({ req: {}, res: {}, user: null } as never);

const ENV = [
  "PRIVACY_CHAIN_IDS",
  "PRIVACY_CHAIN_ID",
  "PRIVACY_POOL_ADDRESS_31337",
  "PRIVACY_POOL_DEPLOY_BLOCK_31337",
  "PRIVACY_ASP_POSTMAN_PRIVATE_KEY",
  "PRIVACY_RELAYER_PRIVATE_KEY",
  "PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337",
  "PRIVACY_ASP_CONFIRMATIONS_31337",
  "PRIVACY_ASP_EXCLUSIONS_FILE",
  "PRIVACY_ASP_EXCLUSIONS_JSON",
  "PRIVACY_ASP_AUTO_PUBLISH_SECONDS",
  "PRIVACY_ASP_RECEIPT_WAIT_MS_31337",
];
const savedEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hylsia-screening-"));
const LIST = path.join(dir, "asp-exclusions.json");

function setEnv(values: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetPrivacyConfig();
  resetASPCache();
  resetPoolCaches();
}

type Entry = { label?: string; depositor?: string; reason: ExclusionReason; chainId?: number; note?: string; added?: string };
/** Writes the exclusion file and reads it at once (the loader otherwise reads at most once a second). */
function writeList(entries: Entry[] | string) {
  fs.writeFileSync(LIST, typeof entries === "string" ? entries : JSON.stringify({ format: "hylsia-asp-exclusions", version: 1, entries }));
  readExclusions(privacyConfig().aspExclusions, { force: true });
}

/** Deposits at the given blocks (default depositor alice); returns their labels in leaf order. */
function deposit(blocks: bigint[], depositor: Address = ALICE): bigint[] {
  const logs = fake.state.logs;
  return blocks.map((blockNumber) => {
    const leafIndex = logs.filter((l) => "leafIndex" in l.args).length;
    const label = computeLabel(SCOPE, BigInt(leafIndex + 1));
    logs.push({
      eventName: "Deposited",
      args: { depositor, commitment: 5_000n + BigInt(leafIndex), label, value: 10n ** 17n, precommitment: 7n, leafIndex },
      blockNumber,
      transactionHash: `0x${(logs.length + 1).toString(16).padStart(64, "d")}` as Hex,
      logIndex: logs.filter((l) => l.blockNumber === blockNumber).length,
    });
    if (fake.state.head < blockNumber) fake.state.head = blockNumber;
    return label;
  });
}

/** The device's view: the same logs, decoded by the shared indexer. */
const deviceEvents = (): Promise<PoolEvent[]> => fetchPoolEvents(fake.client as never, POOL, 0n, fake.state.head);
const updates = () => fake.state.sent.filter((t) => t.functionName === "updateASPRoot");
const lastCid = () => String(updates().at(-1)?.args[1]);

let logs: string[] = [];
beforeEach(() => {
  fake.reset();
  fake.state.scope = SCOPE;
  fake.state.postman = POSTMAN;
  for (const k of ENV) delete process.env[k];
  if (fs.existsSync(LIST)) fs.rmSync(LIST);
  setEnv({
    PRIVACY_CHAIN_IDS: "31337",
    PRIVACY_POOL_ADDRESS_31337: POOL,
    PRIVACY_POOL_DEPLOY_BLOCK_31337: "0",
    PRIVACY_ASP_POSTMAN_PRIVATE_KEY: POSTMAN_KEY,
    PRIVACY_RELAYER_PRIVATE_KEY: RELAYER_KEY,
  });
  logs = [];
  const keep = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
  vi.spyOn(console, "log").mockImplementation(keep);
  vi.spyOn(console, "warn").mockImplementation(keep);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const k of ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  resetPrivacyConfig();
  resetASPCache();
  resetPoolCaches();
});

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// ─── the inclusion delay ──────────────────────────────────────────────────────

describe("the inclusion delay", () => {
  it("a deposit joins once its block time plus the delay is at or before the head's time (equality joins)", async () => {
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "3600" }); // 300 blocks of 12 s
    const [a, b] = deposit([10n, 20n]);
    fake.state.head = 309n; // a's block time + 3600 s is block 310's time: not yet
    let s = await getScreenedSet({ fresh: true });
    expect(s.snapshot).toMatchObject({ memberCount: 0, waiting: 2, recipe: { considered: 0, delaySeconds: 3600, confirmations: 1 } });
    expect(s.rootDue).toBe(false); // nothing to post yet: no root and no member
    expect(await publishASPRoot()).toMatchObject({ status: "empty" });

    fake.mine(); // block 310: exactly a's time + 3600
    s = await getScreenedSet({ fresh: true });
    expect(s.snapshot).toMatchObject({ memberCount: 1, waiting: 1, labels: [a] });
    expect(s.rootDue).toBe(true);
    const status = await getASPStatus(undefined, { fresh: true });
    expect(status.screening).toMatchObject({ delaySeconds: 3600, rootDue: true, snapshot: { considered: 1, memberCount: 1, waiting: 1 } });

    expect(await publishASPRoot()).toMatchObject({ status: "published", root: setRoot([a]).toString() });
    expect(lastCid()).toBe(`hylsia-asp:v1;n=1;x=;asOf=310;t=${time(310n)};delay=3600;conf=1`);
    // the device rebuilds the posted root from its own events and the recipe; b still waits for the delay
    const events = await deviceEvents();
    const currentRoot = fake.state.ring[fake.state.index];
    expect(checkCurrentRoot({ events, currentRoot })?.check.status).toBe("verified");
    expect(screeningState({ label: a, events, currentRoot })).toMatchObject({ kind: "in_set", size: 1 });
    expect(screeningState({ label: b, events, currentRoot, depositTime: time(20n), now: time(fake.state.head), delaySeconds: 3600 })).toMatchObject({
      kind: "waiting",
      why: "delay",
      eligibleAt: time(20n) + 3600,
    });
    expect((await publishASPRoot()).status).toBe("current");
  });

  it("raising the delay later never drops a member (n never decreases)", async () => {
    const labels = deposit([10n, 11n, 12n]);
    fake.state.head = 13n;
    expect(await publishASPRoot()).toMatchObject({ status: "published" }); // delay 0 on 31337: all three
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "86400" });
    deposit([14n]);
    const s = await getScreenedSet({ fresh: true });
    expect(s.previousConsidered).toBe(3);
    expect(s.snapshot).toMatchObject({ labels, waiting: 1, recipe: { considered: 3, delaySeconds: 86400 } });
    expect(s.rootDue).toBe(false); // the same three members: same root
  });

  it("confirmations still apply: a deposit inside the confirmation window waits", async () => {
    setEnv({ PRIVACY_ASP_CONFIRMATIONS_31337: "3" });
    deposit([10n, 11n]);
    fake.state.head = 12n; // cutoff block 10
    expect((await getScreenedSet({ fresh: true })).snapshot).toMatchObject({ memberCount: 1, waiting: 1, recipe: { considered: 1, confirmations: 3 } });
  });
});

// ─── exclusions and removals ──────────────────────────────────────────────────

describe("the exclusion list", () => {
  beforeEach(() => {
    setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: LIST, PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "3600" });
    writeList([]);
  });

  it("a listed deposit beyond n is announced at once, never enters a root, and its leaf is in x once it is considered", async () => {
    writeList([{ depositor: BOB, reason: "test", chainId: 31337 }]);
    const [a] = deposit([10n]);
    const [b] = deposit([11n], BOB);
    fake.state.head = 100n; // both inside the delay
    let status = await getASPStatus(undefined, { fresh: true });
    // label, leaf, reason and whether it is considered: never when the server first matched it (round 2, privacy-4)
    expect(status.screening?.excluded).toEqual([{ leafIndex: 1, label: b.toString(), reason: "test", considered: false }]);
    expect(status.screening?.snapshot).toMatchObject({ considered: 0, memberCount: 0, waiting: 1 });

    fake.state.head = 400n; // both past the delay
    expect(await publishASPRoot()).toMatchObject({ status: "published", root: setRoot([a]).toString() });
    expect(parseRecipe(lastCid())).toMatchObject({ version: 1, considered: 2, excludedLeaves: [1] });
    status = await getASPStatus(undefined, { fresh: true });
    expect(status.screening?.excluded).toEqual([expect.objectContaining({ leafIndex: 1, considered: true })]);
    expect(status.screening?.current).toMatchObject({ status: "verified", considered: 2, memberCount: 1 });
    // on the device: excluded, from the on-chain record alone (the announcement only names the reason)
    const events = await deviceEvents();
    const currentRoot = fake.state.ring[fake.state.index];
    expect(screeningState({ label: b, events, currentRoot, screening: status.screening })).toEqual({ kind: "excluded", reason: "test", removed: false, listed: true });
  });

  it("a removal: the member's leaf goes into x, the next root leaves it out, and a lifted exclusion returns it", async () => {
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "0" });
    const labels = deposit([10n, 11n, 12n]);
    expect(await publishASPRoot()).toMatchObject({ status: "published", root: setRoot(labels).toString() });
    const before = fake.state.ring[fake.state.index];

    writeList([{ label: labels[1].toString(), reason: "stolen-funds", note: SENTINEL }]);
    const due = await getASPStatus(undefined, { fresh: true });
    expect(due.screening).toMatchObject({ rootDue: true, readmitted: 0, current: { root: before.toString(), status: "verified", memberCount: 3 } });
    expect(due.screening?.excluded).toEqual([expect.objectContaining({ leafIndex: 1, reason: "stolen-funds", considered: true })]);
    expect(await publishASPRoot()).toMatchObject({ status: "published", root: setRoot([labels[0], labels[2]]).toString() });
    expect(parseRecipe(lastCid())).toMatchObject({ considered: 3, excludedLeaves: [1] });
    expect(logs.join("\n")).toContain("the new association-set root removes 1 deposit(s) that the exclusion list names");
    const events = await deviceEvents();
    const currentRoot = fake.state.ring[fake.state.index];
    expect(screeningState({ label: labels[1], events, currentRoot })).toEqual({ kind: "excluded", reason: null, removed: true, listed: true });
    expect((await publishASPRoot()).status).toBe("current");

    // lifted: the next root admits it again (once the edit has settled), and the log and the status say so
    writeList([]);
    let s = await getScreenedSet({ fresh: true });
    expect(s.readmitted).toEqual([1]);
    expect(s).toMatchObject({ rootDue: false, settling: true }); // a re-admission waits until the list is unchanged for 30 s
    expect((await publishASPRoot()).status).toBe("current");
    const later = Date.now() + 31_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    resetPoolCaches();
    s = await getScreenedSet({ fresh: true });
    expect(s).toMatchObject({ rootDue: true, settling: false });
    expect((await getASPStatus(undefined, { fresh: true })).screening?.readmitted).toBe(1);
    expect(await publishASPRoot()).toMatchObject({ status: "published", root: setRoot(labels).toString() });
    expect(logs.join("\n")).toContain("admits again 1 deposit(s) that the current root excludes (leaves 1)");
  });

  it("the newest deposit, listed before it is eligible and then the only one to become eligible, is excluded on-chain by a record (once)", async () => {
    const [a] = deposit([10n]);
    fake.state.head = 400n;
    expect(await publishASPRoot()).toMatchObject({ status: "published", root: setRoot([a]).toString() });
    const root = fake.state.ring[fake.state.index];
    const [b] = deposit([401n], BOB);
    writeList([{ depositor: BOB, reason: "test", chainId: 31337, note: SENTINEL }]);
    expect((await getScreenedSet({ fresh: true })).rootDue).toBe(false); // inside the delay: announced only
    fake.state.head = 800n; // b is eligible and listed: n=2, x={b}, the members {a} unchanged, so the same root
    const s = await getScreenedSet({ fresh: true });
    expect(s).toMatchObject({ rootDue: true, record: true, repair: false });
    expect(s.snapshot.root).toBe(root);
    expect(await publishASPRoot()).toMatchObject({ status: "published", root: root.toString() });
    expect(parseRecipe(lastCid())).toMatchObject({ considered: 2, excludedLeaves: [1] });
    expect(logs.join("\n")).toContain("with a record that lists 1 newly excluded deposit(s)");
    // on the device: excluded, from the on-chain record (the announcement names the reason)
    const status = await getASPStatus(undefined, { fresh: true });
    const events = await deviceEvents();
    expect(screeningState({ label: b, events, currentRoot: root, screening: status.screening })).toEqual({ kind: "excluded", reason: "test", removed: false, listed: true });
    expect(status.screening).toMatchObject({ rootDue: false, next: { joins: 0, removals: 0 } });
    // nothing more is due: the record on-chain lists it now
    expect((await publishASPRoot()).status).toBe("current");
    expect(updates()).toHaveLength(2);
    // another publisher re-posts the old record on top: its n went down, so devices refuse it, and this process repairs
    // it once (never twice)
    const oldCid = formatRecipe({ version: 1, considered: 1, excludedLeaves: [], asOfBlock: 400n, asOfTime: time(400n), delaySeconds: 3600, confirmations: 1 });
    fake.post(root, oldCid);
    expect(await getScreenedSet({ fresh: true })).toMatchObject({ rootDue: true, repair: true, current: { status: "mismatch", problem: "lowered" } });
    expect((await publishASPRoot()).status).toBe("published");
    expect(updates()).toHaveLength(3);
    fake.post(root, oldCid);
    expect((await getScreenedSet({ fresh: true })).rootDue).toBe(false);
    expect(logs.join("\n")).not.toContain(SENTINEL);
  });

  it("the status names what the next root changes, joins and removals apart (never netted)", async () => {
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "0" });
    const labels = deposit([10n, 11n, 12n]);
    await publishASPRoot();
    deposit([20n, 21n]); // two join
    writeList([{ label: labels[0].toString(), reason: "fraud" }, { label: labels[1].toString(), reason: "fraud" }]); // two leave
    const status = await getASPStatus(undefined, { fresh: true });
    expect(status.screening).toMatchObject({ rootDue: true, settling: false, next: { joins: 2, removals: 2 }, snapshot: { memberCount: 3 }, current: { memberCount: 3 } });
    // a current root this server cannot verify: nothing is said about the next root's change
    fake.post(777n, "not-a-recipe");
    expect((await getASPStatus(undefined, { fresh: true })).screening?.next).toBeNull();
  });

  it("the last member's removal posts the empty set's root", async () => {
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "0" });
    const [a] = deposit([10n]);
    expect((await publishASPRoot()).status).toBe("published");
    writeList([{ label: a.toString(), reason: "fraud" }]);
    expect(await publishASPRoot()).toMatchObject({ status: "published", root: setRoot([]).toString() });
    expect(setRoot([])).not.toBe(0n);
    expect(parseRecipe(lastCid())).toMatchObject({ considered: 1, excludedLeaves: [0] });
    expect(logs.join("\n")).toContain("(no member is left: the empty set's root)");
    expect((await getASPStatus(undefined, { fresh: true })).screening?.current).toMatchObject({ status: "verified", memberCount: 0 });
  });

  it("an invalid list pauses publishing everywhere (policy_error), keeps the last good list, and says why once, then every 10 minutes", async () => {
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "0" });
    const labels = deposit([10n, 11n]);
    writeList([{ label: labels[0].toString(), reason: "test", note: SENTINEL }]);
    logs.length = 0;
    writeList(`{ "format": "hylsia-asp-exclusions", "version": 1, "entries": [ { "label": "${labels[1]}", "reason": "maybe", "note": "${SENTINEL}" } ] }`);
    const nonce = fake.state.sent.length;
    const r = await publishASPRoot();
    expect(r).toMatchObject({ status: "policy_error" });
    expect(policyErrorReason(r)).toBe('the exclusion list is invalid (entry #1: field "reason" must be one of sanctions, stolen-funds, fraud, legal-order, test)');
    const status = await getASPStatus(undefined, { fresh: true });
    expect(status).toMatchObject({ canPublish: false, publishBlock: "policy_error" });
    expect(status.screening).toMatchObject({ exclusions: "invalid" });
    // the last good list is still applied for display: the first deposit is still announced as excluded
    expect(status.screening?.excluded.map((e) => e.leafIndex)).toEqual([0]);
    expect(await autoPublishTick(31337)).toEqual({ outcome: "policy_error", detail: policyErrorReason(r) });
    // privacy.pools and privacy.networks report the pause like a publisher that cannot post
    expect((await listPools("24h")).pools[0]).toMatchObject({ aspCanPublish: false, aspPublishBlock: "policy_error" });
    expect((await caller().networks()).networks[0]).toMatchObject({ aspCanPublish: false, aspPublishBlock: "policy_error" });
    expect(fake.state.sent.length).toBe(nonce); // nothing was sent
    const invalid = logs.filter((l) => l.includes("is invalid"));
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toContain("Publishing association-set roots is paused on every network until it is fixed. The last good list (1 entry) is still shown.");
    // again after 10 minutes, while it stays invalid
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10 * 60_000 + 1_000);
    readExclusions(privacyConfig().aspExclusions);
    expect(logs.filter((l) => l.includes("is invalid"))).toHaveLength(2);
    // a missing file is invalid too
    vi.restoreAllMocks();
    fs.rmSync(LIST);
    readExclusions(privacyConfig().aspExclusions, { force: true });
    expect((await publishASPRoot()).status).toBe("policy_error");
    expect(policyErrorReason(await publishASPRoot())).toBe("the exclusion list is invalid (the file does not exist)");
  });

  it("a missing list after a restart never re-admits what the chain shows excluded: no lift, no joins it cannot know, the device keeps the exit (round 2)", async () => {
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "0" });
    const [a] = deposit([10n]);
    const [b] = deposit([11n], BOB);
    await publishASPRoot();
    writeList([{ depositor: BOB, reason: "test", chainId: 31337, note: SENTINEL }]);
    await publishASPRoot();
    const removal = fake.state.ring[fake.state.index]; // {a}, b's leaf in its record
    expect(removal).toBe(setRoot([a]));
    // a restart (a container started without the mounted file): the list is missing and no good list was read yet
    resetASPCache();
    fs.rmSync(LIST);
    expect(readExclusions(privacyConfig().aspExclusions, { force: true })).toMatchObject({ status: "invalid", entries: [] });
    const s = await getScreenedSet({ fresh: true });
    // the snapshot keeps the chain's own exclusion (not announced: no reason is known), so it is the root on-chain
    expect(s).toMatchObject({ readmitted: [], rootDue: false, settling: false });
    expect(s.snapshot).toMatchObject({ root: removal, recipe: { excludedLeaves: [1] }, excluded: [] });
    let status = await getASPStatus(undefined, { fresh: true });
    expect(status).toMatchObject({ canPublish: false, publishBlock: "policy_error" });
    expect(status.screening).toMatchObject({ exclusions: "invalid", readmitted: 0, rootDue: false, next: null, excluded: [] });
    // even once a new deposit is eligible (a root is due, and paused): no lift, and nothing said about the next root
    deposit([20n]);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000); // past any settle time
    status = await getASPStatus(undefined, { fresh: true });
    expect(status.screening).toMatchObject({ readmitted: 0, next: null, rootDue: true });
    expect(status.screening?.snapshot.memberCount).toBe(2); // a and the new deposit, never b
    // the device: b is still excluded on-chain, with its public exit, and held
    const ns = noteScreening({ label: b, chainId: 31337, pool: { scope: SCOPE, events: await deviceEvents(), aspRoot: removal }, status: { entry: status, screening: validScreening(status.screening) }, activity: { entry: null, now: null } });
    expect(ns).toMatchObject({ readmitted: false, state: { kind: "excluded", listed: true } });
    expect(offersPublicExit({ spent: false, value: 1n }, ns)).toBe(true);
    expect(withdrawHold(ns)).toBe("excluded");
    expect(logs.join("\n")).not.toContain(SENTINEL);
  });

  it("a half-saved edit never admits a listed deposit that no root holds yet: it waits until the list has settled", async () => {
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "0" });
    const [a] = deposit([10n]);
    const [b] = deposit([11n], BOB);
    const settledAt = new Date(Date.now() - 3_600_000);
    writeList([{ depositor: BOB, reason: "test" }]);
    fs.utimesSync(LIST, settledAt, settledAt);
    resetASPCache(); // a list saved an hour ago: settled
    expect(await publishASPRoot()).toMatchObject({ status: "published", root: setRoot([a]).toString() });
    expect(parseRecipe(lastCid())?.excludedLeaves).toEqual([1]);
    // the operator's first save drops bob's entry (a second save will put a corrected one back): bob must not join now
    writeList([]);
    let s = await getScreenedSet({ fresh: true });
    expect(s).toMatchObject({ settling: true, rootDue: false, readmitted: [1] });
    // and for a listed deposit that no root's record names yet (it became eligible after the current root): the
    // settled list names bob and a stranger; the stranger's deposit is considered after the root, so only the snapshot
    // lists its leaf; a half-save that drops the stranger's entry must not let it in
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "3600", PRIVACY_ASP_EXCLUSIONS_FILE: LIST });
    writeList([{ depositor: BOB, reason: "test" }, { depositor: STRANGER, reason: "fraud" }]);
    fs.utimesSync(LIST, settledAt, settledAt);
    resetASPCache();
    fake.state.head = 400n;
    expect((await publishASPRoot()).status).toBe("current"); // still {a}, bob's leaf in x
    const [c] = deposit([401n], STRANGER as Address);
    fake.state.head = 800n; // c is past the delay now: considered, and listed
    s = await getScreenedSet({ fresh: true });
    expect(s.snapshot.excluded.map((e) => [e.leafIndex, e.considered])).toEqual([
      [1, true],
      [2, true],
    ]);
    expect(parseRecipe(String(s.currentRecord?.cid))?.excludedLeaves).toEqual([1]); // the root's record does not name c
    // the same members (c is excluded), so the same root: only a record would put c's exclusion on-chain, and it is due
    expect(s).toMatchObject({ rootDue: true, record: true, repair: false });
    expect(s.snapshot.root).toBe(s.currentRoot);
    readExclusions(privacyConfig().aspExclusions); // the settled list is the one in force
    writeList([{ depositor: BOB, reason: "test" }]); // half-saved: the stranger's entry is gone for now
    s = await getScreenedSet({ fresh: true });
    expect(s.snapshot.labels).toEqual([a, c]);
    expect(s).toMatchObject({ readmitted: [], settling: true, rootDue: false });
    expect((await publishASPRoot()).status).toBe("current");
    // 30 s later the edit has settled: it stands, and the root admits c
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31_000);
    expect((await getScreenedSet({ fresh: true })).rootDue).toBe(true);
    void b;
  });

  it("the settle rule counts from the file's modification time: a list saved long ago is settled at once, even in a new process", async () => {
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "0" });
    const labels = deposit([10n, 11n]);
    writeList([{ label: labels[1].toString(), reason: "test" }]);
    expect((await publishASPRoot()).status).toBe("published");
    // lifted, and saved an hour ago; a new process (the CLI after the edit) reads it for the first time
    writeList([]);
    const old = new Date(Date.now() - 3_600_000);
    fs.utimesSync(LIST, old, old);
    resetASPCache();
    const s = await getScreenedSet({ fresh: true });
    expect(s.readmitted).toEqual([1]);
    expect(s).toMatchObject({ settling: false, rootDue: true });
    expect(await publishASPRoot()).toMatchObject({ status: "published", root: setRoot(labels).toString() });
  });

  it("500 excluded deposits fit one root's record; 501 pause publishing", async () => {
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "0" });
    deposit(Array.from({ length: 500 }, (_, i) => 10n + BigInt(i)), BOB);
    const [a, b] = deposit([600n, 601n]);
    writeList([{ depositor: BOB, reason: "sanctions" }]);
    const ok = await getScreenedSet({ fresh: true });
    expect(ok.snapshot.recipe.excludedLeaves).toHaveLength(MAX_RECIPE_EXCLUSIONS);
    expect(ok.policyError).toBeNull();
    expect(await publishASPRoot()).toMatchObject({ status: "published", root: setRoot([a, b]).toString() });
    expect(parseRecipe(lastCid())?.excludedLeaves).toHaveLength(500);

    // one more removal needs a record of 501 leaves: nothing is posted, and the status says why
    writeList([{ depositor: BOB, reason: "sanctions" }, { label: b.toString(), reason: "fraud" }]);
    const over = await publishASPRoot();
    expect(over.status).toBe("policy_error");
    expect(policyErrorReason(over)).toBe("the snapshot excludes 501 deposits, more than the 500 a root's record can list");
    const status = await getASPStatus(undefined, { fresh: true });
    expect(status).toMatchObject({ canPublish: false, publishBlock: "policy_error" });
    expect(status.screening?.snapshot.cid).toBeNull();
    expect(updates()).toHaveLength(1);
  });

  it("an inline list (PRIVACY_ASP_EXCLUSIONS_JSON) refuses notes; both variables set is a configuration error", async () => {
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "0", PRIVACY_ASP_EXCLUSIONS_FILE: undefined });
    const [a] = deposit([10n]);
    setEnv({ PRIVACY_ASP_EXCLUSIONS_JSON: JSON.stringify({ format: "hylsia-asp-exclusions", version: 1, entries: [{ label: a.toString(), reason: "test" }] }) });
    expect((await getScreenedSet({ fresh: true })).snapshot).toMatchObject({ memberCount: 0, excluded: [expect.objectContaining({ label: a })] });
    setEnv({ PRIVACY_ASP_EXCLUSIONS_JSON: JSON.stringify({ format: "hylsia-asp-exclusions", version: 1, entries: [{ label: a.toString(), reason: "test", note: SENTINEL }] }) });
    const noted = await publishASPRoot();
    expect(policyErrorReason(noted)).toBe('the exclusion list is invalid (entry #1: field "note" is not allowed in an inline list (keep notes in the file only))');
    setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: LIST });
    expect(privacyConfig().aspExclusions).toEqual({ kind: "error", error: "both PRIVACY_ASP_EXCLUSIONS_FILE and PRIVACY_ASP_EXCLUSIONS_JSON are set; set only one" });
    expect((await publishASPRoot()).status).toBe("policy_error");
    expect(logs.join("\n")).not.toContain(SENTINEL);
  });

  it("notes, dates and listed addresses that never deposited reach no answer and no log (sentinel)", async () => {
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "0" });
    const [a, b] = deposit([10n, 11n]);
    writeList([
      { label: a.toString(), reason: "fraud", note: SENTINEL, added: "2026-11-18" },
      { depositor: STRANGER, reason: "sanctions", note: `${SENTINEL}-2` },
    ]);
    await publishASPRoot();
    const lines: string[] = [];
    logPrivacyConfigSummary((l) => lines.push(l));
    const c = caller();
    const answers = JSON.stringify(
      { status: await c.asp.status(), set: await c.asp.set(), pools: await c.pools(), detail: await c.poolDetail({ chainId: 31337, pool: POOL }) },
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    );
    for (const text of [answers, lines.join("\n"), logs.join("\n")]) {
      expect(text).not.toContain(SENTINEL);
      expect(text).not.toContain("2026-11-18");
      expect(text.toLowerCase()).not.toContain(STRANGER.slice(2).toLowerCase());
    }
    expect(answers).toContain(a.toString()); // the matched deposit is announced (public data)
    expect(answers).toContain(b.toString());
    expect(lines.join("\n")).toContain(`exclusion list (${LIST}): 2 entries`);
    // a parse error names the entry and the field only
    const bad = parseExclusionFile(JSON.stringify({ format: "hylsia-asp-exclusions", version: 1, entries: [{ depositor: STRANGER, reason: "fraud", note: SENTINEL, extra: 1 }] }));
    expect(bad).toEqual({ ok: false, error: "entry #1 has a field that is not allowed (allowed: label, depositor, reason, chainId, note, added)" });
  });

  it("the shipped example list is valid and empty", () => {
    const text = fs.readFileSync(path.resolve(import.meta.dirname, "../../config/asp-exclusions.example.json"), "utf8");
    expect(parseExclusionFile(text)).toEqual({ ok: true, entries: [], warnings: [] });
  });
});

// ─── rootDue, repairs and the policy version ──────────────────────────────────

describe("rootDue is decided on what the chain shows", () => {
  it("a server whose logs lag the contract (no event yet for the current root) never makes the root due", async () => {
    const labels = deposit([10n, 11n]);
    expect((await publishASPRoot()).status).toBe("published");
    labels.push(...deposit([20n]));
    // another post of the right root (all three) lands at block 21, but this server's RPC serves logs up to block 20
    fake.post(setRoot(labels), formatRecipe({ version: 1, considered: 3, excludedLeaves: [], asOfBlock: 20n, asOfTime: time(20n), delaySeconds: 0, confirmations: 1 }));
    fake.state.logsUpTo = 20n;
    const s = await getScreenedSet({ fresh: true });
    expect(s.current).toMatchObject({ status: "unknown", problem: "no_record" });
    expect(s.snapshot.root).toBe(setRoot(labels));
    expect(s.rootDue).toBe(false);
    expect((await publishASPRoot()).status).toBe("current");
    expect(updates()).toHaveLength(1);
  });

  it("a record that does not rebuild its root is repaired once (the same root, its recipe), never twice", async () => {
    const labels = deposit([10n, 11n, 12n]);
    // someone posts the right root with a record that names 2 deposits: it does not rebuild to the root
    const wrong = formatRecipe({ version: 1, considered: 2, excludedLeaves: [], asOfBlock: 12n, asOfTime: time(12n), delaySeconds: 0, confirmations: 1 });
    fake.post(setRoot(labels), wrong);
    let s = await getScreenedSet({ fresh: true });
    expect(s.current).toMatchObject({ status: "mismatch", problem: "root" });
    expect(s).toMatchObject({ rootDue: true, repair: true });
    expect(await publishASPRoot()).toMatchObject({ status: "published", root: setRoot(labels).toString() });
    expect(parseRecipe(lastCid())).toMatchObject({ considered: 3 });
    expect((await getScreenedSet({ fresh: true })).current?.status).toBe("verified");
    // the bad record comes back on top: this process never repairs the same root again (no re-post loop)
    fake.post(setRoot(labels), wrong);
    s = await getScreenedSet({ fresh: true });
    expect(s.current?.status).toBe("mismatch");
    expect(s.rootDue).toBe(false);
    expect((await publishASPRoot()).status).toBe("current");
    expect(updates()).toHaveLength(1);
  });

  it("an open-policy root after screened roots (an older publisher still running): mismatch, warned once, and the screened root is posted again", async () => {
    const labels = deposit([10n, 11n]);
    expect((await publishASPRoot()).status).toBe("published");
    const screened = fake.state.ring[fake.state.index];
    deposit([20n]);
    fake.post(setRoot([...labels, computeLabel(SCOPE, 3n)]), "open-testnet-policy:count=3:head=20");
    const status = await getASPStatus(undefined, { fresh: true });
    expect(status.screening?.current).toMatchObject({ status: "mismatch" });
    expect(status.screening?.rootDue).toBe(true);
    expect(logs.filter((l) => l.includes("was posted under the older open policy after screened roots"))).toHaveLength(1);
    expect(await publishASPRoot()).toMatchObject({ status: "published" });
    expect(fake.state.ring[fake.state.index]).not.toBe(screened); // the snapshot now holds three
    expect(parseRecipe(lastCid())).toMatchObject({ version: 1, considered: 3 });
  });

  it("a newer screening policy on-chain pauses publishing", async () => {
    deposit([10n]);
    fake.post(123n, "hylsia-asp:v2;anything");
    const r = await publishASPRoot();
    expect(r.status).toBe("policy_error");
    expect(policyErrorReason(r)).toBe("the pool's roots follow screening policy version 2, newer than this server's version 1: update this server before it posts again");
    expect(updates()).toHaveLength(0);
  });
});

// ─── privacy.asp.status and privacy.asp.set ───────────────────────────────────

describe("the screening block of privacy.asp.status", () => {
  it("fills every field (a device accepts it), and is computed once per 15 s unless a publish or a list change starts a new one", async () => {
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "3600" });
    deposit([10n]);
    fake.state.head = 400n;
    const status = await getASPStatus();
    const sc = status.screening!;
    expect(validScreening(sc)).toBe(sc);
    expect(sc).toEqual({
      walletPublishable: true,
      publicationMode: "server",
      policyVersion: 1,
      delaySeconds: 3600,
      confirmations: 1,
      autoPublish: { running: false, seconds: 600 },
      exclusions: "none",
      snapshot: { asOfBlock: "400", asOfTime: time(400n), considered: 1, memberCount: 1, waiting: 0, root: setRoot([computeLabel(SCOPE, 1n)]).toString(), cid: expect.stringMatching(/^hylsia-asp:v1;n=1;x=;asOf=400;/) },
      current: null,
      rootDue: true,
      readmitted: 0,
      excluded: [],
      settling: false,
      next: null,
    });
    const reads = () => fake.state.calls.filter((c) => c === "readContract:aspPostman").length;
    const once = reads();
    await getASPStatus();
    await caller().asp.status();
    expect(reads()).toBe(once); // memoized
    await publishASPRoot(); // a post from this process starts a new one
    const after = await getASPStatus();
    expect(reads()).toBeGreaterThan(once);
    expect(after.screening).toMatchObject({ rootDue: false, current: { status: "verified", memberCount: 1 }, next: { joins: 0, removals: 0 } });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16_000);
    const n = reads();
    await getASPStatus();
    expect(reads()).toBe(n + 1); // 15 s later: computed again
  });

  it("the periodic publisher's real state: running only where it runs, never on Vercel", async () => {
    deposit([10n]);
    const ap = startAutoPublisher({ log: () => {}, env: {} })!;
    try {
      expect((await getASPStatus(undefined, { fresh: true })).screening?.autoPublish).toEqual({ running: true, seconds: 600 });
    } finally {
      ap.stop();
    }
    expect((await getASPStatus(undefined, { fresh: true })).screening?.autoPublish).toEqual({ running: false, seconds: 600 });
    expect(startAutoPublisher({ log: () => {}, env: { VERCEL: "1" } })).toBeNull();
    expect((await getASPStatus(undefined, { fresh: true })).screening?.autoPublish.running).toBe(false);
  });

  it("privacy.asp.set serves the current on-chain root with its record; before the first root, the snapshot", async () => {
    const labels = deposit([10n, 11n]);
    expect(await getPublicAssociationSet()).toMatchObject({ onChain: false, memberCount: 2, root: setRoot(labels), cid: expect.stringMatching(/^hylsia-asp:v1;n=2;/) });
    await publishASPRoot();
    deposit([30n]); // a newer deposit: the snapshot moves on, the answer stays on the root on-chain
    resetASPCache();
    const set = await getPublicAssociationSet();
    expect(set).toMatchObject({ onChain: true, memberCount: 2, root: setRoot(labels), cid: lastCid() });
    expect(set.labels).toEqual(labels);
  });
});

// ─── the exclusion file's watcher ─────────────────────────────────────────────

describe("the periodic publisher watches the exclusion file", () => {
  it("a settled change that removes a member posts at once; a lift waits for the normal tick; a half-saved edit never posts", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: LIST });
    writeList([]);
    const labels = deposit([10n, 11n, 12n]);
    const lines: string[] = [];
    const ap = startAutoPublisher({ log: (l) => lines.push(l), env: {} })!;
    try {
      expect(ap.watchesExclusions).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000); // the first tick posts the three
      expect(updates()).toHaveLength(1);

      // a half-saved edit: lists a member, then is changed again 10 s later; nothing is posted until it has settled
      // (the file's modification time is the fake clock's, as an editor's save would set it)
      const save = (entries: Entry[]) => {
        fs.writeFileSync(LIST, JSON.stringify({ format: "hylsia-asp-exclusions", version: 1, entries }));
        fs.utimesSync(LIST, new Date(), new Date());
      };
      save([{ label: labels[2].toString(), reason: "test" }]);
      await vi.advanceTimersByTimeAsync(10_000);
      save([{ label: labels[1].toString(), reason: "test" }]);
      await vi.advanceTimersByTimeAsync(25_000);
      expect(updates()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(30_000); // unchanged for 30 s now: the next check runs the tick
      expect(updates()).toHaveLength(2);
      expect(parseRecipe(lastCid())?.excludedLeaves).toEqual([1]);
      expect(lines).toContain("[privacy] Local chain A (31337): the exclusion list changed and names a member of the current root: publishing now");

      // lifted: no immediate tick; the normal one (600 s after the last) posts it
      save([]);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(updates()).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(updates()).toHaveLength(3);
      expect(parseRecipe(lastCid())?.excludedLeaves).toEqual([]);
    } finally {
      ap.stop();
    }
  });

  it("a paused publisher logs why once, then that it runs again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: LIST });
    writeList("{ not json");
    deposit([10n]);
    const lines: string[] = [];
    const ap = startAutoPublisher({ log: (l) => lines.push(l), env: {} })!;
    try {
      await vi.advanceTimersByTimeAsync(60_000 + 2 * 600_000);
      const paused = lines.filter((l) => l.includes("auto-publish paused"));
      expect(paused).toEqual([
        "[privacy] Local chain A (31337): auto-publish paused: the exclusion list is invalid (the exclusion list is not valid JSON (line 1, column 3)); nothing is posted until it is fixed",
      ]);
      expect(updates()).toHaveLength(0);
      writeList([]);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(updates()).toHaveLength(1);
      expect(lines.filter((l) => l.includes("auto-publish posted"))).toHaveLength(1);
    } finally {
      ap.stop();
    }
  });
});

// ─── the relayer refuses older roots that hold an excluded deposit ────────────

describe("the relayer and older roots (the window, closed for relayed withdrawals)", () => {
  const proof = { pA: [1n, 2n] as [bigint, bigint], pB: [[3n, 4n], [5n, 6n]] as [[bigint, bigint], [bigint, bigint]], pC: [7n, 8n] as [bigint, bigint] };
  const submit = (aspRoot: bigint) => {
    const value = 10n ** 17n;
    const withdrawal = { recipient: "0x00000000000000000000000000000000000000a1" as Address, relayer: RELAYER, fee: value / 200n, deadline: BigInt(Math.floor(Date.now() / 1000) + 600) };
    return { chainId: 31337, withdrawal, proof, pubSignals: [11n, 12n, value, 13n, aspRoot, computeContext(SCOPE, withdrawal)] };
  };

  it("refuses a proof against an older root that holds an excluded deposit, before any simulation; the current and clean older roots go through", async () => {
    setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: LIST });
    writeList([]);
    const [a] = deposit([10n]);
    await publishASPRoot();
    const clean = fake.state.ring[fake.state.index]; // {a}
    const [b] = deposit([20n], BOB);
    await publishASPRoot();
    const tainted = fake.state.ring[fake.state.index]; // {a, b}
    writeList([{ depositor: BOB, reason: "test", chainId: 31337 }]);
    await publishASPRoot();
    const current = fake.state.ring[fake.state.index]; // {a} again, b in x: the same value as `clean`
    expect(current).toBe(clean);
    expect(await refusedASPRoot(31337, tainted)).toBe(true);
    expect(await refusedASPRoot(31337, current)).toBe(false);
    expect(await refusedASPRoot(31337, 424242n)).toBe(true); // a root this server cannot rebuild counts as tainted

    fake.state.calls.length = 0;
    await expect(caller().relayer.submit(submit(tainted))).rejects.toMatchObject({ code: "BAD_REQUEST", message: ASP_ROOT_REFUSED });
    expect(fake.state.calls.filter((c) => c.startsWith("simulateContract") || c.startsWith("writeContract"))).toEqual([]);
    expect((await relayWithdrawal(submit(current))).chainId).toBe(31337);
    expect(fake.state.sent.at(-1)?.functionName).toBe("withdraw");
    void a;
    void b;
  });

  it("with nothing listed there is no check and no extra RPC call", async () => {
    deposit([10n]);
    await publishASPRoot();
    fake.state.calls.length = 0;
    expect(await refusedASPRoot(31337, 99n)).toBe(false);
    expect(fake.state.calls).toEqual([]);
  });

  it("an invalid or missing list after a restart never switches the refusal off: the chain's own record of exclusions counts", async () => {
    setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: LIST });
    writeList([]);
    deposit([10n]);
    deposit([11n], BOB);
    await publishASPRoot();
    const tainted = fake.state.ring[fake.state.index]; // {a, b}
    writeList([{ depositor: BOB, reason: "test", chainId: 31337 }]);
    await publishASPRoot();
    const removal = fake.state.ring[fake.state.index]; // {a}, b's leaf in its record
    // a restart (a deploy built without the git-ignored list): the file is missing, and no good list was read yet
    resetASPCache();
    fs.rmSync(LIST);
    expect(readExclusions(privacyConfig().aspExclusions, { force: true })).toMatchObject({ status: "invalid", entries: [] });
    expect(await refusedASPRoot(31337, tainted)).toBe(true);
    expect(await refusedASPRoot(31337, removal)).toBe(false); // the current root: never refused
    await expect(caller().relayer.submit(submit(tainted))).rejects.toMatchObject({ code: "BAD_REQUEST", message: ASP_ROOT_REFUSED });
    // and with a current root this server cannot check either: every older root is refused (fail closed)
    fake.post(777n, "not-a-recipe");
    expect(await refusedASPRoot(31337, removal)).toBe(true);
    expect(await refusedASPRoot(31337, 777n)).toBe(false);
  });
});

// ─── the eviction burst ───────────────────────────────────────────────────────

describe("eviction (opt-in): the ring from the contract, the posts needed, the burst", () => {
  /** a removal after `natural` more roots: returns the root that held the excluded deposit */
  async function removalScenario() {
    setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: LIST });
    writeList([]);
    deposit([10n]);
    deposit([11n], BOB);
    await publishASPRoot();
    const tainted = fake.state.ring[fake.state.index];
    writeList([{ depositor: BOB, reason: "test" }]);
    await publishASPRoot();
    return { tainted, removal: fake.state.ring[fake.state.index] };
  }

  it("plans from currentASPRootIndex and aspRoots: 16 - the nearest offending distance, with its cost", async () => {
    const { tainted, removal } = await removalScenario();
    deposit([30n]);
    await publishASPRoot(); // one natural root after the removal
    const plan = await planEviction(31337);
    expect(plan).toMatchObject({ ringSize: 16, currentIndex: 3, excludedDeposits: 1, blockers: [] });
    expect(plan.ring.map((e) => [e.slot, e.distance, e.taint])).toEqual([
      [3, 0, "clean"],
      [2, 1, "clean"],
      [1, 2, "holds"],
    ]);
    expect(plan.offending).toEqual([{ slot: 1, root: tainted, distance: 2, taint: "holds" }]);
    expect(plan.postsNeeded).toBe(14);
    expect(plan.costWei).toBe(14n * oneTransactionCost(1_000_000_000n, PUBLISH_GAS));
    expect(plan.currentCid).toBe(lastCid());
    void removal;
  });

  it("re-posts the current root until the offending root is unknown, then stops; the preview sends nothing", async () => {
    const { tainted } = await removalScenario();
    const preview = await evictExcludedRoots(31337, { send: false });
    expect(preview).toMatchObject({ postsNeeded: 15, posts: [], evicted: false });
    expect(updates()).toHaveLength(2);

    const known: boolean[] = [];
    fake.state.nonceClashes = 1; // another process's transaction took the nonce once
    const result = await evictExcludedRoots(31337, {
      send: true,
      retryDelayMs: 1,
      onPost: () => void known.push(fake.state.ring.includes(tainted)),
    });
    expect(result).toMatchObject({ postsNeeded: 15, evicted: true });
    expect(result.posts).toHaveLength(15);
    expect(known).toEqual([...Array(14).fill(true), false]); // known after posts 1-14, gone after the 15th
    expect(new Set(updates().slice(2).map((t) => `${t.args[0]}|${t.args[1]}`)).size).toBe(1); // the current root and its record
    // slots 3..15 and 0 had never been written (the 71 k of an empty slot), slot 1 held the excluded deposit's root
    expect(result.posts.map((p) => p.gasUsed)).toEqual([...Array(14).fill(71_000n), 38_000n]);
    expect((await planEviction(31337)).postsNeeded).toBe(0);
  });

  it("stops early when other posts already pushed the offending root out, and refuses while the current root holds one or the publisher cannot pay", async () => {
    const { tainted } = await removalScenario();
    const plan = await planEviction(31337);
    expect(plan.postsNeeded).toBe(15);
    // the publisher holds less than 15 posts' worth: refused up front, nothing sent
    fake.state.keyBalances.set(POSTMAN.toLowerCase(), 14n * oneTransactionCost(1_000_000_000n, PUBLISH_GAS));
    await expect(evictExcludedRoots(31337, { send: true })).rejects.toThrow(/eviction refused: the publisher holds 0\.0028 ETH; 15 posts need about 0\.003 ETH/);
    expect(updates()).toHaveLength(2);
    fake.state.keyBalances.clear();
    // 14 posts by someone else (the same root): one more of ours is enough
    const cid = lastCid();
    for (let i = 0; i < 14; i++) fake.post(fake.state.ring[fake.state.index], cid);
    const result = await evictExcludedRoots(31337, { send: true });
    expect(result.posts).toHaveLength(1);
    expect(result.evicted).toBe(true);
    expect(fake.state.ring.includes(tainted)).toBe(false);

    // a current root that still holds an excluded deposit: publish first
    writeList([{ depositor: BOB, reason: "test" }, { depositor: ALICE, reason: "test" }]);
    deposit([40n], STRANGER as Address);
    fake.post(setRoot([computeLabel(SCOPE, 1n), computeLabel(SCOPE, 3n)]), formatRecipe({ version: 1, considered: 3, excludedLeaves: [1], asOfBlock: 40n, asOfTime: time(40n), delaySeconds: 0, confirmations: 1 }));
    expect((await planEviction(31337)).blockers).toContain("the current root still holds an excluded deposit: publish its removal first (npm run zk:asp:publish)");
  });

  it("a nonce clash means another post just landed: the burst reads the current root again, never re-posting an older root over it", async () => {
    const { tainted, removal } = await removalScenario();
    // the auto-publisher posts a newer root (a new deposit joined) with the same key while the burst sends its first post
    const [c] = deposit([30n]);
    const newer = setRoot([computeLabel(SCOPE, 1n), c]);
    const newerCid = formatRecipe({ version: 1, considered: 3, excludedLeaves: [1], asOfBlock: 30n, asOfTime: time(30n), delaySeconds: 0, confirmations: 1 });
    fake.state.nonceClashes = 1;
    fake.state.clashHook = () => void fake.post(newer, newerCid);
    const result = await evictExcludedRoots(31337, { send: true, retryDelayMs: 1 });
    expect(result.evicted).toBe(true);
    // its post took one slot, so 14 of ours were enough; every one carries the newer root, none the removal root
    expect(result.posts).toHaveLength(14);
    expect(updates().slice(2).map((t) => t.args[0])).toEqual(Array(14).fill(newer));
    expect(fake.state.ring[fake.state.index]).toBe(newer);
    expect(fake.state.ring.includes(tainted)).toBe(false);
    void removal;
  });

  it("a nonce clash with a post of a root that holds an excluded deposit stops the burst, and nothing older is posted over it", async () => {
    const { removal } = await removalScenario();
    const holding = setRoot([computeLabel(SCOPE, 1n), computeLabel(SCOPE, 2n)]); // bob's deposit is in it again
    fake.state.nonceClashes = 1;
    fake.state.clashHook = () => void fake.post(holding, formatRecipe({ version: 1, considered: 2, excludedLeaves: [], asOfBlock: 20n, asOfTime: time(20n), delaySeconds: 0, confirmations: 1 }));
    await expect(evictExcludedRoots(31337, { send: true, retryDelayMs: 1 })).rejects.toThrow(/another root or record was posted during the burst that holds an excluded deposit/);
    expect(updates()).toHaveLength(2); // our two publishes only: nothing after the clash
    expect(fake.state.ring[fake.state.index]).toBe(holding);
    void removal;
  });
});

describe("the burst and another process posting with the same key (round 2)", () => {
  async function removalScenario() {
    setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: LIST });
    writeList([]);
    deposit([10n]);
    deposit([11n], BOB);
    await publishASPRoot();
    const tainted = fake.state.ring[fake.state.index];
    writeList([{ depositor: BOB, reason: "test" }]);
    await publishASPRoot();
    return { tainted, removal: fake.state.ring[fake.state.index] };
  }

  it("a post sent but not mined yet: the burst waits for it, then re-posts that root, never the older one over it", async () => {
    const { tainted, removal } = await removalScenario();
    const [c] = deposit([30n]);
    const newer = setRoot([computeLabel(SCOPE, 1n), c]);
    const newerCid = formatRecipe({ version: 1, considered: 3, excludedLeaves: [1], asOfBlock: 30n, asOfTime: time(30n), delaySeconds: 0, confirmations: 1 });
    const result = await evictExcludedRoots(31337, {
      send: true,
      retryDelayMs: 1,
      onPost: (k) => {
        if (k !== 1) return;
        // right after the burst's first post, the periodic publisher (same key) sends the newer root: it is still in
        // flight at the burst's next check, and mined by the one after
        fake.sendPending(POSTMAN, newer, newerCid);
        fake.state.mineOnPendingRead = fake.state.pendingReads + 2;
      },
    });
    expect(result.evicted).toBe(true);
    const roots = updates().slice(2).map((t) => t.args[0]);
    expect(roots[0]).toBe(removal); // the burst's first post
    expect(roots[1]).toBe(newer); // the other process's, mined
    expect(roots.slice(2).every((r) => r === newer)).toBe(true); // never the removal root again on top of it
    expect(fake.state.ring[fake.state.index]).toBe(newer);
    expect(fake.state.ring.includes(tainted)).toBe(false);
    expect(checkCurrentRoot({ events: await deviceEvents(), currentRoot: newer })?.check.status).toBe("verified");
  });

  it("the same root posted with a new record during the burst (it lists a newly excluded deposit): the burst carries that record on", async () => {
    const { removal } = await removalScenario();
    // a deposit from an address the list names: n=3, x={1, 2}, the members {a} unchanged, so the same root
    writeList([{ depositor: BOB, reason: "test" }, { depositor: STRANGER, reason: "test" }]);
    deposit([30n], STRANGER as Address);
    const recordCid = formatRecipe({ version: 1, considered: 3, excludedLeaves: [1, 2], asOfBlock: 30n, asOfTime: time(30n), delaySeconds: 0, confirmations: 1 });
    const result = await evictExcludedRoots(31337, {
      send: true,
      retryDelayMs: 1,
      onPost: (k) => {
        if (k === 1) fake.post(removal, recordCid); // the server's record post, from another process, mined at once
      },
    });
    expect(result.evicted).toBe(true);
    const ours = updates().slice(2);
    expect(String(ours[0].args[1])).not.toBe(recordCid); // the first post carried the record of the plan
    expect(ours.slice(1).every((t) => t.args[0] === removal && String(t.args[1]) === recordCid)).toBe(true);
    // devices read the newest record: the new one, which verifies (never an older record on top: "lowered")
    const events = await deviceEvents();
    expect(rootRecordOf(events, removal)?.cid).toBe(recordCid);
    expect(checkCurrentRoot({ events, currentRoot: removal })?.check.status).toBe("verified");
  });

  it("a post that stays in flight stops the burst after its waits, sending nothing over it", async () => {
    const { removal } = await removalScenario();
    fake.sendPending(POSTMAN, removal, lastCid()); // never mined in this test
    await expect(evictExcludedRoots(31337, { send: true, retryDelayMs: 1 })).rejects.toThrow(/another postman transaction stayed in flight during the burst; stopped after 0 post\(s\)/);
    expect(updates()).toHaveLength(2);
  });

  it("a post of its own that is never mined stops the burst with a message that says so, and what landed (round 3)", async () => {
    await removalScenario();
    let err: unknown = null;
    await evictExcludedRoots(31337, {
      send: true,
      retryDelayMs: 1,
      onPost: (k) => {
        if (k === 2) fake.state.stickNextPosts = 1; // the burst's third post is sent and never mined
      },
    }).catch((e: unknown) => (err = e));
    expect(err).toBeInstanceOf(Error);
    const message = (err as Error).message;
    expect(message).toMatch(/^post 3 \(transaction 0x[0-9a-f]{64}\) was not mined within 120 s and may still land; stopped after 2 post\(s\)\. The publisher answers "pending" while it is in flight/);
    expect(message).not.toMatch(/Timed out while waiting/);
    expect(isNonceClash(err)).toBe(false);
    expect(updates()).toHaveLength(4); // our two publishes and the burst's two mined posts
    expect(fake.state.mempool).toHaveLength(1);
  });
});

describe("a foreign root in the ring", () => {
  it("counts as offending when it cannot be rebuilt (while something is excluded); the screened root goes out again only 10 minutes after its last post", async () => {
    setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: LIST });
    writeList([{ depositor: BOB, reason: "test" }]);
    const [a] = deposit([10n]);
    deposit([11n], BOB);
    expect(await publishASPRoot()).toMatchObject({ status: "published", root: setRoot([a]).toString() });
    fake.post(777n, "not-a-recipe"); // another publisher's root that nobody can rebuild
    expect((await getScreenedSet({ fresh: true })).current).toMatchObject({ status: "mismatch", problem: "version_backwards" });
    // our post of this root is younger than 10 minutes: it answers for it, nothing is sent (no flapping war)
    expect((await publishASPRoot()).status).toBe("published");
    expect(updates()).toHaveLength(1);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    expect((await publishASPRoot()).status).toBe("published");
    expect(updates()).toHaveLength(2); // replaced on-chain, and older than 10 minutes: posted again
    const plan = await planEviction(31337);
    expect(plan.offending).toEqual([{ slot: 2, root: 777n, distance: 1, taint: "unverifiable" }]);
    expect(plan.postsNeeded).toBe(15);
    expect(await refusedASPRoot(31337, 777n)).toBe(true);
  });
});

// ─── the dashboard ────────────────────────────────────────────────────────────

describe("the dashboard's figures", () => {
  it("aspRootMembers is the verified current root, aspMembers the snapshot (below it while a removal waits), the series each root's recipe", async () => {
    setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: LIST, PRIVACY_ASP_AUTO_PUBLISH_SECONDS: "0" });
    writeList([]);
    const labels = deposit([10n, 11n, 12n]);
    await publishASPRoot();
    writeList([{ label: labels[0].toString(), reason: "test" }]);
    resetPoolCaches();
    let pool = (await listPools("24h")).pools[0];
    expect(pool).toMatchObject({ aspRootMembers: 3, aspMembers: 2 }); // the removal waits for the next root
    await publishASPRoot();
    resetPoolCaches();
    pool = (await listPools("24h")).pools[0];
    expect(pool).toMatchObject({ aspRootMembers: 2, aspMembers: 2 });
    const detail = await getPoolDetail(31337, POOL, "7d");
    expect(detail.series.at(-1)?.members).toBe(2);
    expect(detail.aspUpdates.map((u) => parseRecipe(u.cid)?.excludedLeaves)).toEqual([[0], []]);
  });
});
