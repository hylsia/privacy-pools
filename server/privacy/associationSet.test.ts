/**
 * Association set built on the device vs. by the server publisher, the fail-closed
 * rules of the device-side proof, and the label-free server surface.
 *
 * The server modules run for real against a fake RPC client (./chain is mocked per
 * chain: this file serves one local chain in legacy single mode), so getAssociationSet /
 * listPools exercise their production code paths, the pool contract check included.
 * The two-network cases live in multichain.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toBytes, type Address, type Hex } from "viem";

const fake = vi.hoisted(() => {
  const state = {
    head: 0n,
    logs: [] as Array<{ eventName: string; args: Record<string, unknown>; blockNumber: bigint; transactionHash: string; logIndex: number }>,
    currentRoot: 0n,
    knownRoots: new Set<bigint>(),
    /** what the pool contract answers to SCOPE() (set to the real scope of POOL on 31337 below) */
    scope: 0n,
    calls: [] as string[],
    /** the RPC fails every block read (the pending state must not need one) */
    rpcDown: false,
  };
  const client = {
    getChainId: async () => {
      state.calls.push("getChainId");
      return 31337;
    },
    getCode: async () => {
      state.calls.push("getCode");
      return "0x6080" as const;
    },
    getBlockNumber: async () => {
      state.calls.push("getBlockNumber");
      return state.head;
    },
    getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      state.calls.push("getLogs");
      return state.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
    },
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
      state.calls.push(`readContract:${functionName}`);
      if (functionName === "currentASPRoot") return state.currentRoot;
      if (functionName === "isKnownASPRoot") return state.knownRoots.has(args?.[0] as bigint);
      if (functionName === "aspPostman") return "0x0000000000000000000000000000000000000001";
      if (functionName === "owner") return "0x0000000000000000000000000000000000000002";
      if (functionName === "SCOPE") return state.scope;
      if (functionName === "dead") return false;
      if (functionName === "minDeposit") return 0n;
      if (functionName === "nextIndex") return state.logs.filter((l) => "leafIndex" in l.args).length;
      throw new Error(`unexpected read ${functionName}`);
    },
    // one block every 12 s
    getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => {
      state.calls.push("getBlock");
      if (state.rpcDown) throw new Error("HTTP request failed. URL: https://rpc.example (the RPC must not be called here)");
      const number = blockNumber ?? state.head;
      return { number, timestamp: 1_790_000_000n + number * 12n };
    },
    getBalance: async () => {
      state.calls.push("getBalance");
      return 0n;
    },
  };
  return { state, client };
});

vi.mock("./chain", () => ({
  getPublicClient: (chainId?: number) => {
    if (chainId !== undefined && chainId !== 31337) throw new Error(`no fake client for chain ${chainId}`);
    return fake.client;
  },
  makeWalletClient: () => {
    throw new Error("no wallet in unit tests");
  },
  resetClients: () => {},
}));

import {
  AssociationProofError,
  associationSetLabels,
  buildAssociationProof,
  buildAssociationSet,
  extendsLabels,
  prefixSizes,
  previewAssociationSet,
  publishedASPRoots,
  publishedSetSize,
  resolveAssociationProof,
  SMALL_ASSOCIATION_SET,
} from "../../shared/privacy/associationSet";
import { TREE_DEPTH } from "../../shared/privacy/constants";
import { computeScope } from "../../shared/privacy/context";
import { fetchPoolEvents } from "../../shared/privacy/indexer";
import { MerkleTree } from "../../shared/privacy/merkleTree";
import { computeLabel } from "../../shared/privacy/notes";
import type { PoolEvent } from "../../shared/privacy/types";
import { recipeLabels, verifySet } from "../../shared/privacy/screening";
import { getASPStatus, getPublicAssociationSet, getScreenedSet, publishASPRoot, resetASPCache } from "./asp";
import { resetPrivacyConfig } from "./config";
import { getPoolActivity, getPoolDetail, listPools, resetPoolCaches } from "./pools";
import { privacyRouter } from "./router";

const POOL = "0x2222222222222222222222222222222222222222" as Address;
const SCOPE = computeScope(POOL, 31337);
const tx = (n: number): Hex => keccak256(toBytes(`assoc-tx-${n}`));
const ENV = ["PRIVACY_CHAIN_IDS", "PRIVACY_CHAIN_ID", "PRIVACY_POOL_ADDRESS", "PRIVACY_POOL_DEPLOY_BLOCK", "PRIVACY_ASP_CONFIRMATIONS", "PRIVACY_ASP_POSTMAN_PRIVATE_KEY", "PRIVACY_RELAYER_PRIVATE_KEY"];
const savedEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

