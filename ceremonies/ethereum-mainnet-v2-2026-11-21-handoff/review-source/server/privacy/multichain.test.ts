/**
 * Several networks side by side on the server (final design §4, §10), the relayer's and the publisher's funding
 * states, and the periodic publisher.
 *
 * Hylsia is built for Robinhood Chain Testnet; its server serves any list of networks. Two fake chains, 31337
 * ("Local chain A") and 31338 ("Local chain B"), share ONE pool address, with overlapping block numbers and different
 * block times. ./chain is mocked per chain; config, the event sync, the contract check, the association set, the
 * publisher, the funding reads, the periodic publisher, the relayer, the pools explorer and the router run for real.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { Address, Hex } from "viem";

type FakeLog = { eventName: string; args: Record<string, unknown>; blockNumber: bigint; transactionHash: Hex; logIndex: number };
type FakeRequest = { functionName: string; args: readonly unknown[]; account: { address: string }; simulatedOn: number };

const fakes = vi.hoisted(() => {
  const hex64 = (chainId: number, n: number) => `0x${chainId.toString(16).padStart(8, "0")}${n.toString(16).padStart(56, "0")}` as Hex;
  /** the pool address of both chains (POOL below); every other address is a key */
  const POOL_ADDRESS = "0x2222222222222222222222222222222222222222";
  /** what a key holds unless a test sets keyBalances: plenty for any transaction */
  const FUNDED = 10n ** 19n;

  function make(chainId: number, t0: bigint, blockTime: bigint) {
    const fresh = () => ({
      /** what eth_chainId answers: a misconfigured RPC answers another chain */
      rpcChainId: chainId,
      head: 0n,
      logs: [] as FakeLog[],
      currentRoot: 0n,
      knownRoots: new Set<bigint>(),
      scope: 0n,
      code: "0x6080" as Hex | undefined,
      postman: "0x0000000000000000000000000000000000000001",
      /** the pool's balance */
      balance: 0n,
      /** eth_gasPrice (1 gwei) */
      gasPrice: 1_000_000_000n,
      /** eth_gasPrice fails like a flaky RPC, everything else answers */
      gasPriceFails: false,
      /** the keys' balances by lowercase address (unset: FUNDED) */
      keyBalances: new Map<string, bigint>(),
      /** the next send is refused like a node does for a sender that cannot pay */
      refuseSendForFunds: false,
      /** every call fails like an unreachable RPC (its URL carries a secret path) */
      down: false,
      /** every call hangs like an RPC that accepts the connection and never answers */
      hang: false,
      /** getLogs fails for blocks above this one (a scan cut off half way); null: never */
      logsFailAbove: null as bigint | null,
      calls: [] as string[],
      sent: [] as { functionName: string; args: readonly unknown[]; from: string; hash: Hex }[],
      /** mined receipts by hash; a hash that is not here is not mined yet */
      receipts: new Map<Hex, "success" | "reverted">(),
      /** false: a sent transaction waits for mine() */
      automine: true,
      /** the status the next mined transaction gets */
      nextStatus: "success" as "success" | "reverted",
      unmined: [] as { hash: Hex; request: FakeRequest }[],
      txCount: 0,
      /** every getLogs range asked for, in order */
      logRanges: [] as [bigint, bigint][],
    });
    const chain = { chainId, t0, blockTime, state: fresh(), reset: () => {}, mine: () => {}, client: {} as Record<string, unknown>, wallet: (_address: string) => ({}) as unknown };
    chain.reset = () => {
      chain.state = fresh();
    };
    const hit = (name: string) => {
      chain.state.calls.push(name);
      if (chain.state.down) throw new Error(`HTTP request failed. URL: http://127.0.0.1:1/key-${chainId}/secret-path?apikey=topsecret`);
    };
    const apply = (hash: Hex, request: FakeRequest) => {
      const s = chain.state;
      const status = s.nextStatus;
      s.receipts.set(hash, status);
      if (status !== "success") return;
      s.head += 1n;
      if (request.functionName === "updateASPRoot") {
        const root = request.args[0] as bigint;
        s.currentRoot = root;
        s.knownRoots.add(root);
        s.logs.push({ eventName: "ASPRootUpdated", args: { root, cid: String(request.args[1]) }, blockNumber: s.head, transactionHash: hash, logIndex: 0 });
      }
    };
    chain.mine = () => {
      for (const tx of chain.state.unmined.splice(0)) apply(tx.hash, tx.request);
    };
    chain.client = {
      getChainId: async () => (hit("getChainId"), chain.state.rpcChainId),
      getCode: async () => (hit("getCode"), chain.state.code),
      getBlockNumber: async () => (hit("getBlockNumber"), chain.state.head),
      getBlock: async ({ blockNumber }: { blockNumber?: bigint } = {}) => {
        hit("getBlock");
        const number = blockNumber ?? chain.state.head;
        return { number, timestamp: t0 + number * blockTime };
      },
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        hit("getLogs");
        chain.state.logRanges.push([fromBlock, toBlock]);
        if (chain.state.logsFailAbove !== null && toBlock > chain.state.logsFailAbove) throw new Error("HTTP request failed. (connection reset)");
        return chain.state.logs.filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock);
      },
      readContract: async ({ functionName, args }: { functionName: string; args?: readonly unknown[] }) => {
        hit(`readContract:${functionName}`);
        const s = chain.state;
        switch (functionName) {
          case "SCOPE":
            return s.scope;
          case "currentASPRoot":
            return s.currentRoot;
          case "isKnownASPRoot":
            return s.knownRoots.has(args?.[0] as bigint);
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
            return BigInt(chainId) * 1_000n;
        }
        throw new Error(`unexpected read ${functionName}`);
      },
      getBalance: async ({ address }: { address: string }) => {
        hit("getBalance");
        const a = address.toLowerCase();
        return a === POOL_ADDRESS ? chain.state.balance : (chain.state.keyBalances.get(a) ?? FUNDED);
      },
      getGasPrice: async () => {
        hit("getGasPrice");
        if (chain.state.gasPriceFails) throw new Error("HTTP request failed. (eth_gasPrice)");
        return chain.state.gasPrice;
      },
      getTransactionCount: async ({ address, blockTag }: { address: string; blockTag?: string }) => {
        hit(`getTransactionCount:${blockTag ?? "latest"}`);
        const from = address.toLowerCase();
        const sent = chain.state.sent.filter((t) => t.from.toLowerCase() === from).length;
        const unmined = chain.state.unmined.filter((t) => t.request.account.address.toLowerCase() === from).length;
        return blockTag === "pending" ? sent : sent - unmined;
      },
      simulateContract: async (p: { functionName: string; args: readonly unknown[]; account: { address: string } }) => {
        hit(`simulateContract:${p.functionName}`);
        const request: FakeRequest = { functionName: p.functionName, args: p.args, account: p.account, simulatedOn: chainId };
        return { request };
      },
      waitForTransactionReceipt: async ({ hash, timeout }: { hash: Hex; timeout?: number }) => {
        hit("waitForTransactionReceipt");
        // polls every millisecond up to the timeout (capped), without reading the clock the tests move
        for (let waited = 0; ; waited++) {
          const status = chain.state.receipts.get(hash);
          if (status) return { status, transactionHash: hash, blockNumber: chain.state.head };
          if (waited >= Math.min(timeout ?? 0, 200)) throw new Error(`Timed out while waiting for transaction with hash "${hash}" to be confirmed.`);
          await new Promise((r) => setTimeout(r, 1));
        }
      },
      getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
        hit("getTransactionReceipt");
        const status = chain.state.receipts.get(hash);
        if (!status) throw new Error(`Transaction receipt with hash "${hash}" could not be found.`);
        return { status, transactionHash: hash, blockNumber: chain.state.head };
      },
    };
    // a hung RPC: every call of the public client waits forever (the server's deadline answers for it)
    for (const [name, fn] of Object.entries(chain.client)) {
      chain.client[name] = (...args: unknown[]) => (chain.state.hang ? new Promise(() => {}) : (fn as (...a: unknown[]) => unknown)(...args));
    }
    chain.wallet = (address: string) => ({
      account: { address },
      writeContract: async (request: FakeRequest) => {
        hit(`writeContract:${request.functionName}`);
        // the bundle rule: a request simulated on one chain is never written on another
        if (request.simulatedOn !== chainId) throw new Error(`request simulated on ${request.simulatedOn} written on ${chainId}`);
        const s = chain.state;
        if (s.refuseSendForFunds) {
          s.refuseSendForFunds = false;
          throw new Error(`insufficient funds for gas * price + value: address ${address} have 0 want 2400000000000000`);
        }
        const hash = hex64(chainId, ++s.txCount);
        s.sent.push({ functionName: request.functionName, args: request.args, from: address, hash });
        if (s.automine) apply(hash, request);
        else s.unmined.push({ hash, request });
        return hash;
      },
    });
    return chain;
  }

  const A = make(31337, 1_790_000_000n, 12n);
  const B = make(31338, 1_700_000_000n, 2n);
  const byId = new Map([
    [31337, A],
    [31338, B],
  ]);
  /** the server modules always name the chain in multi mode; an omitted id resolves only when one chain is served */
  const chain = (chainId: number | undefined) => {
    const c = chainId === undefined ? undefined : byId.get(chainId);
    if (!c) throw new Error(`the fake has no client for chain ${chainId}`);
    return c;
  };
  return { A, B, chain };
});

vi.mock("./chain", async () => {
  const { privateKeyToAccount } = await import("viem/accounts");
  return {
    getPublicClient: (chainId?: number) => fakes.chain(chainId).client,
    makeWalletClient: (key: Hex, chainId?: number) => fakes.chain(chainId).wallet(privateKeyToAccount(key).address),
    resetClients: () => {},
  };
});

