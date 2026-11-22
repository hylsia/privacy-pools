import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getAddress, getContractAddress, keccak256, type Address, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  checkOnchainFacts,
  checkRecord,
  deployRefusal,
  DRIFT_MESSAGE,
  failedBroadcastAction,
  forgeChildEnv,
  isLoopbackAddress,
  isLoopbackHostname,
  mergeBroadcast,
  pinRecord,
  publicRecordIds,
  recordPool,
  renderDeployments,
  vkeyPinFromManifest,
  type VkeyPin,
} from "../../scripts/privacy/deploymentRecords";
import { computeScope } from "../../shared/privacy/context";
import { DEPLOYMENTS } from "../../shared/privacy/deployments";
import type { PoolDeployment } from "../../shared/privacy/deploymentTypes";
import { networkById } from "../../shared/privacy/networks";

const ROOT = path.resolve(import.meta.dirname, "../..");
const ROBINHOOD = 46630;
const LOCAL_B = 31338;
/**
 * A second public network that exists only in this test. Hylsia's registry has one public network today; the guard
 * that deploys every public network from one build (deployRefusal) is generic and stays, for Robinhood Chain mainnet.
 */
const OTHER_PUBLIC = 999_999;

vi.mock("../../shared/privacy/networks", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../shared/privacy/networks")>();
  const other = { ...real.networkById(46630)!, chainId: 999_999, name: "Test network" };
  return { ...real, networkById: (id: number) => (id === 999_999 ? other : real.networkById(id)) };
});

// A deployer that is not an anvil account, at the nonces Deploy.s.sol uses (2 libraries, 2 verifiers, the pool).
const DEPLOYER = getAddress("0x5a3e6f9c1d2b4a7e8f0c9b1a2d3e4f5a6b7c8d9e");
const OWNER = getAddress("0x6b4f7a0d2e3c5b8f9a1d0c2b3e4f5a6b7c8d9e0f");
const at = (nonce: number) => getContractAddress({ from: DEPLOYER, nonce: BigInt(nonce) });
const POOL = at(4);
const WITHDRAW_VERIFIER = at(2);
const COMMITMENT_VERIFIER = at(3);

function goodRecord(chainId: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    aspPostman: OWNER,
    chainId,
    commitmentVerifier: COMMITMENT_VERIFIER,
    deployBlock: "153759679",
    deployer: DEPLOYER,
    minDepositWei: "0",
    owner: OWNER,
    pool: POOL,
    protocol: "hylsia-pp-v1",
    scope: computeScope(POOL, chainId).toString(),
    withdrawVerifier: WITHDRAW_VERIFIER,
    ...extra,
  };
}

/** What Deploy.s.sol wrote on an anvil started with --chain-id 46630 (anvil key 0, automine). */
const ANVIL_RECORD_46630 = {
  aspPostman: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  chainId: 46630,
  commitmentVerifier: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  deployBlock: "0",
  deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  minDepositWei: "0",
  owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  pool: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
  protocol: "hylsia-pp-v1",
  scope: "9706844225444612187616026852639706389427083129813145210276884049688501424755",
  withdrawVerifier: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
};