/**
 * Chain history: six deposits over blocks 10-15, with two withdrawals whose change
 * notes take state-tree leaves in between (so deposit leaf indices are not contiguous).
 */
function history() {
  const logs = fake.state.logs;
  logs.length = 0;
  let leaf = 0;
  let nonce = 0n;
  const at = (blockNumber: bigint, eventName: string, args: Record<string, unknown>) =>
    logs.push({ eventName, args, blockNumber, transactionHash: tx(logs.length), logIndex: logs.filter((l) => l.blockNumber === blockNumber).length });
  const deposit = (block: bigint) => {
    const label = computeLabel(SCOPE, ++nonce);
    at(block, "Deposited", { depositor: POOL, commitment: 1_000n + BigInt(leaf), label, value: 10n ** 17n, precommitment: 7n, leafIndex: leaf++ });
    return label;
  };
  const withdraw = (block: bigint) =>
    at(block, "Withdrawn", { recipient: POOL, relayer: POOL, value: 1n, fee: 0n, spentNullifier: 5_000n + BigInt(leaf), newCommitment: 9_000n + BigInt(leaf), leafIndex: leaf++ });
  const labels = [deposit(10n), deposit(10n), deposit(11n)];
  withdraw(12n);
  labels.push(deposit(13n), deposit(14n));
  withdraw(14n);
  labels.push(deposit(15n));
  /** the publisher posts `root` on-chain at `block` (a legacy test cid unless one is given) */
  const publish = (block: bigint, root: bigint, cid = `test:${block}`) => {
    at(block, "ASPRootUpdated", { root, cid });
    fake.state.currentRoot = root;
    fake.state.knownRoots.add(root);
  };
  return { labels, publish };
}

/** What the browser does: decode the same logs with the shared indexer. */
const deviceEvents = (toBlock = fake.state.head) => fetchPoolEvents(fake.client as never, POOL, 0n, toBlock);
const isKnownRoot = async (root: bigint) => fake.state.knownRoots.has(root);
const rootOf = (labels: readonly bigint[]) => new MerkleTree(TREE_DEPTH, [...labels]).root;

async function rejection(p: Promise<unknown>): Promise<AssociationProofError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AssociationProofError);
  return err as AssociationProofError;
}

beforeEach(() => {
  Object.assign(process.env, { PRIVACY_CHAIN_ID: "31337", PRIVACY_POOL_ADDRESS: POOL, PRIVACY_POOL_DEPLOY_BLOCK: "0", PRIVACY_ASP_CONFIRMATIONS: "1" });
  delete process.env.PRIVACY_CHAIN_IDS;
  delete process.env.PRIVACY_ASP_POSTMAN_PRIVATE_KEY;
  delete process.env.PRIVACY_RELAYER_PRIVATE_KEY;
  resetPrivacyConfig();
  resetASPCache();
  resetPoolCaches();
  Object.assign(fake.state, { head: 20n, currentRoot: 0n, knownRoots: new Set<bigint>(), scope: SCOPE, calls: [], rpcDown: false });
  fake.state.logs.length = 0;
});