import { privateKeyToAccount } from "viem/accounts";
import { anvilKey } from "../../scripts/privacy/anvilKeys";
import { TREE_DEPTH } from "../../shared/privacy/constants";
import { computeContext, computeScope } from "../../shared/privacy/context";
import { MerkleTree } from "../../shared/privacy/merkleTree";
import { computeLabel } from "../../shared/privacy/notes";
import {
  getASPStatuses,
  getPublicAssociationSets,
  publishASPRoot,
  publishBehindRoots,
  requirePool,
  resetASPCache,
  setPoolDeadlineMs,
  syncEvents,
} from "./asp";
import { autoPublishTick, startAutoPublisher } from "./autoPublish";
import { chainConfig, DEFAULT_AUTO_PUBLISH_SECONDS, loadPrivacyConfig, logPrivacyConfigSummary, privacyConfig, repoRoot, resetPrivacyConfig } from "./config";
import { GAS_PRICE_MARGIN, oneTransactionCost, PUBLISH_GAS, readFunding, resetFundingCache, WITHDRAW_GAS } from "./funding";
import { getNetworks, getPoolActivity, getPoolDetail, listPools, resetPoolCaches } from "./pools";
import { computeFee, getQuote, getQuotes, relayWithdrawal } from "./relayer";
import { privacyRouter } from "./router";

const { A, B } = fakes;
const POOL = "0x2222222222222222222222222222222222222222" as Address;
const DEPOSITOR = "0x00000000000000000000000000000000000000d1" as Address;
// anvil's public test keys #0 (posts roots) and #1 (relays), derived at run time from anvil's public mnemonic
const POSTMAN_KEY = anvilKey(0);
const RELAYER_KEY = anvilKey(1);
const POSTMAN = privateKeyToAccount(POSTMAN_KEY).address;
const RELAYER = privateKeyToAccount(RELAYER_KEY).address;
const SCOPE_A = computeScope(POOL, 31337);
const SCOPE_B = computeScope(POOL, 31338);
const timeA = (block: bigint) => Number(A.t0 + block * A.blockTime);
const timeB = (block: bigint) => Number(B.t0 + block * B.blockTime);
const rootOf = (labels: readonly bigint[]) => new MerkleTree(TREE_DEPTH, [...labels]).root;
const caller = () => privacyRouter.createCaller({ req: {}, res: {}, user: null } as never);

const ENV = [
  "PRIVACY_CHAIN_IDS",
  "PRIVACY_CHAIN_ID",
  "PRIVACY_RPC_URL",
  "PRIVACY_RPC_URL_31337",
  "PRIVACY_RPC_URL_31338",
  "PRIVACY_POOL_ADDRESS",
  "PRIVACY_POOL_ADDRESS_31337",
  "PRIVACY_POOL_ADDRESS_31338",
  "PRIVACY_POOL_DEPLOY_BLOCK",
  "PRIVACY_POOL_DEPLOY_BLOCK_31337",
  "PRIVACY_POOL_DEPLOY_BLOCK_31338",
  "PRIVACY_RELAYER_PRIVATE_KEY",
  "PRIVACY_RELAYER_FEE_BPS",
  "PRIVACY_RELAYER_FEE_BPS_31337",
  "PRIVACY_RELAYER_FEE_BPS_31338",
  "PRIVACY_RELAYER_MIN_FEE_WEI",
  "PRIVACY_RELAYER_MIN_FEE_WEI_31338",
  "PRIVACY_QUOTE_TTL_SECONDS",
  "PRIVACY_ASP_POSTMAN_PRIVATE_KEY",
  "PRIVACY_ASP_POSTMAN_PRIVATE_KEY_31337",
  "PRIVACY_ASP_POSTMAN_PRIVATE_KEY_31338",
  "PRIVACY_ASP_AUTO_PUBLISH_SECONDS",
  "PRIVACY_ASP_CONFIRMATIONS",
  "PRIVACY_ASP_CONFIRMATIONS_31337",
  "PRIVACY_ASP_CONFIRMATIONS_31338",
  "PRIVACY_REORG_WINDOW_31337",
  "PRIVACY_LOG_CHUNK_31337",
  "PRIVACY_ASP_RECEIPT_WAIT_MS_31337",
  "PRIVACY_ASP_RECEIPT_WAIT_MS_31338",
  "PRIVACY_ASP_INCLUSION_DELAY_SECONDS",
  "PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337",
  "PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31338",
  "PRIVACY_ASP_EXCLUSIONS_FILE",
  "PRIVACY_ASP_EXCLUSIONS_JSON",
];
const savedEnv = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

function setEnv(values: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetPrivacyConfig();
  resetASPCache();
  resetPoolCaches();
}

/** Deposits on one fake chain; returns their labels (membership order). */
function deposit(chain: typeof A, scope: bigint, blocks: bigint[], value: bigint): bigint[] {
  const logs = chain.state.logs;
  return blocks.map((blockNumber) => {
    const leafIndex = logs.filter((l) => "leafIndex" in l.args).length;
    const label = computeLabel(scope, BigInt(leafIndex + 1));
    logs.push({
      eventName: "Deposited",
      args: { depositor: DEPOSITOR, commitment: 5_000n + BigInt(leafIndex), label, value, precommitment: 7n, leafIndex },
      blockNumber,
      transactionHash: `0x${chain.chainId.toString(16).padStart(8, "0")}${(logs.length + 1).toString(16).padStart(56, "f")}` as Hex,
      logIndex: logs.filter((l) => l.blockNumber === blockNumber).length,
    });
    return label;
  });
}

let labelsA: bigint[] = [];
let labelsB: bigint[] = [];

beforeEach(() => {
  A.reset();
  B.reset();
  for (const k of ENV) delete process.env[k];
  setEnv({
    PRIVACY_CHAIN_IDS: "31337,31338",
    PRIVACY_POOL_ADDRESS_31337: POOL,
    PRIVACY_POOL_ADDRESS_31338: POOL, // the same address on both chains, on purpose
    PRIVACY_RELAYER_PRIVATE_KEY: RELAYER_KEY, // one relayer key and one postman key serve both networks
    PRIVACY_ASP_POSTMAN_PRIVATE_KEY: POSTMAN_KEY,
    PRIVACY_RELAYER_FEE_BPS_31337: "100",
    PRIVACY_RELAYER_FEE_BPS_31338: "50",
    PRIVACY_RELAYER_MIN_FEE_WEI_31338: "1000000000000000",
    PRIVACY_ASP_CONFIRMATIONS_31338: "2",
  });
  Object.assign(A.state, { head: 20n, scope: SCOPE_A, postman: POSTMAN, balance: 3n * 10n ** 17n });
  Object.assign(B.state, { head: 30n, scope: SCOPE_B, postman: POSTMAN, balance: 4n * 10n ** 18n });
  // overlapping block numbers on both chains; their times differ (12 s blocks from t0 A, 2 s blocks from t0 B)
  labelsA = deposit(A, SCOPE_A, [10n, 11n, 12n], 10n ** 17n);
  labelsB = deposit(B, SCOPE_B, [10n, 11n], 2n * 10n ** 18n);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  resetPrivacyConfig();
  resetASPCache();
  resetPoolCaches();
});

const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => {});

describe("two pools at one address stay apart", () => {
  it("listPools: one entry per chain with its own scope, size, balance and head time", async () => {
    const answer = await listPools("24h");
    expect(answer.networks).toEqual([
      { chainId: 31337, pool: POOL },
      { chainId: 31338, pool: POOL },
    ]);
    expect(answer.unavailable).toEqual([]);
    expect(answer.pools.map((p) => [p.chainId, p.pool])).toEqual([
      [31337, POOL],
      [31338, POOL],
    ]);
    const [a, b] = answer.pools;
    expect(a).toMatchObject({ scope: SCOPE_A, deposits: 3, leafCount: 3, tvl: 3n * 10n ** 17n, aspMembers: 3, relayerFeeBps: 100, relayer: RELAYER });
    expect(b).toMatchObject({ scope: SCOPE_B, deposits: 2, leafCount: 2, tvl: 4n * 10n ** 18n, aspMembers: 2, relayerFeeBps: 50, relayer: RELAYER });
    expect(a.now).toBe(timeA(20n));
    expect(b.now).toBe(timeB(30n));
    expect(answer.now).toBeGreaterThan(b.now); // the server clock, not a chain's
  });

  it("getPoolActivity: each entry has its own now and block times, even at the same block numbers", async () => {
    const { pools, unavailable } = await getPoolActivity();
    expect(unavailable).toEqual([]);
    const [a, b] = pools;
    expect([a.chainId, a.pool, b.chainId, b.pool]).toEqual([31337, POOL, 31338, POOL]);
    expect(a.now).toBe(timeA(20n));
    expect(b.now).toBe(timeB(30n));
    expect(a.activity.map((x) => [x.blockNumber, x.timestamp])).toEqual([10n, 11n, 12n].map((n) => [n, timeA(n)]));
    expect(b.activity.map((x) => [x.blockNumber, x.timestamp])).toEqual([10n, 11n].map((n) => [n, timeB(n)]));
    expect(b.activity.every((x) => x.value === 2n * 10n ** 18n)).toBe(true);
  });

  it("getPoolDetail answers differ per chain; ASP status, sets and quotes are each chain's own", async () => {
    const [da, db] = await Promise.all([getPoolDetail(31337, POOL, "7d"), getPoolDetail(31338, POOL, "7d")]);
    expect([da.pool.chainId, da.pool.deposits, da.now]).toEqual([31337, 3, timeA(20n)]);
    expect([db.pool.chainId, db.pool.deposits, db.now]).toEqual([31338, 2, timeB(30n)]);
    // newest first, each dated by its own chain's blocks
    expect(da.activity.map((x) => x.timestamp)).toEqual([12n, 11n, 10n].map(timeA));
    expect(db.activity.map((x) => x.timestamp)).toEqual([11n, 10n].map(timeB));
    expect(da.health.uniqueAmountDeposits).toBe(0);

    const status = await getASPStatuses();
    expect(status.unavailable).toEqual([]);
    expect(status.pools).toMatchObject([
      { chainId: 31337, pool: POOL, confirmations: 1, memberCount: 3, localRoot: rootOf(labelsA).toString(), canPublish: true, publishBlock: null },
      { chainId: 31338, pool: POOL, confirmations: 2, memberCount: 2, localRoot: rootOf(labelsB).toString(), canPublish: true, publishBlock: null },
    ]);
    const { sets } = await getPublicAssociationSets();
    expect(sets.map((s) => [s.chainId, s.pool, s.memberCount])).toEqual([
      [31337, POOL, 3],
      [31338, POOL, 2],
    ]);
    expect(sets[0].labels).toEqual(labelsA);
    expect(sets[1].labels).toEqual(labelsB);

    expect((await getQuotes()).quotes).toMatchObject([
      { chainId: 31337, pool: POOL, available: true, reason: null, relayer: RELAYER, feeBps: 100, minFeeWei: "0" },
      { chainId: 31338, pool: POOL, available: true, reason: null, relayer: RELAYER, feeBps: 50, minFeeWei: "1000000000000000" },
    ]);
    expect(computeFee(10n ** 18n, 31337)).toBe(10n ** 16n);
    expect(computeFee(10n ** 17n, 31338)).toBe(10n ** 15n); // the minimum fee
  });

  it("the networks answer lists each network's live state", async () => {
    const answer = await getNetworks();
    expect(answer.protocol).toBe("hylsia-pp-v1");
    const services = { relayerAvailable: true, relayerBlock: null, aspCanPublish: true, aspPublishBlock: null };
    expect(answer.networks).toMatchObject([
      { chainId: 31337, configured: true, available: true, pool: POOL, scope: SCOPE_A, leafCount: 3n, lastRoot: 31_337_000n, poolBalance: 3n * 10n ** 17n, relayerFeeBps: 100, ...services },
      { chainId: 31338, configured: true, available: true, pool: POOL, scope: SCOPE_B, leafCount: 2n, lastRoot: 31_338_000n, poolBalance: 4n * 10n ** 18n, relayerFeeBps: 50, ...services },
    ]);
  });
});