function ok(fileName: string, raw: unknown, includeLocal = false): PoolDeployment {
  const res = checkRecord(fileName, raw, { includeLocal });
  if (res.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(res)}`);
  return res.record;
}
function problems(fileName: string, raw: unknown, includeLocal = false): string {
  const res = checkRecord(fileName, raw, { includeLocal });
  if (res.kind !== "invalid") throw new Error(`expected invalid, got ${res.kind}`);
  return res.problems.join("\n");
}

describe("checkRecord", () => {
  it("accepts a public record and keeps only the known fields, in order", () => {
    const record = ok(`${ROBINHOOD}.json`, goodRecord(ROBINHOOD, { someToolField: 1 }));
    expect(Object.keys(record)).toEqual([
      "chainId",
      "pool",
      "withdrawVerifier",
      "commitmentVerifier",
      "owner",
      "aspPostman",
      "scope",
      "minDepositWei",
      "deployBlock",
      "protocol",
      "deployer",
    ]);
    expect(record.chainId).toBe(ROBINHOOD);
    expect(record.pool).toBe(POOL);
  });

  it("rejects a record made on anvil for a public chain id (the phantom record)", () => {
    const p = problems(`${ROBINHOOD}.json`, ANVIL_RECORD_46630);
    expect(p).toMatch(/deployer, owner, aspPostman are anvil default accounts/);
    expect(p).toMatch(/made on a local chain, not on Robinhood Chain Testnet/);
    expect(p).toMatch(/deployBlock is 0/);
  });

  it("rejects a record moved to another chain: the scope binds the chain id", () => {
    const moved = { ...goodRecord(LOCAL_B), chainId: ROBINHOOD };
    expect(problems(`${ROBINHOOD}.json`, moved)).toMatch(/scope is not computeScope\(pool, 46630\)/);
    // and a record whose file name and chain id disagree
    expect(problems(`${ROBINHOOD}.json`, goodRecord(LOCAL_B))).toMatch(/the file name says chain 46630, the record says 31338/);
  });

  it("rejects missing fields, unchecksummed addresses, bad numbers, another protocol", () => {
    const { owner: _owner, ...noOwner } = goodRecord(ROBINHOOD);
    expect(problems(`${ROBINHOOD}.json`, noOwner)).toMatch(/owner is missing/);
    expect(problems(`${ROBINHOOD}.json`, goodRecord(ROBINHOOD, { pool: POOL.toLowerCase() }))).toMatch(/pool is not checksummed/);
    expect(problems(`${ROBINHOOD}.json`, goodRecord(ROBINHOOD, { aspPostman: "0x1234" }))).toMatch(/aspPostman is not an address/);
    expect(problems(`${ROBINHOOD}.json`, goodRecord(ROBINHOOD, { deployBlock: "0x10" }))).toMatch(/deployBlock must be a decimal string/);
    expect(problems(`${ROBINHOOD}.json`, goodRecord(ROBINHOOD, { protocol: "hylsia-pp-v0" }))).toMatch(/protocol is hylsia-pp-v0/);
    expect(problems(`${ROBINHOOD}.json`, [1, 2])).toMatch(/not a JSON object/);
  });

  it("rejects file names that are not a known chain id", () => {
    expect(problems("46630-old.json", goodRecord(ROBINHOOD))).toMatch(/named <chainId>\.json/);
    expect(problems("9999.json", goodRecord(9999))).toMatch(/not built for network 9999/);
  });

  it("skips local chains unless --include-local, and then allows anvil accounts", () => {
    const local = { ...ANVIL_RECORD_46630, chainId: 31337, scope: computeScope(ANVIL_RECORD_46630.pool as Address, 31337).toString() };
    const skipped = checkRecord("31337.json", local, { includeLocal: false });
    expect(skipped.kind).toBe("skipped");
    expect(ok("31337.json", local, true).deployBlock).toBe("0");
  });
});

// ─── broadcast logs ───────────────────────────────────────────────────────────

const lower = (a: string) => a.toLowerCase();
const T3 = getAddress("0xff4044510b61a631ab192cd4f60d45731c0c12f3");
const T4 = getAddress("0xa553216d49f01c26e2a8ed86860d4c789c194b33");
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

function broadcastLog(o: { chain?: number; pool?: string; poolStatus?: string; dropPoolReceipt?: boolean } = {}) {
  const txs = [
    { hash: hash(1), transactionType: "CREATE2", contractName: "PoseidonT3", contractAddress: lower(T3) },
    { hash: hash(2), transactionType: "CREATE2", contractName: "PoseidonT4", contractAddress: lower(T4) },
    { hash: hash(3), transactionType: "CREATE", contractName: "WithdrawVerifier", contractAddress: lower(WITHDRAW_VERIFIER) },
    { hash: hash(4), transactionType: "CREATE", contractName: "CommitmentVerifier", contractAddress: lower(COMMITMENT_VERIFIER) },
    { hash: hash(5), transactionType: "CREATE", contractName: "PrivacyPool", contractAddress: lower(o.pool ?? POOL) },
  ];
  // forge lists receipts out of transaction order
  const receipts = [5, 3, 4, 2, 1]
    .filter((n) => !(o.dropPoolReceipt && n === 5))
    .map((n) => ({ transactionHash: hash(n), status: n === 5 ? (o.poolStatus ?? "0x1") : "0x1", blockNumber: n === 5 ? "0x92a3c41" : "0x92a3c40" }));
  return {
    chain: o.chain ?? ROBINHOOD,
    transactions: txs,
    receipts,
    libraries: [
      `../node_modules/poseidon-solidity/PoseidonT3.sol:PoseidonT3:${T3}`,
      `../node_modules/poseidon-solidity/PoseidonT4.sol:PoseidonT4:${T4}`,
    ],
  };
}

describe("mergeBroadcast", () => {
  const record = () => ok(`${ROBINHOOD}.json`, goodRecord(ROBINHOOD, { deployBlock: "153759000" }));

  it("merges libraries, transaction hashes and the pool's receipt block", () => {
    const { record: merged, problems: p } = mergeBroadcast(record(), broadcastLog());
    expect(p).toEqual([]);
    expect(merged.libraries).toEqual([
      { name: "PoseidonT3", address: T3 },
      { name: "PoseidonT4", address: T4 },
    ]);
    expect(merged.txHashes).toEqual({ PoseidonT3: hash(1), PoseidonT4: hash(2), WithdrawVerifier: hash(3), CommitmentVerifier: hash(4), PrivacyPool: hash(5) });
    expect(merged.poolReceiptBlock).toBe(BigInt("0x92a3c41").toString());
  });

  it("refuses a log of another deployment, another chain, a failed or missing receipt", () => {
    expect(mergeBroadcast(record(), broadcastLog({ pool: getAddress("0x00000000000000000000000000000000000000aa") })).problems.join()).toMatch(
      /describes another deployment/,
    );
    expect(mergeBroadcast(record(), broadcastLog({ chain: LOCAL_B })).problems.join()).toMatch(/it is for chain 31338/);
    expect(mergeBroadcast(record(), broadcastLog({ poolStatus: "0x0" })).problems.join()).toMatch(/PrivacyPool deployment .* has status 0x0/);
    expect(mergeBroadcast(record(), broadcastLog({ dropPoolReceipt: true })).problems.join()).toMatch(/no receipt for the PrivacyPool deployment/);
  });

  it("refuses a pool deployed before the record's deploy block", () => {
    const late = ok(`${ROBINHOOD}.json`, goodRecord(ROBINHOOD, { deployBlock: "999999999" }));
    expect(mergeBroadcast(late, broadcastLog()).problems.join()).toMatch(/before the record's deploy block/);
  });
});

// ─── verifying keys and on-chain facts ────────────────────────────────────────

const PIN: VkeyPin = { withdraw: "a".repeat(64), commitment: "b".repeat(64) };
const OTHER_PIN: VkeyPin = { withdraw: "c".repeat(64), commitment: "b".repeat(64) };

describe("verifying-key pin", () => {
  it("reads the served manifest", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "client", "public", "zk", "manifest.json"), "utf8"));
    const pin = vkeyPinFromManifest(manifest);
    expect(pin.withdraw).toBe(manifest.circuits.withdraw.vkey.sha256);
    expect(pin.commitment).toBe(manifest.circuits.commitment.vkey.sha256);
    expect(() => vkeyPinFromManifest({ circuits: { withdraw: { vkey: {} } } })).toThrow(/no sha256 for the withdraw verifying key/);
  });

  it("pins a new record, keeps an unchanged one, and refuses drift for the same pool", () => {
    const record = ok(`${ROBINHOOD}.json`, goodRecord(ROBINHOOD));
    expect(pinRecord(record, PIN, undefined).record.vkeySha256).toEqual(PIN);

    const synced: PoolDeployment = { ...record, vkeySha256: PIN, verifierCodeHash: { withdraw: hash(7), commitment: hash(8) } };
    const again = pinRecord(record, PIN, synced);
    expect(again.problems).toEqual([]);
    expect(again.record.verifierCodeHash).toEqual(synced.verifierCodeHash);

    const drift = pinRecord(record, OTHER_PIN, synced);
    expect(drift.problems.join()).toContain(DRIFT_MESSAGE);

    // a replaced pool (another address) starts a new pin
    const replaced = pinRecord(record, OTHER_PIN, { ...synced, pool: getAddress("0x00000000000000000000000000000000000000bb") });
    expect(replaced.problems).toEqual([]);
    expect(replaced.record.vkeySha256).toEqual(OTHER_PIN);
    expect(replaced.record.verifierCodeHash).toBeUndefined();
  });

  it("checks the chain id, the pool's code, SCOPE and the verifiers' code", () => {
    const record = ok(`${ROBINHOOD}.json`, goodRecord(ROBINHOOD));
    const compiled = { withdraw: "0x6001600155" as Hex, commitment: "0x6002600255" as Hex };
    const facts = {
      rpcHost: "rpc.example",
      rpcChainId: ROBINHOOD,
      poolCode: "0x6080" as Hex,
      scope: BigInt(record.scope),
      verifierCode: { ...compiled },
      compiled,
    };
    const good = checkOnchainFacts(record, facts);
    expect(good.problems).toEqual([]);
    expect(good.verifierCodeHash).toEqual({ withdraw: keccak256(compiled.withdraw), commitment: keccak256(compiled.commitment) });

    expect(checkOnchainFacts(record, { ...facts, rpcChainId: LOCAL_B }).problems.join()).toMatch(/rpc\.example is chain 31338, not 46630/);
    expect(checkOnchainFacts(record, { ...facts, poolCode: "0x" }).problems.join()).toMatch(/does not describe a deployed pool/);
    expect(checkOnchainFacts(record, { ...facts, scope: 1n }).problems.join()).toMatch(/SCOPE\(\)/);
    const swapped = checkOnchainFacts(record, { ...facts, verifierCode: { withdraw: compiled.commitment, commitment: compiled.commitment } });
    expect(swapped.problems.join()).toContain(DRIFT_MESSAGE);
    expect(swapped.verifierCodeHash).toBeNull();
  });
});

// ─── the generated file ───────────────────────────────────────────────────────

describe("forgeChildEnv (the environment forge deploys in)", () => {
  it("drops every FOUNDRY_* and DAPP_* override and the redirecting variables; keeps the rest", () => {
    const env = forgeChildEnv({
      PATH: "/usr/bin",
      HOME: "/home/x",
      PRIVACY_POOL_OWNER: "0x2629",
      PRIVACY_DEPLOYER_PRIVATE_KEY: "0xabc",
      FOUNDRY_LIBRARIES: "../node_modules/poseidon-solidity/PoseidonT3.sol:PoseidonT3:0x000000000000000000000000000000000000dEaD",
      DAPP_LIBRARIES: "x",
      FOUNDRY_PROFILE: "ci",
      FOUNDRY_OPTIMIZER_RUNS: "1",
      FOUNDRY_SOLC_VERSION: "0.8.20",
      FOUNDRY_ETH_RPC_URL: "http://127.0.0.1:8545",
      FOUNDRY_BROADCAST: "/tmp/b",
      ETH_RPC_URL: "http://elsewhere",
      CHAIN: "1",
      CHAIN_ID: "1",
      VERIFIER: "sourcify",
      VERIFIER_URL: "http://v",
      PRIVACY_DEPLOYMENT_OUT: "deployments/x.json",
    });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/x", PRIVACY_POOL_OWNER: "0x2629", PRIVACY_DEPLOYER_PRIVATE_KEY: "0xabc" });
  });

  it("deploy.ts and e2e.ts both build forge's environment with it", () => {
    for (const file of ["deploy.ts", "e2e.ts"]) {
      const text = fs.readFileSync(path.join(ROOT, "scripts", "privacy", file), "utf8");
      expect(text).toMatch(/forgeChildEnv\(process\.env\)/);
    }
  });
});

describe("renderDeployments", () => {
  it("with no record, is byte-identical to the hand-made empty file (F0's, 301 bytes)", () => {
    const empty = renderDeployments([]);
    expect(createHash("sha256").update(empty).digest("hex")).toBe("2a7ef3317fa3b3a01bc2086c55f3312e14f8b930158a586ca070e24cc97943aa");
    expect(empty).not.toMatch(/interface PoolDeployment/);
  });

  it("the committed file is exactly the render of its own records (empty, or the live pools)", () => {
    const committed = fs.readFileSync(path.join(ROOT, "shared", "privacy", "deployments.ts"), "utf8");
    expect(renderDeployments(Object.values(DEPLOYMENTS))).toBe(committed);
  });

  it("round-trips records through the generated module", async () => {
    const robinhood = pinRecord(mergeBroadcast(ok(`${ROBINHOOD}.json`, goodRecord(ROBINHOOD, { deployBlock: "153759000" })), broadcastLog()).record, PIN, undefined).record;
    const localB = ok(`${LOCAL_B}.json`, goodRecord(LOCAL_B), true);
    const text = renderDeployments([robinhood, localB]);
    expect(text.indexOf("  31338: {")).toBeLessThan(text.indexOf("  46630: {")); // by chain id
    expect(text).toContain('import type { PoolDeployment } from "./deploymentTypes";');

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hylsia-deployments-"));
    try {
      fs.copyFileSync(path.join(ROOT, "shared", "privacy", "deploymentTypes.ts"), path.join(dir, "deploymentTypes.ts"));
      fs.writeFileSync(path.join(dir, "deployments.ts"), text);
      const mod = (await import(pathToFileURL(path.join(dir, "deployments.ts")).href)) as { DEPLOYMENTS: Record<number, PoolDeployment> };
      expect(mod.DEPLOYMENTS[ROBINHOOD]).toEqual(robinhood);
      expect(mod.DEPLOYMENTS[LOCAL_B]).toEqual(localB);
      expect(Object.keys(mod.DEPLOYMENTS)).toEqual([String(LOCAL_B), String(ROBINHOOD)]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ─── deploy and build guards ──────────────────────────────────────────────────

describe("loopback detection", () => {
  it("knows this machine in every spelling", () => {
    for (const a of ["127.0.0.1", "127.1.2.3", "0.0.0.0", "::1", "[::1]", "::", "::ffff:127.0.0.1", "0:0:0:0:0:0:0:1", "::ffff:7f00:1"]) {
      expect(isLoopbackAddress(a), a).toBe(true);
    }
    for (const h of ["localhost", "LOCALHOST.", "rpc.localhost", "127.0.0.1"]) expect(isLoopbackHostname(h), h).toBe(true);
  });
  it("does not flag other hosts", () => {
    for (const a of ["10.0.0.1", "192.168.1.20", "128.0.0.1", "8.8.8.8", "::ffff:8.8.8.8", "2001:db8::1"]) {
      expect(isLoopbackAddress(a), a).toBe(false);
    }
    for (const h of ["rpc.example.com", "rpc.testnet.chain.robinhood.com", "localhost.example.com"]) {
      expect(isLoopbackHostname(h), h).toBe(false);
    }
  });
});

describe("deployRefusal", () => {
  const robinhood = networkById(ROBINHOOD)!;
  const base = {
    network: robinhood,
    rpcHost: "rpc.testnet.chain.robinhood.com",
    rpcIsLoopback: false,
    rpcChainId: ROBINHOOD,
    recordExists: false,
    replace: false,
    served: PIN,
    deployments: {} as Record<number, PoolDeployment>,
  };
  /** a record of the test's other public network, pinned or not */
  const otherRecord = (pin?: VkeyPin): Record<number, PoolDeployment> => ({
    [OTHER_PUBLIC]: { ...ok(`${ROBINHOOD}.json`, goodRecord(ROBINHOOD)), chainId: OTHER_PUBLIC, ...(pin ? { vkeySha256: pin } : {}) },
  });

  it("lets a first deployment through", () => {
    expect(deployRefusal(base)).toBeNull();
    expect(deployRefusal({ ...base, deployments: otherRecord(PIN) })).toBeNull();
    // a local chain's record never counts
    expect(deployRefusal({ ...base, deployments: { [LOCAL_B]: { ...ok(`${LOCAL_B}.json`, goodRecord(LOCAL_B), true), vkeySha256: OTHER_PIN } } })).toBeNull();
  });
  it("refuses loopback RPCs and RPCs on another chain", () => {
    expect(deployRefusal({ ...base, rpcHost: "127.0.0.1:8545", rpcIsLoopback: true, rpcChainId: null })).toMatch(/loopback RPC is a local chain/);
    expect(deployRefusal({ ...base, rpcChainId: LOCAL_B })).toMatch(/answers chain 31338, not Robinhood Chain Testnet \(46630\)/);
  });
  it("refuses to overwrite a record without --replace (the live pool's record is one)", () => {
    expect(deployRefusal({ ...base, recordExists: true })).toMatch(
      /contracts\/deployments\/46630\.json already records a pool on Robinhood Chain Testnet\. Pass --replace/,
    );
    expect(deployRefusal({ ...base, recordExists: true, replace: true })).toBeNull();
  });
  it("refuses verifying-key drift against another public network, and an unpinned record", () => {
    expect(deployRefusal({ ...base, deployments: otherRecord(OTHER_PIN) })).toMatch(/verifying-key drift: Test network's pool/);
    expect(deployRefusal({ ...base, deployments: otherRecord() })).toMatch(/no pinned verifying keys/);
    // its own earlier record never counts as another network
    expect(
      deployRefusal({ ...base, recordExists: true, replace: true, deployments: { [ROBINHOOD]: { ...otherRecord(OTHER_PIN)[OTHER_PUBLIC], chainId: ROBINHOOD } } }),
    ).toBeNull();
  });
});

describe("publicRecordIds (build-circuits guard)", () => {
  it("lists public networks with a record file or a generated record, never local or unknown ones", () => {
    expect(publicRecordIds(["31337.json", "31338.json", "local", "notes.txt", "x.json", "999.json"])).toEqual([]);
    expect(publicRecordIds(["1.json"])).toEqual([1]);
    expect(publicRecordIds(["31337.json", "46630.json"], [])).toEqual([ROBINHOOD]);
    expect(publicRecordIds(["46630.json"], [OTHER_PUBLIC, 31337, 999])).toEqual([ROBINHOOD, OTHER_PUBLIC]);
  });
});

describe("failedBroadcastAction (deploy.ts after forge failed with --broadcast)", () => {
  // Deploy.s.sol writes the record while the script runs, before forge sends anything.
  const OLD = '{ "chainId": 46630, "pool": "0x1111111111111111111111111111111111111111" }';
  const NEW = '{ "chainId": 46630, "pool": "0x2222222222222222222222222222222222222222" }';

  it("does nothing when the script wrote no record", () => {
    for (const onchain of ["code", "empty", "unreachable"] as const) {
      expect(failedBroadcastAction(null, null, onchain)).toEqual({ kind: "nothing_written" });
      expect(failedBroadcastAction(OLD, OLD, onchain)).toEqual({ kind: "nothing_written" });
    }
  });

  it("removes a new phantom record, and restores the one it replaced", () => {
    expect(failedBroadcastAction(null, NEW, "empty")).toEqual({ kind: "phantom", restore: "remove" });
    expect(failedBroadcastAction(OLD, NEW, "empty")).toEqual({ kind: "phantom", restore: "previous" });
  });

  it("keeps a record whose pool is on-chain (forge failed afterwards, e.g. the verification) or could not be checked", () => {
    expect(failedBroadcastAction(null, NEW, "code")).toEqual({ kind: "deployed" });
    expect(failedBroadcastAction(OLD, NEW, "unreachable")).toEqual({ kind: "unknown" });
  });

  it("reads the pool address from a record's text", () => {
    expect(recordPool(NEW)).toBe("0x2222222222222222222222222222222222222222");
    expect(recordPool('{ "pool": "0xdc64a140aa3e981100a9beca4e685f962f0cf6c9" }')).toBe(getAddress("0xdc64a140aa3e981100a9beca4e685f962f0cf6c9"));
    for (const bad of [null, "", "not json", "null", '{ "pool": "0x12" }', '{ "pool": 5 }', "{}"]) expect(recordPool(bad)).toBeNull();
  });
});