afterEach(() => {
  for (const k of ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  resetPrivacyConfig();
  resetASPCache();
  resetPoolCaches();
});

describe("association set: device == server", () => {
  it("the device rebuilds exactly the publisher's set and root from the same public events and the root's recipe", async () => {
    const { labels } = history();
    const server = (await getScreenedSet()).snapshot; // 31337: no inclusion delay, no exclusion list
    expect(server.labels).toEqual(labels);
    expect(server.recipe).toMatchObject({ version: 1, considered: 6, excludedLeaves: [], delaySeconds: 0, confirmations: 1 });
    expect(server.cid).toMatch(/^hylsia-asp:v1;n=6;x=;asOf=20;t=\d+;delay=0;conf=1$/);
    const events = await deviceEvents();
    expect(recipeLabels(events, server.recipe)).toEqual(server.labels);
    expect(verifySet(server.root, server.cid, events)?.labels).toEqual(labels);
    expect(server.root).toBe(rootOf(labels));
    // the open policy's helpers give the same list while nothing is excluded or waiting
    expect(buildAssociationSet(associationSetLabels(events)).roots[labels.length]).toBe(server.root);
    expect((await getASPStatus()).localRoot).toBe(server.root.toString());
    // event order does not matter: membership follows the state-tree leaf order
    expect(associationSetLabels([...events].reverse())).toEqual(labels);
    expect(recipeLabels([...events].reverse(), server.recipe)).toEqual(labels);
  });

  it("with a confirmation cutoff the published root is a prefix the device still matches", async () => {
    process.env.PRIVACY_ASP_CONFIRMATIONS = "3";
    resetPrivacyConfig();
    fake.state.head = 15n; // cutoff block 13: the first four deposits
    const { labels, publish } = history();
    const server = (await getScreenedSet()).snapshot;
    expect(server.labels).toEqual(labels.slice(0, 4));
    expect(server.recipe.considered).toBe(4);
    publish(15n, server.root, server.cid!); // the publisher's own record: the recipe

    const events = await deviceEvents();
    const proof = await buildAssociationProof({ label: labels[2], events, currentRoot: fake.state.currentRoot, isKnownRoot });
    expect(proof).toMatchObject({ root: rootOf(labels.slice(0, 4)), size: 4, index: 2, leaf: labels[2], source: "device" });
    expect(proof.recipe).toMatchObject({ version: 1, considered: 4, excludedLeaves: [] });
    expect(MerkleTree.verify(proof)).toBe(true);
    expect(proof.siblings).toEqual(new MerkleTree(TREE_DEPTH, labels.slice(0, 4)).proof(2).siblings);

    // the fifth deposit is not under the current root yet: the device refuses (Phase 4: WAITING, it joins with a later root)
    const err = await rejection(buildAssociationProof({ label: labels[4], events, currentRoot: fake.state.currentRoot, isKnownRoot }));
    expect(err.code).toBe("WAITING");
  });

  it("proves against the current root only (Phase 4: never an older root of the ring)", async () => {
    const { labels, publish } = history();
    publish(16n, rootOf(labels.slice(0, 3)));
    publish(17n, rootOf(labels));
    const events = await deviceEvents();
    expect(publishedASPRoots(events)).toEqual([rootOf(labels), rootOf(labels.slice(0, 3))]);
    const proof = await buildAssociationProof({ label: labels[0], events, currentRoot: fake.state.currentRoot, isKnownRoot });
    expect(proof.size).toBe(labels.length);
    expect(proof.root).toBe(rootOf(labels));

    // the current root unknown to the contract: the device fails closed, it never falls back to an older known root
    fake.state.knownRoots.delete(rootOf(labels));
    const refused = await rejection(buildAssociationProof({ label: labels[0], events, currentRoot: fake.state.currentRoot, isKnownRoot }));
    expect(refused.code).toBe("ROOT_NOT_KNOWN");
  });
});

describe("prefix proofs (MerkleTree.proof(index, size))", () => {
  it("equal the proof of a fresh tree of the first `size` leaves, and verify against its root", () => {
    const labels = Array.from({ length: 13 }, (_, i) => computeLabel(SCOPE, BigInt(i + 1)));
    const full = new MerkleTree(TREE_DEPTH, labels);
    expect(full.rootAt(0)).toBe(new MerkleTree(TREE_DEPTH).root);
    for (let size = 1; size <= labels.length; size++) {
      const ref = new MerkleTree(TREE_DEPTH, labels.slice(0, size));
      expect(full.rootAt(size)).toBe(ref.root);
      for (const index of new Set([0, Math.floor(size / 2), size - 1])) {
        const p = full.proof(index, size);
        expect(p).toEqual(ref.proof(index));
        expect(MerkleTree.verify(p)).toBe(true);
      }
    }
    expect(() => full.proof(5, 5)).toThrow();
    expect(() => full.rootAt(14)).toThrow();
  });
});

describe("device-side proof fails closed", () => {
  it("a root the contract does not know: clear error, no proof", async () => {
    const { labels, publish } = history();
    publish(16n, rootOf(labels));
    fake.state.knownRoots.clear(); // e.g. pushed out of the 16-root history, or a stale event cache
    const err = await rejection(buildAssociationProof({ label: labels[1], events: await deviceEvents(), currentRoot: fake.state.currentRoot, isKnownRoot }));
    expect(err.code).toBe("ROOT_NOT_KNOWN");
    expect(err.message).toMatch(/not a known root on-chain/);
    expect(err.message).toMatch(/no withdrawal was sent/);
    expect(err.message).toMatch(/ragequit \(public exit\)/);
  });

  it("nothing published, a root that matches no prefix, or a label outside the set: clear errors", async () => {
    const { labels } = history();
    const events = await deviceEvents();
    expect((await rejection(buildAssociationProof({ label: labels[0], events, currentRoot: 0n, isKnownRoot }))).code).toBe("NO_PUBLISHED_ROOT");
    // a root that is not the root of any prefix of the device's set is never used, whatever the chain says about it
    // (Phase 4: UNVERIFIED_ROOT, the device cannot rebuild its list)
    fake.state.knownRoots.add(424242n);
    expect((await rejection(buildAssociationProof({ label: labels[0], events, currentRoot: 424242n, isKnownRoot }))).code).toBe("UNVERIFIED_ROOT");
    fake.state.knownRoots.add(rootOf(labels)); // a root the device rebuilds (a prefix of its deposits)
    const notMember = await rejection(buildAssociationProof({ label: 31337n, events, currentRoot: rootOf(labels), isKnownRoot }));
    expect(notMember.code).toBe("NOT_MEMBER");
    for (const e of [notMember, new AssociationProofError("NO_PUBLISHED_ROOT"), new AssociationProofError("INVALID_PROOF")]) {
      expect(e.message).not.toMatch(/\bASP\b/); // the website's words: association set, association-set publisher
    }
  });
});

describe("the server never learns which label is spent", () => {
  it("a device whose events lack the root's event asks for its record once (no arguments), never for labels, and re-syncs", async () => {
    // Phase 4: the full-set fallback is gone. The record ({ root, cid }) is used only if its cid rebuilds to the root
    // from the device's own deposits; a device that lacks deposits re-syncs (resolve) or fails closed (build).
    const { labels, publish } = history();
    publish(16n, rootOf(labels));
    const fetchFullSet = vi.fn(async () => (await getPublicAssociationSet()).labels);
    const fetchRootRecord = vi.fn(async () => ({ root: fake.state.currentRoot, cid: "test:16" }));
    const lagging = await deviceEvents(13n); // this device's RPC is behind: deposits 5 and 6 are missing
    const err = await rejection(buildAssociationProof({ label: labels[1], events: lagging, currentRoot: fake.state.currentRoot, isKnownRoot, fetchFullSet, fetchRootRecord }));
    expect(err).toMatchObject({ code: "UNVERIFIED_ROOT", detail: "missing_deposits" });
    expect(fetchRootRecord).toHaveBeenCalledTimes(1);
    expect(fetchRootRecord.mock.calls[0]).toEqual([]);
    expect(fetchFullSet).not.toHaveBeenCalled();
    const reload = vi.fn(async () => ({ events: await deviceEvents(), currentRoot: fake.state.currentRoot }));
    const proof = await resolveAssociationProof({ label: labels[1], state: { events: lagging, currentRoot: fake.state.currentRoot }, reload, isKnownRoot, fetchRootRecord, publishDue: false });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(proof).toMatchObject({ source: "device", size: labels.length, root: rootOf(labels) });
    expect(MerkleTree.verify(proof)).toBe(true);

    // when the device's own events suffice, the server is not asked at all
    const unused = vi.fn(async () => null);
    await buildAssociationProof({ label: labels[1], events: await deviceEvents(), currentRoot: fake.state.currentRoot, isKnownRoot, fetchRootRecord: unused });
    expect(unused).not.toHaveBeenCalled();
  });

  it("the chain is asked the same public questions whichever deposit is spent, never about a label", async () => {
    const { labels, publish } = history();
    publish(16n, rootOf(labels.slice(0, 2)));
    publish(17n, rootOf(labels.slice(0, 5)));
    publish(18n, rootOf(labels));
    const events = await deviceEvents();
    const asked = async (label: bigint) => {
      const roots: bigint[] = [];
      await buildAssociationProof({ label, events, currentRoot: fake.state.currentRoot, isKnownRoot: async (r) => (roots.push(r), isKnownRoot(r)) });
      return roots.sort();
    };
    const first = await asked(labels[0]);
    expect(await asked(labels[5])).toEqual(first);
    expect(first.some((r) => labels.includes(r))).toBe(false);
  });

  it("the publish request depends on public data only: every deposit asks while the root is behind, none once it is current", async () => {
    // history A..F, root over the first three, nobody publishes on a schedule (the review probe's quiet pool)
    const { labels, publish } = history();
    const stale = rootOf(labels.slice(0, 3));
    publish(16n, stale);
    const staleState = { events: await deviceEvents(), currentRoot: fake.state.currentRoot };
    const before = { logs: fake.state.logs.length, known: new Set(fake.state.knownRoots) };
    const reset = () => {
      fake.state.logs.length = before.logs;
      fake.state.knownRoots = new Set(before.known);
      fake.state.currentRoot = stale;
      resetASPCache();
    };
    const reload = async () => ({ events: await deviceEvents(), currentRoot: fake.state.currentRoot });

    // every deposit under the stale root makes the same single, argument-free request (the decision reads no label),
    // and is then proved against the full current set, not the stale one; a deposit the stale root does not hold stops
    // before it, so it sends nothing (the app holds such a note back anyway: only a member starts a withdrawal)
    for (const i of [3, 5]) {
      reset();
      const requestPublish = vi.fn(async () => rootOf(labels));
      expect((await rejection(resolveAssociationProof({ label: labels[i], state: staleState, reload, isKnownRoot, requestPublish }))).code).toBe("WAITING");
      expect(requestPublish).not.toHaveBeenCalled();
    }
    for (const i of [0, 1, 2]) {
      reset();
      const requestPublish = vi.fn(async () => {
        publish(19n, rootOf(labels)); // what privacy.asp.publish does on-chain
        return rootOf(labels);
      });
      const proof = await resolveAssociationProof({ label: labels[i], state: staleState, reload, isKnownRoot, requestPublish });
      expect(requestPublish).toHaveBeenCalledTimes(1);
      expect(requestPublish.mock.calls[0]).toEqual([]);
      expect(proof).toMatchObject({ size: labels.length, root: rootOf(labels), index: i });
    }

    // once the root covers every deposit, no deposit asks
    const currentState = await reload();
    for (const label of labels) {
      const never = vi.fn(async () => 1n);
      await resolveAssociationProof({ label, state: currentState, reload, isKnownRoot, requestPublish: never });
      expect(never).not.toHaveBeenCalled();
    }
  });

  it("never asks again because a deposit is not covered: a declined publish leaves the published roots or a clear error", async () => {
    const { labels, publish } = history();
    publish(16n, rootOf(labels.slice(0, 3)));
    const state = { events: await deviceEvents(), currentRoot: fake.state.currentRoot };
    const reload = vi.fn(async () => ({ events: await deviceEvents(), currentRoot: fake.state.currentRoot }));
    const declined = vi.fn(async () => null); // nothing new, or no postman key

    // the old deposit proves against the root already published, after the single request; the new one fails closed
    // before any request (Phase 4 review round 2: nothing about a note the root does not hold is ever sent)
    const old = await resolveAssociationProof({ label: labels[1], state, reload, isKnownRoot, requestPublish: declined });
    expect(old).toMatchObject({ size: 3, root: rootOf(labels.slice(0, 3)) });
    const fresh = await rejection(resolveAssociationProof({ label: labels[4], state, reload, isKnownRoot, requestPublish: declined }));
    expect(fresh.code).toBe("WAITING"); // Phase 4: not under the current root yet
    expect(fresh.message).toMatch(/waiting for screening/);
    expect(declined).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();

    // a root the contract does not know, with the root current: no request at all
    publish(17n, rootOf(labels));
    const never = vi.fn(async () => 1n);
    const unknown = await rejection(
      resolveAssociationProof({ label: labels[0], state: await reload(), reload, isKnownRoot: async () => false, requestPublish: never }),
    );
    expect(unknown.code).toBe("ROOT_NOT_KNOWN");
    expect(never).not.toHaveBeenCalled();
  });

  it("a label that is not in the device's own events is refused without asking anyone", async () => {
    // Phase 4: the label is checked after the label-independent steps (the current root must be one the device rebuilds)
    const { labels, publish } = history();
    publish(13n, rootOf(labels.slice(0, 4)));
    const fetchFullSet = vi.fn(async () => labels);
    const fetchRootRecord = vi.fn(async () => null);
    const requestPublish = vi.fn(async () => 1n);
    const events = await deviceEvents(13n); // deposits 5 and 6 are not in this device's events
    const err = await rejection(buildAssociationProof({ label: labels[5], events, currentRoot: fake.state.currentRoot, isKnownRoot, fetchFullSet, fetchRootRecord }));
    expect(err.code).toBe("NOT_MEMBER");
    expect(fetchFullSet).not.toHaveBeenCalled();
    expect(fetchRootRecord).not.toHaveBeenCalled(); // the root's event is in this device's events
    // resolve asks for a publish only because the root is behind this device's view, never about the label
    const viaResolve = await rejection(
      resolveAssociationProof({ label: labels[5], state: { events, currentRoot: rootOf(labels.slice(0, 4)) }, reload: async () => ({ events, currentRoot: 0n }), isKnownRoot, fetchFullSet, requestPublish }),
    );
    expect(viaResolve.code).toBe("NOT_MEMBER");
    expect(requestPublish).not.toHaveBeenCalled();
  });

  it("the router has no per-label proof; it serves the full sets and a label-free, input-less publish", async () => {
    const procedures = Object.keys(privacyRouter._def.procedures);
    expect(procedures).toEqual(expect.arrayContaining(["asp.status", "asp.set", "asp.publish"]));
    expect(procedures).not.toContain("asp.proof");
    expect(procedures).not.toContain("events"); // the old server event mirror had no caller

    const { labels, publish } = history();
    const caller = privacyRouter.createCaller({ req: {}, res: {}, user: null } as never);
    const { sets, unavailable } = await caller.asp.set();
    expect(unavailable).toEqual([]);
    expect(sets).toHaveLength(1);
    // before the first root: the snapshot, marked as not on-chain
    expect(sets[0]).toMatchObject({ chainId: 31337, pool: POOL, memberCount: labels.length, onChain: false });
    expect(sets[0].labels).toEqual(labels);
    expect(sets[0].root).toBe(rootOf(labels));
    expect(sets[0].cid).toMatch(/^hylsia-asp:v1;n=6;x=;/);
    // no postman key configured: the publish request reports why and sends nothing (it takes no input at all)
    const calls = fake.state.calls.length;
    expect(await caller.asp.publish()).toEqual({ results: [{ chainId: 31337, pool: POOL, status: "no_key", root: rootOf(labels).toString() }] });
    expect(fake.state.calls.slice(calls)).not.toContain("simulateContract");
    const status = await caller.asp.status();
    expect(status.pools).toMatchObject([{ chainId: 31337, pool: POOL, confirmations: 1, memberCount: labels.length, canPublish: false, publishBlock: "no_key" }]);
    expect(status.pools[0].screening).toMatchObject({ policyVersion: 1, delaySeconds: 0, rootDue: true, current: null, excluded: [], exclusions: "none" });

    // once a root is on-chain: its { root, cid } and its list rebuilt from that cid (onChain), never the snapshot's
    const snapshot = (await getScreenedSet()).snapshot;
    publish(16n, rootOf(labels.slice(0, 3)), `hylsia-asp:v1;n=3;x=;asOf=16;t=1790000192;delay=0;conf=1`);
    resetASPCache();
    const after = (await caller.asp.set()).sets[0];
    expect(after).toMatchObject({ onChain: true, root: rootOf(labels.slice(0, 3)), memberCount: 3, cid: "hylsia-asp:v1;n=3;x=;asOf=16;t=1790000192;delay=0;conf=1" });
    expect(after.labels).toEqual(labels.slice(0, 3));
    expect(snapshot.memberCount).toBe(6);
    // a current root whose record does not rebuild to it: its { root, cid }, and no list
    publish(17n, 424242n, "hylsia-asp:v1;n=6;x=;asOf=17;t=1790000204;delay=0;conf=1");
    resetASPCache();
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect((await caller.asp.set()).sets[0]).toMatchObject({ onChain: true, root: 424242n, memberCount: 0, labels: [] });
      expect((await caller.asp.status()).pools[0].screening).toMatchObject({ current: { root: "424242", status: "mismatch", considered: null, memberCount: null }, rootDue: true });
    } finally {
      quiet.mockRestore();
    }
  });

  it("concurrent publish requests share one attempt", () => {
    history();
    const a = publishASPRoot();
    expect(publishASPRoot()).toBe(a);
    return a;
  });

  it("the publisher decides on fresh events, not its short cache (a device asks seconds after a deposit)", async () => {
    const { labels } = history();
    expect((await getScreenedSet()).snapshot.labels).toHaveLength(6); // warms the 3 s event cache
    const label = computeLabel(SCOPE, 7n);
    fake.state.head = 21n; // a new block with one more deposit
    fake.state.logs.push({
      eventName: "Deposited",
      args: { depositor: POOL, commitment: 1_008n, label, value: 10n ** 17n, precommitment: 7n, leafIndex: 8 },
      blockNumber: 21n,
      transactionHash: tx(99),
      logIndex: 0,
    });
    expect((await getScreenedSet()).snapshot.labels).toHaveLength(6); // the cached view
    const res = await publishASPRoot();
    expect(res.root).toBe(rootOf([...labels, label]).toString()); // decided on the new deposit too
  });
});