describe("isolation", () => {
  it("one RPC down: only that pool is unavailable, and no log or answer carries its URL", async () => {
    const warn = quiet();
    B.state.down = true;
    const pools = await listPools("24h");
    expect(pools.pools.map((p) => p.chainId)).toEqual([31337]);
    expect(pools.unavailable).toEqual([{ chainId: 31338, pool: POOL, reason: "rpc_error" }]);
    expect(pools.networks).toHaveLength(2);
    const activity = await getPoolActivity();
    expect(activity.pools.map((p) => p.chainId)).toEqual([31337]);
    expect(activity.unavailable).toEqual([{ chainId: 31338, pool: POOL, reason: "rpc_error" }]);
    expect((await getASPStatuses()).unavailable).toEqual([{ chainId: 31338, pool: POOL, reason: "rpc_error" }]);
    expect((await getPublicAssociationSets()).sets.map((s) => s.chainId)).toEqual([31337]);
    const networks = await getNetworks();
    expect(networks.networks[0]).toMatchObject({ chainId: 31337, available: true });
    expect(networks.networks[1]).toEqual({ chainId: 31338, configured: true, available: false, pool: POOL, reason: "rpc_error" });
    const { results } = await publishBehindRoots();
    expect(results[0]).toMatchObject({ chainId: 31337, status: "published" });
    expect(results[1]).toEqual({ chainId: 31338, pool: POOL, status: "unavailable", root: null });

    const detail = await getPoolDetail(31338, POOL, "7d").then(
      () => null,
      (e: unknown) => e,
    );
    expect(detail).toBeInstanceOf(TRPCError);
    expect((detail as TRPCError).message).toBe("The privacy pool on Local chain B (31338) is unavailable right now: its RPC node did not answer");

    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("Local chain B (31338)");
    expect(logged).toContain("127.0.0.1:1");
    expect(logged).not.toMatch(/secret|topsecret|apikey/);

    // the chain comes back: after the 5 s memo it is listed again
    B.state.down = false;
    resetPoolCaches();
    expect((await listPools("24h")).pools.map((p) => p.chainId)).toEqual([31337, 31338]);
  });

  it("one RPC that hangs: every call that covers all pools answers within the pool deadline, the other network as usual", async () => {
    const warn = quiet();
    setPoolDeadlineMs(80);
    try {
      B.state.hang = true; // accepts the connection, never answers
      const started = Date.now();
      const [pools, activity, statuses, sets, networks, published] = await Promise.all([
        listPools("24h"),
        getPoolActivity(),
        getASPStatuses(),
        getPublicAssociationSets(),
        getNetworks(),
        publishBehindRoots(),
      ]);
      expect(Date.now() - started).toBeLessThan(3_000); // was 41 s (and 82 s for the publish) with viem's retries alone
      const hung = [{ chainId: 31338, pool: POOL, reason: "rpc_error" }];
      expect(pools.pools.map((p) => p.chainId)).toEqual([31337]);
      expect(pools.unavailable).toEqual(hung);
      expect(activity.pools.map((p) => p.chainId)).toEqual([31337]);
      expect(activity.unavailable).toEqual(hung);
      expect(statuses.pools.map((p) => p.chainId)).toEqual([31337]);
      expect(statuses.unavailable).toEqual(hung);
      expect(sets.sets.map((p) => p.chainId)).toEqual([31337]);
      expect(networks.networks[0]).toMatchObject({ chainId: 31337, available: true });
      expect(networks.networks[1]).toEqual({ chainId: 31338, configured: true, available: false, pool: POOL, reason: "rpc_error" });
      expect(published.results).toEqual([
        expect.objectContaining({ chainId: 31337, status: "published" }),
        { chainId: 31338, pool: POOL, status: "unavailable", root: null },
      ]);
      await expect(getPoolDetail(31338, POOL, "7d")).rejects.toMatchObject({
        message: "The privacy pool on Local chain B (31338) is unavailable right now: its RPC node did not answer within 0 s",
      });
      expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toContain("Local chain B (31338) pools: unavailable (rpc_error)");
      expect(B.state.sent).toEqual([]); // nothing was posted on the hung chain
    } finally {
      setPoolDeadlineMs(null);
      B.state.hang = false;
    }
  });

  it("a publish whose send outlives the deadline is never sent twice", async () => {
    quiet();
    setPoolDeadlineMs(80);
    B.state.automine = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const wallet = fakes.chain(31338).wallet(POSTMAN) as { writeContract: (r: unknown) => Promise<Hex> };
    const send = wallet.writeContract.bind(wallet);
    const spy = vi.spyOn(fakes.B, "wallet").mockImplementation(() => ({
      account: { address: POSTMAN },
      writeContract: async (request: unknown) => {
        await gate; // the RPC holds the send past the deadline
        return send(request);
      },
    }));
    try {
      const first = await publishASPRoot(31338).then(
        () => null,
        (e: unknown) => e,
      );
      expect(first).toMatchObject({ name: "PoolDeadlineError" });
      // a repeat while that send is still out joins it (it answers within its own deadline): no second post
      const repeat = await publishASPRoot(31338).then(
        () => null,
        (e: unknown) => e,
      );
      expect(repeat).toMatchObject({ name: "PoolDeadlineError" });
      release();
      await new Promise((r) => setTimeout(r, 20));
      expect(B.state.sent).toHaveLength(1);
      // the late answer was recorded: the next request reports that post (not mined yet) and sends nothing
      expect(await publishASPRoot(31338)).toMatchObject({ chainId: 31338, status: "pending", txHash: B.state.sent[0].hash });
      expect(B.state.sent).toHaveLength(1);
    } finally {
      spy.mockRestore();
      setPoolDeadlineMs(null);
    }
  });

  it("a network without a pool makes zero RPC calls, everywhere", async () => {
    setEnv({ PRIVACY_POOL_ADDRESS_31338: undefined });
    const pools = await listPools("24h");
    expect(pools.networks).toEqual([
      { chainId: 31337, pool: POOL },
      { chainId: 31338, pool: null },
    ]);
    expect(pools.pools.map((p) => p.chainId)).toEqual([31337]);
    expect(pools.unavailable).toEqual([]); // not deployed yet is not unavailable
    expect((await getPoolActivity()).pools.map((p) => p.chainId)).toEqual([31337]);
    expect((await getASPStatuses()).pools.map((p) => p.chainId)).toEqual([31337]);
    expect((await getPublicAssociationSets()).sets.map((p) => p.chainId)).toEqual([31337]);
    expect((await getNetworks()).networks[1]).toEqual({ chainId: 31338, configured: false });
    expect((await publishBehindRoots()).results[1]).toEqual({ chainId: 31338, pool: null, status: "unavailable", root: null });
    expect(await getQuote(31338)).toMatchObject({ chainId: 31338, pool: null, available: false, reason: "no_pool" });
    await expect(getPoolDetail(31338, POOL, "7d")).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: `No privacy pool at ${POOL} on Local chain B (31338)`,
    });
    await expect(caller().relayer.status({ chainId: 31338, txHash: `0x${"1".repeat(64)}` })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(B.state.calls).toEqual([]);
    expect(A.state.calls.length).toBeGreaterThan(0);
  });

  it("a pool with a configuration problem is unavailable (never 'not deployed') and gets no RPC call", async () => {
    setEnv({ PRIVACY_POOL_ADDRESS_31338: "0x1234" }); // invalid_address
    expect(chainConfig(31338).problems).toEqual(["invalid_address"]);
    expect((await listPools("24h")).unavailable).toEqual([{ chainId: 31338, pool: null, reason: "config_error" }]);
    expect((await getPoolActivity()).unavailable).toEqual([{ chainId: 31338, pool: null, reason: "config_error" }]);
    expect((await getNetworks()).networks[1]).toMatchObject({ chainId: 31338, configured: true, available: false, reason: "config_error" });
    expect((await publishBehindRoots()).results[1]).toMatchObject({ chainId: 31338, status: "unavailable" });
    expect(await getQuote(31338)).toMatchObject({ available: false, reason: "pool_unavailable" });
    expect(B.state.calls).toEqual([]);
  });
});

