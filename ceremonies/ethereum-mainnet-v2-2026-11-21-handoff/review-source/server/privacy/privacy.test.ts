/**
 * Unit tests for the shared Privacy Pool primitives (pure, no chain).
 * Contract-level behaviour with real proofs lives in contracts/test (forge),
 * the full flow in scripts/privacy/e2e.ts.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { keccak256, toBytes, type Hex } from "viem";
import { anvilKey } from "../../scripts/privacy/anvilKeys";
import { SNARK_SCALAR_FIELD, TREE_DEPTH, ZERO_VALUE } from "../../shared/privacy/constants";
import { computeContext, computeScope } from "../../shared/privacy/context";
import { buildStateTree, discoverNotes, privateBalance, spendableNotes } from "../../shared/privacy/indexer";
import { MerkleTree, computeZeros } from "../../shared/privacy/merkleTree";
import {
  computeCommitment,
  computeLabel,
  computeNullifierHash,
  computePrecommitment,
  deriveMasterKeys,
  deriveNoteSecrets,
} from "../../shared/privacy/notes";
import { hash2 } from "../../shared/privacy/poseidon";
import type { PoolEvent } from "../../shared/privacy/types";
import { decryptSeed, encryptSeed, generateSeed, parseBackup, VaultError } from "../../shared/privacy/vault";
import { computeFee, getQuote, getQuotes } from "./relayer";
import { resetPrivacyConfig } from "./config";
import { resetFundingCache } from "./funding";

// The quote reads the relayer's balance (server/privacy/funding.ts). No RPC here: a fake client answers, and a test
// never reaches an anvil that may be running on this machine's default ports.
const funding = vi.hoisted(() => ({ relayerBalance: 10n ** 18n }));
vi.mock("./chain", () => ({
  getPublicClient: () => ({ getGasPrice: async () => 1_000_000_000n, getBalance: async () => funding.relayerBalance }),
  makeWalletClient: () => {
    throw new Error("these tests send nothing");
  },
  resetClients: () => {},
}));

const POOL = "0x1111111111111111111111111111111111111111" as const;
const TX = (n: number): Hex => keccak256(toBytes(`tx-${n}`));

describe("poseidon / merkle tree", () => {
  it("matches the circomlib reference vector", () => {
    expect(hash2(1n, 2n)).toBe(7853200120776062878684798364095072458815029376092732009249414926327459813530n);
  });

  it("derives zeros from ZERO_VALUE and gives the empty-tree root", () => {
    const zeros = computeZeros(TREE_DEPTH);
    expect(zeros[0]).toBe(ZERO_VALUE);
    expect(zeros[1]).toBe(hash2(ZERO_VALUE, ZERO_VALUE));
    expect(new MerkleTree(TREE_DEPTH).root).toBe(zeros[TREE_DEPTH]);
    expect(ZERO_VALUE < SNARK_SCALAR_FIELD).toBe(true);
  });

  it("produces verifiable proofs and rejects tampered ones", () => {
    const t = new MerkleTree(TREE_DEPTH, [11n, 22n, 33n]);
    for (let i = 0; i < 3; i++) {
      const p = t.proof(i);
      expect(MerkleTree.verify(p)).toBe(true);
      expect(MerkleTree.verify({ ...p, leaf: 99n })).toBe(false);
      expect(MerkleTree.verify({ ...p, index: (i + 1) % 3 })).toBe(false);
    }
    expect(() => t.insert(SNARK_SCALAR_FIELD)).toThrow();
  });

  it("is incremental: root after k inserts equals a fresh tree of the first k leaves", () => {
    const leaves = [5n, 6n, 7n, 8n, 9n];
    const inc = new MerkleTree(TREE_DEPTH);
    leaves.forEach((l, i) => {
      inc.insert(l);
      expect(inc.root).toBe(MerkleTree.rootOf(leaves.slice(0, i + 1)));
    });
  });
});

describe("note derivation", () => {
  const seed = toBytes(keccak256(toBytes("seed")));
  const keys = deriveMasterKeys(seed);
  const scope = computeScope(POOL, 46630);

  it("is deterministic and distinct per (deposit, hop, scope)", () => {
    const a = deriveNoteSecrets(keys, scope, 0, 0);
    expect(deriveNoteSecrets(deriveMasterKeys(seed), scope, 0, 0)).toEqual(a);
    expect(deriveNoteSecrets(keys, scope, 0, 1).nullifier).not.toBe(a.nullifier);
    expect(deriveNoteSecrets(keys, scope, 1, 0).nullifier).not.toBe(a.nullifier);
    expect(deriveNoteSecrets(keys, computeScope(POOL, 4663), 0, 0).nullifier).not.toBe(a.nullifier);
    expect(a.nullifier < SNARK_SCALAR_FIELD && a.secret < SNARK_SCALAR_FIELD).toBe(true);
  });

  it("binds context to every withdrawal parameter", () => {
    const base = { recipient: POOL, relayer: POOL, fee: 1n, deadline: 2n };
    const c = computeContext(scope, base);
    expect(computeContext(scope, { ...base, fee: 2n })).not.toBe(c);
    expect(computeContext(scope, { ...base, deadline: 0n })).not.toBe(c);
    expect(computeContext(scope, { ...base, relayer: "0x2222222222222222222222222222222222222222" })).not.toBe(c);
    expect(computeContext(computeScope(POOL, 1), base)).not.toBe(c);
    expect(c < SNARK_SCALAR_FIELD).toBe(true);
  });
});

describe("note discovery from events", () => {
  const seed = toBytes(keccak256(toBytes("discovery-seed")));
  const keys = deriveMasterKeys(seed);
  const scope = computeScope(POOL, 31337);
  const strangerKeys = deriveMasterKeys(toBytes(keccak256(toBytes("stranger"))));

  function scenario() {
    const events: PoolEvent[] = [];
    let leaf = 0;
    let nonce = 0n;
    const deposit = (k: ReturnType<typeof deriveMasterKeys>, i: number, value: bigint) => {
      const s = deriveNoteSecrets(k, scope, i, 0);
      const label = computeLabel(scope, ++nonce);
      const commitment = computeCommitment(value, label, computePrecommitment(s));
      events.push({ kind: "deposit", depositor: POOL, commitment, label, value, precommitment: computePrecommitment(s), leafIndex: leaf++, blockNumber: BigInt(events.length + 1), txHash: TX(events.length), logIndex: 0 });
      return { s, label, commitment, value };
    };
    // stranger deposits first (leaf 0), then ours
    deposit(strangerKeys, 0, 10n ** 18n);
    const d0 = deposit(keys, 0, 10n ** 18n);
    const d1 = deposit(keys, 1, 5n * 10n ** 17n);
    // partial withdrawal of d0: 0.4 → change 0.6 at hop 1
    const s01 = deriveNoteSecrets(keys, scope, 0, 1);
    const change = d0.value - 4n * 10n ** 17n;
    events.push({ kind: "withdraw", recipient: POOL, relayer: POOL, value: 4n * 10n ** 17n, fee: 10n ** 16n, spentNullifier: computeNullifierHash(d0.s.nullifier), newCommitment: computeCommitment(change, d0.label, computePrecommitment(s01)), leafIndex: leaf++, blockNumber: 10n, txHash: TX(10), logIndex: 0 });
    // ragequit d1
    events.push({ kind: "ragequit", ragequitter: POOL, commitment: d1.commitment, label: d1.label, value: d1.value, blockNumber: 11n, txHash: TX(11), logIndex: 0 });
    return { events, d0, d1, change };
  }

  it("rebuilds notes, follows change notes and recognises spends", () => {
    const { events, change } = scenario();
    const res = discoverNotes(keys, scope, events);
    expect(res.nextDepositIndex).toBe(2);
    expect(res.conflicts).toEqual([]);
    expect(res.notes.map((n) => `${n.depositIndex}.${n.hop}:${n.spent ? "spent" : "open"}`)).toEqual(["0.0:spent", "0.1:open", "1.0:spent"]);
    expect(res.notes[0].spentBy?.kind).toBe("withdraw");
    expect(res.notes[2].spentBy?.kind).toBe("ragequit");
    expect(res.notes[1].value).toBe(change);
    expect(res.notes[1].leafIndex).toBe(3);
    expect(privateBalance(res.notes)).toBe(change);
    expect(spendableNotes(res.notes)).toHaveLength(1);
  });

  it("does not see other people's notes and builds a gap-free state tree", () => {
    const { events } = scenario();
    const other = discoverNotes(deriveMasterKeys(toBytes(keccak256(toBytes("nobody")))), scope, events);
    expect(other.notes).toHaveLength(0);
    expect(other.nextDepositIndex).toBe(0);
    const tree = buildStateTree(events);
    expect(tree.size).toBe(4);
    const shuffled = [...events].reverse();
    expect(buildStateTree(shuffled).root).toBe(tree.root);
  });

  it("flags duplicate use of a deposit index", () => {
    const { events, d0 } = scenario();
    events.push({ ...(events[1] as Extract<PoolEvent, { kind: "deposit" }>), label: computeLabel(scope, 99n), commitment: computeCommitment(d0.value, computeLabel(scope, 99n), computePrecommitment(d0.s)), leafIndex: 4, txHash: TX(99) });
    expect(discoverNotes(keys, scope, events).conflicts).toEqual([0]);
  });
});

describe("vault", () => {
  it("round-trips the seed and reports precise failure codes", async () => {
    const seed = generateSeed();
    const ctx = { chainId: 46630, pool: POOL };
    const backup = await encryptSeed(seed, "correct horse battery", ctx, 1_000);
    const text = JSON.stringify(backup);
    expect(Buffer.from(await decryptSeed(parseBackup(text), "correct horse battery", ctx))).toEqual(Buffer.from(seed));
    await expect(decryptSeed(backup, "wrong", ctx)).rejects.toMatchObject({ code: "WRONG_PASSWORD" } satisfies Partial<VaultError>);
    await expect(decryptSeed(backup, "correct horse battery", { chainId: 1, pool: POOL })).rejects.toMatchObject({ code: "WRONG_CONTEXT" });
    expect(() => parseBackup("{}")).toThrow(VaultError);
    await expect(encryptSeed(seed, "short", ctx)).rejects.toThrow(/at least 8/);
    const tampered = { ...backup, ciphertext: backup.ciphertext.slice(0, -4) + "AAAA" };
    await expect(decryptSeed(tampered, "correct horse battery", ctx)).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
  });
});

const RELAYER_ENV = [
  "PRIVACY_CHAIN_IDS",
  "PRIVACY_CHAIN_ID",
  "PRIVACY_POOL_ADDRESS",
  "PRIVACY_POOL_ADDRESS_31337",
  "PRIVACY_POOL_ADDRESS_31338",
  "PRIVACY_RELAYER_FEE_BPS",
  "PRIVACY_RELAYER_FEE_BPS_31337",
  "PRIVACY_RELAYER_FEE_BPS_31338",
  "PRIVACY_RELAYER_MIN_FEE_WEI",
  "PRIVACY_RELAYER_MIN_FEE_WEI_31338",
  "PRIVACY_RELAYER_PRIVATE_KEY",
];
const savedRelayerEnv = Object.fromEntries(RELAYER_ENV.map((k) => [k, process.env[k]]));
const clearRelayerEnv = () => RELAYER_ENV.forEach((k) => delete process.env[k]);
afterAll(() => {
  for (const k of RELAYER_ENV) {
    if (savedRelayerEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedRelayerEnv[k];
  }
  resetPrivacyConfig();
});

describe("relayer fee policy", () => {
  beforeEach(() => {
    clearRelayerEnv();
    process.env.PRIVACY_CHAIN_ID = "31337";
    process.env.PRIVACY_POOL_ADDRESS = POOL;
    process.env.PRIVACY_RELAYER_FEE_BPS = "50";
    process.env.PRIVACY_RELAYER_MIN_FEE_WEI = "1000";
    resetPrivacyConfig();
    resetFundingCache();
  });

  it("charges max(bps, minimum) and reports unavailability without a key", async () => {
    expect(computeFee(10n ** 18n)).toBe(5n * 10n ** 15n);
    expect(computeFee(10n)).toBe(1000n);
    const q = await getQuote();
    expect(q).toMatchObject({ chainId: 31337, pool: POOL, available: false, reason: "no_relayer_key", relayer: null, feeBps: 50, minFeeWei: "1000" });
    expect(q.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    // legacy single mode: the chain id is optional, and naming the served one is the same
    expect(computeFee(10n ** 18n, 31337)).toBe(computeFee(10n ** 18n));
    expect((await getQuotes()).quotes).toMatchObject([{ chainId: 31337, reason: "no_relayer_key" }]);
  });
});

describe("relayer quotes are per network", () => {
  // anvil's second default key (#1): a public test key, derived at run time from anvil's public mnemonic
  const KEY = anvilKey(1);
  const ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

  beforeEach(() => {
    clearRelayerEnv();
    Object.assign(process.env, {
      PRIVACY_CHAIN_IDS: "31337,31338",
      PRIVACY_POOL_ADDRESS_31337: POOL, // 31338 has no pool yet
      PRIVACY_RELAYER_PRIVATE_KEY: KEY, // one key for every network
      PRIVACY_RELAYER_FEE_BPS_31337: "100",
      PRIVACY_RELAYER_FEE_BPS_31338: "50",
      PRIVACY_RELAYER_MIN_FEE_WEI_31338: "1000000000000000",
    });
    resetPrivacyConfig();
    resetFundingCache();
    funding.relayerBalance = 10n ** 18n;
  });

  it("each network keeps its own fee, minimum, pool and reason, from one key", async () => {
    const { quotes } = await getQuotes();
    expect(quotes.map((q) => q.chainId)).toEqual([31337, 31338]);
    expect(quotes[0]).toMatchObject({ pool: POOL, available: true, reason: null, relayer: ADDRESS, feeBps: 100, minFeeWei: "0" });
    expect(quotes[1]).toMatchObject({ pool: null, available: false, reason: "no_pool", relayer: ADDRESS, feeBps: 50, minFeeWei: "1000000000000000" });
    expect(computeFee(10n ** 18n, 31337)).toBe(10n ** 16n);
    expect(computeFee(10n ** 18n, 31338)).toBe(5n * 10n ** 15n);
    expect(computeFee(10n ** 14n, 31338)).toBe(10n ** 15n);
  });

  it("a relayer below one withdrawal at the network's gas price is unavailable (relayer_unfunded)", async () => {
    funding.relayerBalance = 1_000_000_000n * 1_200_000n * 2n - 1n; // 1 gwei x 1.2 M gas x 2, less one wei
    expect(await getQuote(31337)).toMatchObject({ available: false, reason: "relayer_unfunded", feeBps: 100 });
    expect(await getQuote(31338)).toMatchObject({ available: false, reason: "no_pool" }); // never read: no pool
  });

  it("names the chain when it is needed or not served", async () => {
    await expect(getQuote()).rejects.toThrow("chainId is required: this server serves 2 networks");
    expect(() => computeFee(1n)).toThrow("chainId is required: this server serves 2 networks");
    await expect(getQuote(46630)).rejects.toThrow("Hylsia is not built for network 46630");
  });
});