describe("a publisher cannot shrink the crowd with a crafted list", () => {
  it("a full set that does not extend the device's own list is ignored; the label keeps its own position", async () => {
    // the review probe: an honest root over six deposits, then the operator targets deposit #3 with root({#3})
    // and serves a 'full set' that starts with it. Phase 4: the device proves only against the current root, and it
    // cannot rebuild this one from its own deposits, so it fails closed (no proof in any set); server labels are never used.
    const { labels, publish } = history();
    publish(16n, rootOf(labels));
    const target = labels[3];
    const evil = rootOf([target]);
    publish(17n, evil);
    const events = await deviceEvents();
    const crafted = [target, ...Array.from({ length: 10 }, (_, i) => 10_000n + BigInt(i))];
    const fetchFullSet = vi.fn(async () => crafted);

    const err = await rejection(buildAssociationProof({ label: target, events, currentRoot: evil, isKnownRoot, fetchFullSet }));
    expect(err.code).toBe("UNVERIFIED_ROOT");
    expect(fetchFullSet).not.toHaveBeenCalled();

    // the browser's entry point: the same refusal, before any request (the current root is checked first)
    const requestPublish = vi.fn(async () => null);
    const viaResolve = await rejection(
      resolveAssociationProof({
        label: target,
        state: { events, currentRoot: evil },
        reload: async () => ({ events, currentRoot: evil }),
        isKnownRoot,
        fetchFullSet,
        requestPublish,
      }),
    );
    expect(viaResolve.code).toBe("UNVERIFIED_ROOT");
    expect(requestPublish).not.toHaveBeenCalled();

    // with the honest root gone from the contract's history, the device still fails closed instead of proving in a set of one
    fake.state.knownRoots.delete(rootOf(labels));
    const refused = await rejection(buildAssociationProof({ label: target, events, currentRoot: evil, isKnownRoot, fetchFullSet }));
    expect(refused.code).toBe("UNVERIFIED_ROOT");

    // lists that reorder or swap the device's deposits are ignored as well; one that only appends is used
    const own = associationSetLabels(events);
    expect(extendsLabels(own, [own[1], own[0], ...own.slice(2), 7n])).toBe(false);
    expect(extendsLabels(own, [...own.slice(0, 5), 7n, 8n])).toBe(false);
    expect(extendsLabels(own, own)).toBe(false);
    expect(extendsLabels(own, [...own, 7n])).toBe(true);
    expect(extendsLabels([], [7n])).toBe(true);
  });
});