describe("relayer.submit checks the context before any RPC", () => {
  const proof = { pA: [1n, 2n] as [bigint, bigint], pB: [[3n, 4n], [5n, 6n]] as [[bigint, bigint], [bigint, bigint]], pC: [7n, 8n] as [bigint, bigint] };
  const request = (scope: bigint, chainId: number, over: { fee?: bigint; relayer?: Address; deadline?: bigint } = {}) => {
    const value = 10n ** 17n;
    const withdrawal = {
      recipient: "0x00000000000000000000000000000000000000a1" as Address,
      relayer: over.relayer ?? RELAYER,
      fee: over.fee ?? computeFee(value, chainId),
      deadline: over.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 600),
    };
    return { chainId, withdrawal, proof, pubSignals: [11n, 12n, value, 13n, 14n, computeContext(scope, withdrawal)] };
  };

  it("a proof for chain A's pool sent to chain B fails locally: no RPC call on either chain, no gas", async () => {
    await expect(relayWithdrawal(request(SCOPE_A, 31338))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This proof is for a different pool than the one on Local chain B",
    });
    // relayer, fee and deadline rules also run before any RPC
    await expect(relayWithdrawal(request(SCOPE_B, 31338, { relayer: POSTMAN }))).rejects.toMatchObject({ message: "Proof is bound to a different relayer address" });
    await expect(relayWithdrawal(request(SCOPE_B, 31338, { fee: 10n ** 14n }))).rejects.toMatchObject({ message: /^Fee too low on Local chain B: required 1000000000000000 wei/ });
    await expect(relayWithdrawal(request(SCOPE_B, 31338, { deadline: 0n }))).rejects.toMatchObject({ message: "Withdrawal must carry a deadline within the quote window" });
    await expect(caller().relayer.submit(request(SCOPE_A, 31338))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(A.state.calls).toEqual([]);
    expect(B.state.calls).toEqual([]);
  });

  it("a proof for its own chain is checked, simulated and sent on that chain only", async () => {
    const res = await relayWithdrawal(request(SCOPE_B, 31338));
    expect(res.chainId).toBe(31338);
    expect(B.state.sent).toEqual([expect.objectContaining({ functionName: "withdraw", from: RELAYER, hash: res.txHash })]);
    const calls = B.state.calls;
    expect(calls.slice(0, 3).sort()).toEqual(["getChainId", "getCode", "readContract:SCOPE"]); // the contract check first
    expect(calls.indexOf("simulateContract:withdraw")).toBeLessThan(calls.indexOf("writeContract:withdraw"));
    expect(A.state.calls).toEqual([]);
    // through the router, with the chain in the input
    const viaRouter = await caller().relayer.submit(request(SCOPE_A, 31337));
    expect(viaRouter.chainId).toBe(31337);
    expect(A.state.sent).toHaveLength(1);
    expect(await caller().relayer.status({ chainId: 31337, txHash: viaRouter.txHash })).toMatchObject({ status: "success" });
  });

  it("names the network when the send itself fails, without the RPC URL", async () => {
    await syncEvents({ chainId: 31338 }); // the contract check has passed
    B.state.down = true;
    const err = await relayWithdrawal(request(SCOPE_B, 31338)).then(
      () => null,
      (e: unknown) => e as TRPCError,
    );
    expect(err?.message).toMatch(/^(The pool on Local chain B rejected the withdrawal|Relay failed on Local chain B): /);
    expect(err?.message).not.toMatch(/secret/);
    expect(B.state.sent).toEqual([]);
  });
});

describe("the contract check blocks reads and writes", () => {
  it("an RPC that serves another chain: wrong_chain, no write, retried after 60 s", async () => {
    quiet();
    B.state.rpcChainId = 31337;
    const proof = { pA: [1n, 2n], pB: [[3n, 4n], [5n, 6n]], pC: [7n, 8n] } as never;
    const withdrawal = { recipient: DEPOSITOR, relayer: RELAYER, fee: 10n ** 15n, deadline: BigInt(Math.floor(Date.now() / 1000) + 600) };
    await expect(
      relayWithdrawal({ chainId: 31338, withdrawal, proof, pubSignals: [1n, 2n, 10n ** 17n, 3n, 4n, computeContext(SCOPE_B, withdrawal)] }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "The privacy pool on Local chain B (31338) is unavailable right now: its RPC node serves another chain" });
    expect((await listPools("24h")).unavailable).toEqual([{ chainId: 31338, pool: POOL, reason: "wrong_chain" }]);
    expect((await publishBehindRoots()).results[1]).toMatchObject({ chainId: 31338, status: "unavailable" });
    expect((await getNetworks()).networks[1]).toMatchObject({ available: false, reason: "wrong_chain" });
    expect(await getQuote(31338)).toMatchObject({ available: false, reason: "pool_unavailable" });
    expect(B.state.calls.filter((c) => c.startsWith("simulateContract") || c.startsWith("writeContract"))).toEqual([]);
    expect(B.state.calls.filter((c) => c === "getChainId")).toHaveLength(1); // checked once, then remembered
    expect(B.state.sent).toEqual([]);

    // fixed, and a minute later the check runs again and passes
    B.state.rpcChainId = 31338;
    const later = Date.now() + 61_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    resetPoolCaches();
    expect((await listPools("24h")).pools.map((p) => p.chainId)).toEqual([31337, 31338]);
    expect((await getQuote(31338)).available).toBe(true);
  });

  it("no code, or a contract whose SCOPE is not this pool's on this chain: contract_check_failed", async () => {
    quiet();
    B.state.code = undefined;
    expect((await listPools("24h")).unavailable).toEqual([{ chainId: 31338, pool: POOL, reason: "contract_check_failed" }]);
    resetASPCache();
    resetPoolCaches();
    B.state.code = "0x6080";
    B.state.scope = SCOPE_A; // chain A's pool scope served on chain B: not this pool
    expect((await getPoolActivity()).unavailable).toEqual([{ chainId: 31338, pool: POOL, reason: "contract_check_failed" }]);
    expect((await publishBehindRoots()).results[1]).toMatchObject({ status: "unavailable" });
    expect(B.state.calls.filter((c) => !["getChainId", "getCode", "readContract:SCOPE"].includes(c))).toEqual([]);
  });
});

describe("publish (corrected D8)", () => {
  it("publishes every pool that is behind, reports current ones, and never posts a root twice", async () => {
    B.state.currentRoot = rootOf(labelsB); // B already current
    const first = await publishBehindRoots();
    expect(first.results).toEqual([
      { chainId: 31337, pool: POOL, status: "published", root: rootOf(labelsA).toString(), txHash: A.state.sent[0].hash },
      { chainId: 31338, pool: POOL, status: "current", root: rootOf(labelsB).toString() },
    ]);
    // the root's record is its screening recipe: the first 3 deposits, none excluded, as of block 20 and its time
    expect(A.state.sent).toMatchObject([
      { functionName: "updateASPRoot", args: [rootOf(labelsA), `hylsia-asp:v1;n=3;x=;asOf=20;t=${timeA(20n)};delay=0;conf=1`], from: POSTMAN },
    ]);
    expect(B.state.sent).toEqual([]);
    // the root is current now on A: nothing more is sent
    expect((await publishBehindRoots()).results.map((r) => r.status)).toEqual(["current", "current"]);
    expect(A.state.sent).toHaveLength(1);
  });

  it("a receipt that does not arrive in time answers pending; a repeat answers the same txHash and sends nothing", async () => {
    setEnv({ PRIVACY_ASP_RECEIPT_WAIT_MS_31338: "1" });
    B.state.automine = false;
    const first = await publishASPRoot(31338);
    expect(first).toMatchObject({ chainId: 31338, pool: POOL, status: "pending", root: rootOf(labelsB).toString() });
    expect(first.txHash).toBe(B.state.sent[0].hash);
    const again = await publishBehindRoots();
    expect(again.results[1]).toEqual(first);
    expect(B.state.sent).toHaveLength(1);
    // mined: the root is current
    B.mine();
    expect((await publishASPRoot(31338)).status).toBe("current");
    expect(B.state.sent).toHaveLength(1);
  });

  it("a pending post that reverted is cleared and the root is posted anew; a revert seen in time answers unavailable", async () => {
    setEnv({ PRIVACY_ASP_RECEIPT_WAIT_MS_31338: "1" });
    B.state.automine = false;
    const pending = await publishASPRoot(31338);
    expect(pending.status).toBe("pending");
    B.state.nextStatus = "reverted";
    B.mine();
    B.state.automine = true; // the next post is mined at once, and reverts too
    const reverted = await publishASPRoot(31338);
    expect(reverted).toMatchObject({ status: "unavailable", root: rootOf(labelsB).toString() });
    expect(reverted.txHash).toBe(B.state.sent[1].hash);
    B.state.nextStatus = "success";
    const published = await publishASPRoot(31338);
    expect(published).toMatchObject({ status: "published", txHash: B.state.sent[2].hash });
    expect(B.state.sent).toHaveLength(3);
  });

  it("empty, no_key and not_postman; concurrent requests share one attempt", async () => {
    A.state.logs.length = 0;
    expect((await publishASPRoot(31337)).status).toBe("empty");
    B.state.postman = "0x0000000000000000000000000000000000000bad";
    expect((await publishASPRoot(31338)).status).toBe("not_postman");
    setEnv({ PRIVACY_ASP_POSTMAN_PRIVATE_KEY: undefined });
    expect((await publishASPRoot(31338)).status).toBe("no_key");
    expect(B.state.sent).toEqual([]);

    const a = publishASPRoot(31338);
    expect(publishASPRoot(31338)).toBe(a);
    await a;
  });

  it("the router's publish takes no input and answers for every network", async () => {
    const res = await caller().asp.publish();
    expect(res.results.map((r) => [r.chainId, r.status])).toEqual([
      [31337, "published"],
      [31338, "published"],
    ]);
    expect(A.state.sent).toHaveLength(1);
    expect(B.state.sent).toHaveLength(1);
  });
});