describe("what the withdraw form shows (computed on the device, nothing sent)", () => {
  it("previewAssociationSet: the covered crowd, the full set and whether a newer root is asked for", async () => {
    const { labels, publish } = history();
    let events = await deviceEvents();
    // Phase 4 adds next / state / members / nextMembers (shared/privacy/screening.ts); without a screening answer `next`
    // is every deposit here (the open policy's next root)
    expect(previewAssociationSet({ label: labels[0], events, currentRoot: 0n })).toMatchObject({ deposits: 6, covered: null, behind: true, next: 6 });
    publish(16n, rootOf(labels.slice(0, 3)));
    events = await deviceEvents();
    expect(previewAssociationSet({ label: labels[1], events, currentRoot: fake.state.currentRoot })).toMatchObject({ deposits: 6, covered: 3, behind: true });
    expect(previewAssociationSet({ label: labels[4], events, currentRoot: fake.state.currentRoot })).toMatchObject({ deposits: 6, covered: null, behind: true });
    publish(17n, rootOf(labels));
    events = await deviceEvents();
    expect(previewAssociationSet({ label: labels[4], events, currentRoot: fake.state.currentRoot })).toMatchObject({ deposits: 6, covered: 6, behind: false, next: null });
    expect(previewAssociationSet({ label: 31337n, events, currentRoot: fake.state.currentRoot })).toMatchObject({ deposits: 6, covered: null, behind: false });
    expect(SMALL_ASSOCIATION_SET).toBe(10);
  });
});

describe("the dashboard's anonymity set is the crowd under the published root", () => {
  it("listPools and poolDetail lead with the published root's members, not the admitted count", async () => {
    const { labels, publish } = history();
    publish(16n, rootOf(labels.slice(0, 3)));
    let pool = (await listPools("24h")).pools[0];
    expect(pool).toMatchObject({ aspRootMembers: 3, aspMembers: 6, aspRootPublished: true, deposits: 6 });
    let detail = await getPoolDetail(31337, POOL, "7d");
    expect(detail.pool.aspRootMembers).toBe(3);
    expect(detail.series.at(-1)?.members).toBe(3);
    expect(detail.series[0].members).toBe(0); // before the first root
    // the public activity list names its chain and pool, so a device uses it only for that pool
    const activity = await getPoolActivity();
    expect(activity.pools).toMatchObject([{ chainId: 31337, pool: POOL }]);
    expect(activity.unavailable).toEqual([]);

    // the next root covers every deposit
    publish(17n, rootOf(labels));
    resetASPCache();
    resetPoolCaches(); // the 5 s load memo
    pool = (await listPools("24h")).pools[0];
    expect(pool).toMatchObject({ aspRootMembers: 6, aspMembers: 6 });
    detail = await getPoolDetail(31337, POOL, "7d");
    expect(detail.series.at(-1)?.members).toBe(6);

    // Phase 4: devices prove against the current root only, so a current root that is no prefix of the deposits (and
    // has no recipe) leaves no crowd at all, whatever older roots the contract still knows
    publish(18n, 424242n);
    resetASPCache();
    resetPoolCaches();
    pool = (await listPools("24h")).pools[0];
    expect(pool).toMatchObject({ aspRootMembers: 0, aspMembers: 6 });
    detail = await getPoolDetail(31337, POOL, "7d");
    expect(detail.series.at(-1)?.members).toBe(0);
  });

  it("nothing published: 0, however many deposits are admitted", async () => {
    history();
    const pool = (await listPools("24h")).pools[0];
    expect(pool).toMatchObject({ aspRootMembers: 0, aspMembers: 6, aspRootPublished: false });
  });

  it("publishedSetSize: the largest rebuildable root among the contract's last 16 updates", () => {
    const labels = Array.from({ length: 8 }, (_, i) => computeLabel(SCOPE, BigInt(i + 1)));
    const sizes = prefixSizes(buildAssociationSet(labels));
    const r = (k: number) => rootOf(labels.slice(0, k));
    expect(publishedSetSize(sizes, [])).toBe(0);
    expect(publishedSetSize(sizes, [r(2), r(5), 99n])).toBe(5);
    // 16 later updates of a one-member root push the five-member root out of the history: the crowd really is 1 now
    expect(publishedSetSize(sizes, [r(5), ...Array.from({ length: 16 }, () => r(1))])).toBe(1);
    expect(publishedSetSize(sizes, [r(5), ...Array.from({ length: 15 }, () => r(1))])).toBe(5);
  });
});