describe("network names and the optional chain id", () => {
  it("an unknown chain is BAD_REQUEST 'Hylsia is not built for network <id>'", async () => {
    await expect(getPoolDetail(1, POOL, "7d")).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Hylsia is not built for network 1" });
    await expect(caller().poolDetail({ chainId: 46630, pool: POOL })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Hylsia is not built for network 46630" });
    await expect(caller().relayer.status({ chainId: 1, txHash: `0x${"2".repeat(64)}` })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(getQuote(5)).rejects.toThrow("Hylsia is not built for network 5");
    expect(A.state.calls).toEqual([]);
    expect(B.state.calls).toEqual([]);
  });

  it("an omitted chainId resolves to the only served chain, else asks for one", async () => {
    await expect(getQuote()).rejects.toThrow("chainId is required: this server serves 2 networks");
    expect(() => requirePool()).toThrow("chainId is required: this server serves 2 networks");
    await expect(publishASPRoot()).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // legacy single mode: today's env (PRIVACY_CHAIN_ID + unsuffixed values)
    for (const k of ENV) delete process.env[k];
    setEnv({ PRIVACY_CHAIN_ID: "31338", PRIVACY_POOL_ADDRESS: POOL, PRIVACY_ASP_CONFIRMATIONS: "3", PRIVACY_RELAYER_FEE_BPS: "70" });
    expect(privacyConfig().mode).toBe("legacy");
    expect(requirePool()).toBe(POOL);
    expect(await getQuote()).toMatchObject({ chainId: 31338, feeBps: 70, reason: "no_relayer_key" });
    expect(chainConfig().aspConfirmations).toBe(3);
    const status = (await getASPStatuses()).pools[0];
    expect(status).toMatchObject({ chainId: 31338, confirmations: 3, memberCount: 2 });
    expect(A.state.calls).toEqual([]);
  });
});

describe("event sync per chain", () => {
  it("a head below the cache inside the reorg window keeps it (no duplicate events); the window is replaced, not merged", async () => {
    setEnv({ PRIVACY_REORG_WINDOW_31337: "3" });
    const first = await syncEvents({ chainId: 31337 });
    expect(first.lastBlock).toBe(20n);
    expect(first.events.filter((e) => e.kind === "deposit")).toHaveLength(3);

    // a lagging RPC answers an older head inside the window (17..20): the cache is kept as it is, with no new scan
    A.state.head = 17n;
    const logsBefore = A.state.calls.filter((c) => c === "getLogs").length;
    const lagging = await syncEvents({ chainId: 31337, force: true });
    expect(lagging.lastBlock).toBe(20n);
    expect(lagging.events).toEqual(first.events);
    expect(A.state.calls.filter((c) => c === "getLogs").length).toBe(logsBefore);

    // a reorg re-includes a deposit at another block and log index, inside the window (18..21)
    A.state.head = 21n;
    deposit(A, SCOPE_A, [19n], 10n ** 17n);
    await syncEvents({ chainId: 31337, force: true });
    const moved = A.state.logs.pop()!;
    A.state.logs.push({ ...moved, blockNumber: 21n, logIndex: 0 });
    A.state.head = 22n;
    const after = await syncEvents({ chainId: 31337, force: true });
    const late = after.events.filter((e) => e.kind === "deposit" && e.leafIndex === 3);
    expect(late).toHaveLength(1);
    expect(late[0].blockNumber).toBe(21n);
    expect(after.lastBlock).toBe(22n);
    // chain B's cache is its own
    expect((await syncEvents({ chainId: 31338 })).events.filter((e) => e.kind === "deposit")).toHaveLength(2);
  });

  it("a head that falls beyond the reorg window drops the cache and scans again from the deploy block", async () => {
    const warn = quiet();
    setEnv({ PRIVACY_REORG_WINDOW_31337: "3" });
    await syncEvents({ chainId: 31337 });
    // the RPC now serves another history of this pool (a regenesis, a revert): only the first deposit is in it
    A.state.logs = A.state.logs.filter((l) => l.blockNumber <= 10n);
    A.state.head = 12n; // 12 + 3 < 20: further than the window
    A.state.logRanges.length = 0;
    const after = await syncEvents({ chainId: 31337, force: true });
    expect(after.lastBlock).toBe(12n);
    expect(after.events.filter((e) => e.kind === "deposit")).toHaveLength(1);
    expect(A.state.logRanges).toEqual([[0n, 12n]]); // from the deploy block (0 on a local chain without a record)
    expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).toContain(
      "Local chain A (31337): the RPC's head 12 is below block 20, which the pool was scanned to; its cached state is dropped and it is scanned again from its deploy block",
    );
  });

  it("a local chain that restarts (no reorg window): the old chain's events and pending publish are dropped", async () => {
    quiet();
    setEnv({ PRIVACY_ASP_RECEIPT_WAIT_MS_31338: "1" });
    B.state.automine = false;
    const first = (await publishBehindRoots()).results[1];
    expect(first).toMatchObject({ chainId: 31338, status: "pending" });
    // anvil B restarts: a fresh chain, the pool deployed again at the same address, one deposit
    B.reset();
    Object.assign(B.state, { head: 3n, scope: SCOPE_B, postman: POSTMAN, txCount: 100 }); // its own transaction hashes
    deposit(B, SCOPE_B, [2n], 10n ** 18n);
    // the old answer (kept events, the old chain's txHash as "pending") is gone: the new chain's root is posted
    const second = (await publishBehindRoots()).results[1];
    expect(second).toMatchObject({ chainId: 31338, status: "published" });
    expect(second.txHash).not.toBe(first.txHash);
    expect(B.state.sent).toHaveLength(1);
    const listed = (await listPools("24h")).pools.find((p) => p.chainId === 31338)!;
    expect([listed.deposits, listed.leafCount]).toEqual([1, 1]); // was 2 (old chain) against 1 on-chain
  });

  it("a cold scan cut off half way keeps its progress: the next scan resumes there, and progress is never served", async () => {
    setEnv({ PRIVACY_LOG_CHUNK_31337: "5" }); // 0..4, 5..9, 10..14, 15..19, 20..20
    A.state.logsFailAbove = 12n;
    await expect(syncEvents({ chainId: 31337 })).rejects.toThrow("HTTP request failed");
    A.state.logsFailAbove = null;
    A.state.logRanges.length = 0;
    const done = await syncEvents({ chainId: 31337 });
    expect(A.state.logRanges[0]).toEqual([10n, 14n]); // resumed after the last block scanned (9)
    expect(done.lastBlock).toBe(20n);
    expect(done.events.filter((e) => e.kind === "deposit").map((e) => e.blockNumber)).toEqual([10n, 11n, 12n]);
  });

  it("a forced sync (the publisher's) never joins a scan that may have read an older head", async () => {
    const heads = () => A.state.calls.filter((c) => c === "getBlockNumber").length;
    await Promise.all([syncEvents({ chainId: 31337 }), syncEvents({ chainId: 31337, force: true })]);
    expect(heads()).toBe(2);
    resetASPCache();
    A.state.calls.length = 0;
    await Promise.all([syncEvents({ chainId: 31337, force: true }), syncEvents({ chainId: 31337, force: true }), syncEvents({ chainId: 31337 })]);
    expect(heads()).toBe(1);
  });

  it("the load memo shares one chain read per pool for 5 s; the networks answer is cached for 10 s", async () => {
    const heads = () => A.state.calls.filter((c) => c === "getBlock").length;
    await listPools("24h");
    const once = heads();
    await getPoolActivity();
    await listPools("7d");
    expect(heads()).toBe(once);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 6_000);
    await listPools("24h");
    expect(heads()).toBeGreaterThan(once);

    vi.restoreAllMocks();
    const reads = () => B.state.calls.filter((c) => c === "readContract:getLastRoot").length;
    await getNetworks();
    await getNetworks();
    expect(reads()).toBe(1);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11_000);
    await getNetworks();
    expect(reads()).toBe(2);
  });
});

describe("router surface", () => {
  it("has the multi-network procedures, no server event mirror and no per-label proof", () => {
    const procedures = Object.keys(privacyRouter._def.procedures).sort();
    expect(procedures).toEqual(
      ["asp.publish", "asp.set", "asp.status", "networks", "poolActivity", "poolDetail", "pools", "relayer.quote", "relayer.status", "relayer.submit"].sort(),
    );
  });

  it("answers networks, pools, poolActivity, asp.status, asp.set and relayer.quote with one entry per chain", async () => {
    const c = caller();
    expect((await c.networks()).networks.map((n) => n.chainId)).toEqual([31337, 31338]);
    expect((await c.pools()).pools.map((p) => p.chainId)).toEqual([31337, 31338]);
    expect((await c.pools({ interval: "7d" })).pools.map((p) => p.interval)).toEqual(["7d", "7d"]);
    expect((await c.poolActivity()).pools.map((p) => p.chainId)).toEqual([31337, 31338]);
    expect((await c.asp.status()).pools.map((p) => p.chainId)).toEqual([31337, 31338]);
    expect((await c.asp.set()).sets.map((p) => p.chainId)).toEqual([31337, 31338]);
    expect((await c.relayer.quote()).quotes.map((p) => p.chainId)).toEqual([31337, 31338]);
    expect((await c.poolDetail({ chainId: 31338, pool: POOL })).pool.chainId).toBe(31338);
  });
});

describe("boot summary", () => {
  it("one line per network: sources, RPC host only, derived addresses, never a key or a URL path", () => {
    setEnv({
      PRIVACY_RPC_URL_31337: "http://127.0.0.1:8545/v3/path-secret?apikey=zzz-secret",
      PRIVACY_POOL_ADDRESS_31338: "0xnot-an-address",
      PRIVACY_POOL_ADDRESS: POOL, // ignored in multi mode, with a warning
      PRIVACY_ASP_CONFIRMATIONS: "5", // a network's own setting: ignored in multi mode, with a warning
    });
    expect(chainConfig(31337).aspConfirmations).toBe(1);
    const lines: string[] = [];
    logPrivacyConfigSummary((l) => lines.push(l));
    const text = lines.join("\n");
    expect(lines[0]).toBe("[privacy] serving Local chain A, Local chain B (testnet ETH only, not audited)");
    expect(text).toContain("[privacy] Local chain A (31337): pool 0x2222222222222222222222222222222222222222 (env)");
    expect(text).toContain("RPC env 127.0.0.1:8545");
    expect(text).toContain(`relayer ${RELAYER}`);
    expect(text).toContain(`postman ${POSTMAN}`);
    expect(text).toContain("problems: invalid_address");
    expect(text).toContain("PRIVACY_POOL_ADDRESS has no network suffix and is ignored");
    expect(text).toContain("[privacy] warning: PRIVACY_ASP_CONFIRMATIONS has no network suffix and is ignored; set PRIVACY_ASP_CONFIRMATIONS_31337 or PRIVACY_ASP_CONFIRMATIONS_31338");
    expect(text).not.toMatch(/secret|zzz/);
    expect(text).not.toContain(RELAYER_KEY.slice(2));
    expect(text).not.toContain(POSTMAN_KEY.slice(2));
  });

  it("names the served networks, never a mode, except the old single-variable configuration", () => {
    const first = () => {
      const lines: string[] = [];
      logPrivacyConfigSummary((l) => lines.push(l));
      return lines[0];
    };
    setEnv({ PRIVACY_CHAIN_IDS: "31338" });
    expect(first()).toBe("[privacy] serving Local chain B (testnet ETH only, not audited)");
    setEnv({ PRIVACY_CHAIN_IDS: undefined, PRIVACY_CHAIN_ID: "31337" });
    expect(first()).toBe("[privacy] legacy mode (PRIVACY_CHAIN_ID): serving Local chain A (testnet ETH only, not audited)");
  });

  it("is non-fatal on a configuration error", () => {
    setEnv({ PRIVACY_CHAIN_IDS: "31337,999" });
    const lines: string[] = [];
    expect(() => logPrivacyConfigSummary((l) => lines.push(l))).not.toThrow();
    expect(lines).toEqual(["[privacy] configuration error: PRIVACY_CHAIN_IDS: Hylsia is not built for network 999 (supported: 46630, 4663, 1, 31337, 31338)"]);
  });
});