describe("pending state (no pool configured)", () => {
  it("listPools and poolActivity answer from the server clock without contacting the RPC", async () => {
    delete process.env.PRIVACY_POOL_ADDRESS;
    resetPrivacyConfig();
    fake.state.rpcDown = true;
    const before = Math.floor(Date.now() / 1000);
    const pools = await listPools("24h");
    const activity = await getPoolActivity();
    const after = Math.floor(Date.now() / 1000);
    expect(pools.pools).toEqual([]);
    expect(pools.networks).toEqual([{ chainId: 31337, pool: null }]);
    expect(pools.unavailable).toEqual([]);
    expect(pools.now).toBeGreaterThanOrEqual(before);
    expect(pools.now).toBeLessThanOrEqual(after);
    expect(activity).toEqual({ now: activity.now, pools: [], unavailable: [] });
    expect(activity.now).toBeGreaterThanOrEqual(before);
    expect(fake.state.calls).toEqual([]);
  });
});

// Keep the PoolEvent import honest: the fake logs decode into the shared event types.
it("fake logs decode into pool events", async () => {
  history();
  const events: PoolEvent[] = await deviceEvents();
  expect(events.filter((e) => e.kind === "deposit")).toHaveLength(6);
  expect(events.filter((e) => e.kind === "withdraw")).toHaveLength(2);
});