describe("screening settings (Phase 4)", () => {
  it("the inclusion delay is per network: the registry's default, PRIVACY_ASP_INCLUSION_DELAY_SECONDS_<id>, 0 to 604800", () => {
    expect(chainConfig(31337).aspInclusionDelaySeconds).toBe(0); // local chains: at once
    expect(loadPrivacyConfig((n) => ({ PRIVACY_CHAIN_IDS: "46630" })[n]).chains[0].aspInclusionDelaySeconds).toBe(3600); // Robinhood Chain Testnet
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "3600", PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31338: "0" });
    expect([chainConfig(31337).aspInclusionDelaySeconds, chainConfig(31338).aspInclusionDelaySeconds]).toEqual([3600, 0]);
    for (const bad of ["-1", "604801", "1.5", "an hour"]) {
      setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: bad });
      expect(chainConfig(31337).aspInclusionDelaySeconds).toBe(0);
      expect(chainConfig(31337).warnings).toContain("PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337 is not a whole number from 0 to 604800; the default 0 is used");
    }
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "604800" });
    expect(chainConfig(31337).aspInclusionDelaySeconds).toBe(604_800);
    // the unsuffixed name counts only in legacy mode; in multi mode it is ignored with a warning
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: undefined, PRIVACY_ASP_INCLUSION_DELAY_SECONDS: "120" });
    expect(chainConfig(31337).aspInclusionDelaySeconds).toBe(0);
    expect(privacyConfig().warnings).toContain(
      "PRIVACY_ASP_INCLUSION_DELAY_SECONDS has no network suffix and is ignored; set PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337 or PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31338",
    );
    for (const k of ENV) delete process.env[k];
    setEnv({ PRIVACY_CHAIN_ID: "31338", PRIVACY_POOL_ADDRESS: POOL, PRIVACY_ASP_INCLUSION_DELAY_SECONDS: "120" });
    expect(chainConfig().aspInclusionDelaySeconds).toBe(120);
  });

  it("the exclusion list: none, a file (a relative path from the repository root, not the working directory), inline JSON, or both (an error)", () => {
    expect(privacyConfig().aspExclusions).toEqual({ kind: "none" });
    setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: "config/asp-exclusions.json" });
    expect(privacyConfig().aspExclusions).toEqual({ kind: "file", path: path.join(repoRoot(), "config", "asp-exclusions.json"), display: "config/asp-exclusions.json" });
    expect(fs.existsSync(path.join(repoRoot(), "package.json"))).toBe(true);
    const cwd = process.cwd();
    try {
      process.chdir(os.tmpdir()); // started from another folder: the same file
      resetPrivacyConfig();
      expect(privacyConfig().aspExclusions).toMatchObject({ path: path.join(repoRoot(), "config", "asp-exclusions.json") });
    } finally {
      process.chdir(cwd);
    }
    setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: "/srv/hylsia/exclusions.json" });
    expect(privacyConfig().aspExclusions).toEqual({ kind: "file", path: "/srv/hylsia/exclusions.json", display: "/srv/hylsia/exclusions.json" });
    setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: undefined, PRIVACY_ASP_EXCLUSIONS_JSON: ' { "format": "hylsia-asp-exclusions", "version": 1, "entries": [] } ' });
    expect(privacyConfig().aspExclusions).toMatchObject({ kind: "inline" });
    setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: "config/asp-exclusions.json" });
    expect(privacyConfig().aspExclusions).toEqual({ kind: "error", error: "both PRIVACY_ASP_EXCLUSIONS_FILE and PRIVACY_ASP_EXCLUSIONS_JSON are set; set only one" });
  });

  it("the boot summary prints each network's delay and the list's state: where it is, how many entries, or why it is invalid (never a value or a note)", () => {
    const summary = () => {
      const lines: string[] = [];
      logPrivacyConfigSummary((l) => lines.push(l));
      return lines;
    };
    setEnv({ PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "5400" });
    let lines = summary();
    expect(lines.find((l) => l.startsWith("[privacy] Local chain A (31337):"))).toContain("confirmations 1; inclusion delay 5400 s (1 hour 30 minutes)");
    expect(lines.find((l) => l.startsWith("[privacy] Local chain B (31338):"))).toContain("inclusion delay 0 s (right away)");
    expect(lines.at(-1)).toBe("[privacy] exclusion list: none configured (PRIVACY_ASP_EXCLUSIONS_FILE is unset): no deposit is excluded");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hylsia-summary-"));
    try {
      const file = path.join(dir, "list.json");
      const note = "SENTINEL-boot-summary-note";
      fs.writeFileSync(file, JSON.stringify({ format: "hylsia-asp-exclusions", version: 1, entries: [{ depositor: DEPOSITOR, reason: "test", note }, { depositor: DEPOSITOR, reason: "fraud" }] }));
      setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: file });
      lines = summary();
      expect(lines.at(-1)).toBe(`[privacy] exclusion list (${file}): 2 entries; entry #2 repeats entry #1; the first one's reason counts`);
      fs.writeFileSync(file, JSON.stringify({ format: "hylsia-asp-exclusions", version: 1, entries: [{ depositor: DEPOSITOR, reason: "unknown", note }] }));
      setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: file });
      lines = summary();
      expect(lines.at(-1)).toBe(
        `[privacy] exclusion list (${file}) is invalid: entry #1: field "reason" must be one of sanctions, stolen-funds, fraud, legal-order, test. Publishing association-set roots is paused on every network until it is fixed.`,
      );
      // a relative path: the summary also says where it resolves
      setEnv({ PRIVACY_ASP_EXCLUSIONS_FILE: "config/no-such-list.json" });
      lines = summary();
      expect(lines).toContain(`[privacy] PRIVACY_ASP_EXCLUSIONS_FILE resolves to ${path.join(repoRoot(), "config", "no-such-list.json")}`);
      expect(lines.at(-1)).toContain("exclusion list (config/no-such-list.json) is invalid: the file does not exist.");
      const text = lines.join("\n");
      expect(text).not.toContain(note);
      expect(text.toLowerCase()).not.toContain(DEPOSITOR.slice(2).toLowerCase());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("funding: the relayer and the publisher say when they cannot pay", () => {
  /** at the fake's 1 gwei */
  const ONE_WITHDRAWAL = 1_000_000_000n * WITHDRAW_GAS * GAS_PRICE_MARGIN;
  const ONE_PUBLISH = 1_000_000_000n * PUBLISH_GAS * GAS_PRICE_MARGIN;
  const fund = (chain: typeof A, address: string, wei: bigint) => chain.state.keyBalances.set(address.toLowerCase(), wei);
  const proof = { pA: [1n, 2n] as [bigint, bigint], pB: [[3n, 4n], [5n, 6n]] as [[bigint, bigint], [bigint, bigint]], pC: [7n, 8n] as [bigint, bigint] };
  const submitOnA = () => {
    const value = 10n ** 17n;
    const withdrawal = {
      recipient: "0x00000000000000000000000000000000000000a1" as Address,
      relayer: RELAYER,
      fee: computeFee(value, 31337),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
    };
    return { chainId: 31337, withdrawal, proof, pubSignals: [11n, 12n, value, 13n, 14n, computeContext(SCOPE_A, withdrawal)] };
  };
  const UNFUNDED_RELAYER = "The relayer for Local chain A has too little testnet ETH to send a withdrawal right now. Nothing was sent.";

  it("one withdrawal and one publish cost the network's gas price times a fixed gas figure, twice over", async () => {
    expect(ONE_WITHDRAWAL).toBe(2_400_000_000_000_000n); // 0.0024 ETH at 1 gwei
    expect(ONE_PUBLISH).toBe(200_000_000_000_000n); // 0.0002 ETH
    // at Robinhood Chain Testnet's 0.01 gwei: about 0.000024 ETH per withdrawal and 0.000002 ETH per publish
    expect(oneTransactionCost(10_000_000n, WITHDRAW_GAS)).toBe(24_000_000_000_000n);
    expect(oneTransactionCost(10_000_000n, PUBLISH_GAS)).toBe(2_000_000_000_000n);
    expect(await readFunding(31337)).toMatchObject({
      chainId: 31337,
      gasPrice: 1_000_000_000n,
      relayer: { address: RELAYER, required: ONE_WITHDRAWAL, funded: true },
      postman: { address: POSTMAN, required: ONE_PUBLISH, funded: true },
    });
  });

  it("a relayer below one withdrawal: the quote, privacy.pools and privacy.networks say so, and a relay is refused before anything is sent", async () => {
    fund(A, RELAYER, ONE_WITHDRAWAL - 1n);
    expect(await getQuote(31337)).toMatchObject({ chainId: 31337, pool: POOL, available: false, reason: "relayer_unfunded", relayer: RELAYER, feeBps: 100, minFeeWei: "0" });
    expect(await getQuote(31338)).toMatchObject({ available: true, reason: null }); // B's relayer balance is its own
    const [a, b] = (await listPools("24h")).pools;
    expect(a).toMatchObject({ relayerAvailable: false, relayerBlock: "relayer_unfunded", aspCanPublish: true, aspPublishBlock: null });
    expect(b).toMatchObject({ relayerAvailable: true, relayerBlock: null });
    expect((await getNetworks()).networks[0]).toMatchObject({ relayerAvailable: false, relayerBlock: "relayer_unfunded", aspCanPublish: true });

    await expect(caller().relayer.submit(submitOnA())).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: UNFUNDED_RELAYER });
    expect(A.state.calls.filter((c) => c.startsWith("simulateContract") || c.startsWith("writeContract"))).toEqual([]);
    expect(A.state.sent).toEqual([]);

    // exactly one withdrawal's worth: the relay reads the balance afresh and sends; the quote follows that read
    fund(A, RELAYER, ONE_WITHDRAWAL);
    expect((await relayWithdrawal(submitOnA())).chainId).toBe(31337);
    expect(A.state.sent).toEqual([expect.objectContaining({ functionName: "withdraw", from: RELAYER })]);
    expect(await getQuote(31337)).toMatchObject({ available: true, reason: null });
  });

  it("a node that refuses the send for the relayer's balance: the same clear error, nothing sent", async () => {
    A.state.refuseSendForFunds = true;
    await expect(relayWithdrawal(submitOnA())).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: UNFUNDED_RELAYER });
    expect(A.state.sent).toEqual([]);
  });

  it("a publisher below one publish: aspCanPublish false with publisher_unfunded everywhere; the publish answers unfunded and sends nothing", async () => {
    fund(B, POSTMAN, ONE_PUBLISH - 1n);
    expect((await getASPStatuses()).pools.map((p) => [p.chainId, p.canPublish, p.publishBlock])).toEqual([
      [31337, true, null],
      [31338, false, "publisher_unfunded"],
    ]);
    expect((await getNetworks()).networks[1]).toMatchObject({ aspCanPublish: false, aspPublishBlock: "publisher_unfunded", relayerAvailable: true });
    expect((await listPools("24h")).pools[1]).toMatchObject({ aspCanPublish: false, aspPublishBlock: "publisher_unfunded" });
    const { results } = await caller().asp.publish();
    expect(results).toEqual([
      expect.objectContaining({ chainId: 31337, status: "published" }),
      { chainId: 31338, pool: POOL, status: "unfunded", root: rootOf(labelsB).toString() },
    ]);
    expect(B.state.sent).toEqual([]);
    expect(B.state.calls.filter((c) => c.startsWith("simulateContract") || c.startsWith("writeContract"))).toEqual([]);
    // a send the node refuses for the balance answers the same
    fund(B, POSTMAN, ONE_PUBLISH);
    B.state.refuseSendForFunds = true;
    expect(await publishASPRoot(31338)).toEqual({ chainId: 31338, pool: POOL, status: "unfunded", root: rootOf(labelsB).toString() });
    // funded: the next publish posts
    expect(await publishASPRoot(31338)).toMatchObject({ status: "published" });
    expect(B.state.sent).toHaveLength(1);
  });

  it("not the pool's postman, or no key at all: the reason says which", async () => {
    B.state.postman = "0x0000000000000000000000000000000000000bad";
    expect((await getASPStatuses()).pools[1]).toMatchObject({ canPublish: false, publishBlock: "not_postman" });
    setEnv({ PRIVACY_ASP_POSTMAN_PRIVATE_KEY: undefined, PRIVACY_RELAYER_PRIVATE_KEY: undefined });
    A.state.calls.length = 0;
    expect((await getNetworks()).networks[0]).toMatchObject({ aspCanPublish: false, aspPublishBlock: "no_key", relayerAvailable: false, relayerBlock: "no_relayer_key" });
    expect(await getQuote(31337)).toMatchObject({ available: false, reason: "no_relayer_key" });
    expect(A.state.calls.filter((c) => c === "getGasPrice")).toEqual([]); // no key, nothing to read
  });

  it("one read per network every 30 s, shared by every caller; an unreadable balance is unknown, never unfunded", async () => {
    const reads = () => A.state.calls.filter((c) => c === "getGasPrice").length;
    await Promise.all([getQuotes(), getQuotes(), listPools("24h"), getNetworks(), getASPStatuses()]);
    expect(reads()).toBe(1);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    await getQuotes();
    expect(reads()).toBe(2);
    vi.restoreAllMocks();

    // a failed read without a good one before: unknown, so every answer looks as it did before balances were read
    const warn = quiet();
    resetFundingCache();
    A.state.gasPriceFails = true;
    expect(await readFunding(31337)).toBeNull();
    expect(await getQuote(31337)).toMatchObject({ available: true, reason: null });
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("[privacy] Local chain A (31337): could not read the relayer's and publisher's balances");
    // a good read (unfunded), then a failed one: the good one still answers (a short RPC hiccup flips nothing)
    A.state.gasPriceFails = false;
    fund(A, RELAYER, 0n);
    expect((await getQuote(31337)).reason).toBe("relayer_unfunded");
    A.state.gasPriceFails = true;
    expect((await readFunding(31337, { fresh: true }))?.relayer?.funded).toBe(false);
  });

  it("a postman with a transaction in flight posts nothing more (sent before a restart, or not mined after 10 minutes)", async () => {
    // a post this process does not know of (sent before a restart), still in the node's pool
    B.state.automine = false;
    const hash = `0x${"ab".repeat(32)}` as Hex;
    const request = { functionName: "updateASPRoot", args: [rootOf(labelsB), "earlier"], account: { address: POSTMAN }, simulatedOn: 31338 };
    B.state.sent.push({ functionName: "updateASPRoot", args: request.args, from: POSTMAN, hash });
    B.state.unmined.push({ hash, request });
    expect(await publishASPRoot(31338)).toEqual({ chainId: 31338, pool: POOL, status: "pending", root: rootOf(labelsB).toString() });
    expect(B.state.sent).toHaveLength(1); // the earlier one only
    B.mine();
    expect((await publishASPRoot(31338)).status).toBe("current");

    // a post of this process, not mined after 10 minutes and still in flight: pending with its transaction
    deposit(B, SCOPE_B, [31n], 10n ** 18n);
    B.state.head = 40n;
    setEnv({ PRIVACY_ASP_RECEIPT_WAIT_MS_31338: "1" });
    const first = await publishASPRoot(31338);
    expect(first).toMatchObject({ status: "pending", txHash: B.state.sent[1].hash });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
    expect(await publishASPRoot(31338)).toEqual(first);
    expect(B.state.sent).toHaveLength(2);
  });

  it("a post of an older root still in flight from this process does not hold back the newer root", async () => {
    setEnv({ PRIVACY_ASP_RECEIPT_WAIT_MS_31338: "1" });
    B.state.automine = false;
    const older = await publishASPRoot(31338);
    expect(older).toMatchObject({ status: "pending", root: rootOf(labelsB).toString() });
    const newer = [...labelsB, ...deposit(B, SCOPE_B, [31n], 10n ** 18n)];
    B.state.head = 40n;
    const next = await publishASPRoot(31338);
    expect(next).toMatchObject({ status: "pending", root: rootOf(newer).toString(), txHash: B.state.sent[1].hash });
    expect(B.state.sent.map((t) => t.args[0])).toEqual([rootOf(labelsB), rootOf(newer)]); // two roots, each once
  });
});

describe("the periodic publisher", () => {
  it("one tick posts a root that is behind once, then nothing; an empty pool posts nothing", async () => {
    const t1 = await autoPublishTick(31337);
    expect(t1).toEqual({ outcome: "posted", detail: "published", txHash: A.state.sent[0].hash });
    expect(await autoPublishTick(31337)).toEqual({ outcome: "idle", detail: "current" });
    expect(A.state.sent).toHaveLength(1);
    B.state.logs.length = 0; // no deposit on B
    expect(await autoPublishTick(31338)).toEqual({ outcome: "idle", detail: "empty" });
    expect(B.state.sent).toEqual([]);
  });

  it("pauses while the publisher cannot pay, before any event scan, and goes on once it is funded", async () => {
    A.state.keyBalances.set(POSTMAN.toLowerCase(), 0n);
    const paused = await autoPublishTick(31337);
    expect(paused.outcome).toBe("unfunded");
    expect(paused.detail).toBe(`the publisher ${POSTMAN} holds 0 ETH on Local chain A; one publish needs about 0.0002 ETH. It resumes once the key is funded`);
    expect(A.state.calls.filter((c) => c === "getLogs" || c.startsWith("simulateContract") || c.startsWith("writeContract"))).toEqual([]);
    A.state.keyBalances.delete(POSTMAN.toLowerCase());
    expect((await autoPublishTick(31337)).outcome).toBe("posted");
    expect(A.state.sent).toHaveLength(1);
  });

  it("reports a post only for the tick that sent it: a post still in flight, or one sent before a restart, is waiting", async () => {
    setEnv({ PRIVACY_ASP_RECEIPT_WAIT_MS_31338: "1" });
    B.state.automine = false;
    const t1 = await autoPublishTick(31338);
    expect(t1).toEqual({ outcome: "posted", detail: "pending", txHash: B.state.sent[0].hash });
    // the next tick, still not mined: the same post answers for the root, and nothing new is sent
    expect(await autoPublishTick(31338)).toEqual({
      outcome: "waiting",
      detail: `its post in transaction ${B.state.sent[0].hash} is not mined yet; nothing new was sent`,
    });
    // a restart (this process forgets its post): the postman's transaction in flight still holds the next post back
    resetASPCache();
    expect(await autoPublishTick(31338)).toEqual({ outcome: "waiting", detail: "the publisher has a transaction in flight; nothing new was sent" });
    expect(B.state.sent).toHaveLength(1);
    // mined: the root is current, and nothing is sent
    B.mine();
    expect(await autoPublishTick(31338)).toEqual({ outcome: "idle", detail: "current" });
    expect(B.state.sent).toHaveLength(1);
  });

  it("logs one line per new post and one per change of state while a post is in flight", async () => {
    const warn = quiet();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    setEnv({ PRIVACY_ASP_RECEIPT_WAIT_MS_31338: "1", PRIVACY_ASP_POSTMAN_PRIVATE_KEY: undefined, PRIVACY_ASP_POSTMAN_PRIVATE_KEY_31338: POSTMAN_KEY });
    B.state.automine = false;
    const lines: string[] = [];
    const ap = startAutoPublisher({ log: (l) => lines.push(l), env: {} })!;
    try {
      expect(ap.chainIds).toEqual([31338]);
      await vi.advanceTimersByTimeAsync(60_000 + 3 * 600_000); // four ticks: one post, then three while it is in flight
      expect(B.state.sent).toHaveLength(1);
      const auto = lines.filter((l) => l.startsWith("[privacy] Local chain B (31338): auto-publish"));
      expect(auto).toEqual([
        `[privacy] Local chain B (31338): auto-publish posted the association-set root (pending, transaction ${B.state.sent[0].hash})`,
        `[privacy] Local chain B (31338): auto-publish waiting: its post in transaction ${B.state.sent[0].hash} is not mined yet; nothing new was sent`,
      ]);
      B.mine();
      await vi.advanceTimersByTimeAsync(600_000); // current now: nothing sent, nothing logged
      expect(B.state.sent).toHaveLength(1);
      expect(lines.filter((l) => l.startsWith("[privacy] Local chain B (31338): auto-publish"))).toHaveLength(2);
    } finally {
      ap.stop();
      vi.useRealTimers();
      warn.mockRestore();
    }
  });

  it("does nothing without a postman key or a pool, with zero RPC calls", async () => {
    setEnv({ PRIVACY_ASP_POSTMAN_PRIVATE_KEY: undefined, PRIVACY_POOL_ADDRESS_31338: undefined });
    expect(await autoPublishTick(31337)).toMatchObject({ outcome: "no_key" });
    expect(await autoPublishTick(31338)).toMatchObject({ outcome: "no_pool" });
    expect([...A.state.calls, ...B.state.calls]).toEqual([]);
  });

  it("reads its interval from PRIVACY_ASP_AUTO_PUBLISH_SECONDS: 600 by default, 0 is off, anything else out of range is warned about", () => {
    expect(DEFAULT_AUTO_PUBLISH_SECONDS).toBe(600);
    expect(privacyConfig().autoPublishSeconds).toBe(600);
    setEnv({ PRIVACY_ASP_AUTO_PUBLISH_SECONDS: "0" });
    expect(privacyConfig().autoPublishSeconds).toBe(0);
    setEnv({ PRIVACY_ASP_AUTO_PUBLISH_SECONDS: " 120 " });
    expect(privacyConfig().autoPublishSeconds).toBe(120);
    for (const bad of ["5", "-1", "1e3", "ten", "86401"]) {
      setEnv({ PRIVACY_ASP_AUTO_PUBLISH_SECONDS: bad });
      expect(privacyConfig().autoPublishSeconds).toBe(600);
      expect(privacyConfig().warnings).toContain(
        "PRIVACY_ASP_AUTO_PUBLISH_SECONDS is neither 0 (off) nor a whole number from 10 to 86400; the default 600 is used",
      );
    }
  });

  it("starts only where it can keep time: off at 0, off on Vercel, else one schedule per pool with a postman key", () => {
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    setEnv({ PRIVACY_ASP_AUTO_PUBLISH_SECONDS: "0" });
    expect(startAutoPublisher({ log, env: {} })).toBeNull();
    setEnv({ PRIVACY_ASP_AUTO_PUBLISH_SECONDS: undefined });
    expect(startAutoPublisher({ log, env: { VERCEL: "1" } })).toBeNull();
    setEnv({ PRIVACY_ASP_POSTMAN_PRIVATE_KEY: undefined, PRIVACY_ASP_POSTMAN_PRIVATE_KEY_31337: POSTMAN_KEY });
    const ap = startAutoPublisher({ log, env: {} });
    ap?.stop();
    expect(ap).toMatchObject({ chainIds: [31337], intervalSeconds: 600 });
    expect(lines).toEqual([
      "[privacy] association-set auto-publish: off (PRIVACY_ASP_AUTO_PUBLISH_SECONDS=0)",
      "[privacy] association-set auto-publish: off on Vercel (serverless); run npm run zk:asp:publish from a scheduler instead",
      "[privacy] Local chain B (31338): association-set auto-publish skipped: no postman key",
      "[privacy] association-set auto-publish: every 600 s on Local chain A (31337) (a root only when one is due, never while the publisher cannot pay)",
    ]);
    expect(lines.join("\n")).not.toContain(POSTMAN_KEY.slice(2));
    expect([...A.state.calls, ...B.state.calls]).toEqual([]); // starting reads nothing
  });

  it("ticks on its clock only, backs off on errors (twice as long each time), and logs quietly", async () => {
    const warn = quiet();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const lines: string[] = [];
    const ap = startAutoPublisher({ log: (l) => lines.push(l), env: {} })!;
    try {
      expect(ap.chainIds).toEqual([31337, 31338]);
      const posts = () => [A.state.sent.length, B.state.sent.length];
      await vi.advanceTimersByTimeAsync(59_000);
      expect(posts()).toEqual([0, 0]); // the first tick comes after a minute
      await vi.advanceTimersByTimeAsync(1_000); // 60 s
      expect(posts()).toEqual([1, 1]);
      await vi.advanceTimersByTimeAsync(600_000); // 660 s
      expect(posts()).toEqual([1, 1]); // current: nothing more

      // chain A goes down: the tick fails, the next waits twice as long, and the failure is logged once
      A.state.down = true;
      await vi.advanceTimersByTimeAsync(600_000); // 1260 s: fails, next at 2460 s
      const calls = A.state.calls.length;
      await vi.advanceTimersByTimeAsync(600_000); // 1860 s: no tick on A
      expect(A.state.calls.length).toBe(calls);
      await vi.advanceTimersByTimeAsync(600_000); // 2460 s: fails again, next at 4860 s
      expect(A.state.calls.length).toBeGreaterThan(calls);
      const failures = lines.filter((l) => l.startsWith("[privacy] Local chain A (31337): auto-publish failed ("));
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain("127.0.0.1:1");
      expect(lines.join("\n")).not.toMatch(/secret|apikey/);
      A.state.down = false;
      await vi.advanceTimersByTimeAsync(2_400_000); // 4860 s: works again
      expect(lines.at(-1)).toBe("[privacy] Local chain A (31337): auto-publish running again");

      // a new deposit on B (above every block scanned so far): its next tick posts it, once
      deposit(B, SCOPE_B, [41n], 10n ** 18n);
      B.state.head = 45n;
      await vi.advanceTimersByTimeAsync(600_000);
      expect(posts()).toEqual([1, 2]);
      expect(lines.filter((l) => l.includes("auto-publish posted the association-set root"))).toHaveLength(3);
      ap.stop();
      await vi.advanceTimersByTimeAsync(3_600_000);
      expect(posts()).toEqual([1, 2]);
    } finally {
      ap.stop();
      vi.useRealTimers();
      warn.mockRestore();
    }
  });
});

describe("receipt status after transport failure", () => {
  it("does not describe an unreachable RPC as a pending transaction", async () => {
    B.state.down = true;
    await expect(
      caller().relayer.status({
        chainId: 31338,
        txHash: `0x${"ab".repeat(32)}`,
      })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "Receipt status is unavailable on Local chain B; check the RPC before retrying.",
    });
    expect(B.state.sent).toEqual([]);
  });
});
