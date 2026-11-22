/**
 * The network registry and its env parser (shared/privacy/networks.ts), the reorg-safe event helpers
 * (shared/privacy/indexer.ts) and the browser config built on them (client/src/privacy/config.ts).
 * Pure: no chain, no RPC.
 *
 * Hylsia is built for Robinhood Chain Testnet; the two local chains (31337, 31338) stand for "another network" where
 * the code must keep several apart.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { anvil, anvilB, getPrivacyChain, PRIVACY_CHAINS, robinhoodTestnet, SUPPORTED_CHAIN_IDS } from "../../shared/privacy/chains";
import { ROBINHOOD_TESTNET } from "../../shared/privacy/constants";
import { computeScope } from "../../shared/privacy/context";
import type { PoolDeployment } from "../../shared/privacy/deploymentTypes";
import { fetchPoolEvents, headRegression, mergePoolEvents, nextScanRange, stateLeaves } from "../../shared/privacy/indexer";
import {
  ANVIL_DEFAULT_ACCOUNTS,
  DEFAULT_CHAIN_IDS,
  NETWORKS,
  PUBLIC_NETWORKS,
  networkById,
  networkBySlug,
  networkEnv,
  parsePoolKey,
  pickPoolEntry,
  poolKey,
  resolveNetworks,
  resolveViteNetworks,
  samePool,
  type ResolvedNetwork,
} from "../../shared/privacy/networks";
import type { PoolEvent } from "../../shared/privacy/types";

const POOL = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9" as Address; // the local record's pool (contracts/deployments/31337.json)
const OTHER_POOL = "0x1111111111111111111111111111111111111111" as Address;
const OWNER = "0x2222222222222222222222222222222222222222" as Address;
const POSTMAN = "0x3333333333333333333333333333333333333333" as Address;
const DEPLOYER = "0x4444444444444444444444444444444444444444" as Address;
const VERIFIER = "0x5555555555555555555555555555555555555555" as Address;

type Vars = Record<string, string>;

/** The server's reader (process.env style). */
const serverRead = (vars: Vars) => (name: string) => vars[name];
/** The client's reader: the same variables with the VITE_ prefix, read through `"VITE_" + name`. */
const clientRead = (vars: Vars) => {
  const env = Object.fromEntries(Object.entries(vars).map(([k, v]) => [`VITE_${k}`, v]));
  return (name: string) => env[`VITE_${name}`];
};

/** Resolves with both prefixes and checks they agree. */
function resolve(vars: Vars, deployments: Record<number, PoolDeployment> = {}) {
  const server = resolveNetworks(serverRead(vars), deployments);
  const client = resolveNetworks(clientRead(vars), deployments);
  expect(client).toEqual(server);
  return server;
}

const only = (r: ReturnType<typeof resolveNetworks>, chainId: number): ResolvedNetwork => {
  const n = r.networks.find((x) => x.network.chainId === chainId);
  if (!n) throw new Error(`network ${chainId} not served`);
  return n;
};

/** A well-formed record (not made with anvil accounts, right scope), with overrides. */
function record(chainId: number, over: Partial<PoolDeployment> = {}): PoolDeployment {
  const pool = (over.pool ?? POOL) as Address;
  return {
    chainId,
    pool,
    withdrawVerifier: VERIFIER,
    commitmentVerifier: VERIFIER,
    owner: OWNER,
    aspPostman: POSTMAN,
    scope: over.scope ?? computeScope(pool, chainId).toString(),
    minDepositWei: "0",
    deployBlock: "12345",
    deployer: DEPLOYER,
    ...over,
  };
}

describe("registry", () => {
  it("lists testnet, opt-in mainnet and local chains, while retaining the testnet default", () => {
    expect(NETWORKS.map((n) => [n.chainId, n.slug])).toEqual([
      [46630, "robinhood-testnet"],
      [4663, "robinhood-mainnet"],
      [1, "ethereum-mainnet"],
      [31337, "local-a"],
      [31338, "local-b"],
    ]);
    expect(PUBLIC_NETWORKS.map((n) => n.chainId)).toEqual([46630, 4663, 1]);
    expect(DEFAULT_CHAIN_IDS).toEqual([46630]);
    expect(SUPPORTED_CHAIN_IDS).toEqual([46630, 4663, 1, 31337, 31338]);
    expect(Object.keys(PRIVACY_CHAINS).map(Number).sort((a, b) => a - b)).toEqual([1, 4663, 31337, 31338, 46630]);
    expect(NETWORKS.every((n) => n.chain.id === n.chainId)).toBe(true);
  });

  it("holds the design's network facts", () => {
    const rh = networkById(46630)!;
    expect(rh).toMatchObject({
      name: "Robinhood Chain Testnet",
      shortName: "Robinhood Chain Testnet",
      kind: "l2",
      defaultRpcUrl: "https://rpc.testnet.chain.robinhood.com",
      explorer: { url: "https://explorer.testnet.chain.robinhood.com", name: "Robinhood Chain Testnet Explorer" },
      faucet: { url: "https://faucet.testnet.chain.robinhood.com" },
      walletDocsUrl: "https://docs.robinhood.com/chain/add-network-to-wallet",
      mark: "robinhood",
      aspConfirmations: 1,
      reorgWindow: 20,
      // the public RPC's eth_getLogs limit (100,000 blocks), measured 2026-11-17
      logChunk: 100_000n,
      minLogChunk: 500n,
    });
    expect(rh.faucet).toEqual({ url: "https://faucet.testnet.chain.robinhood.com", display: "faucet.testnet.chain.robinhood.com", hint: null });
    expect(rh.walletHint).toBeNull();
    for (const id of [31337, 31338]) {
      expect(networkById(id)).toMatchObject({ kind: "local", explorer: null, faucet: null, mark: "monogram", reorgWindow: 0 });
    }
    expect(networkById(31337)!.defaultRpcUrl).toBe("http://127.0.0.1:8545");
    expect(networkById(31338)!.defaultRpcUrl).toBe("http://127.0.0.1:8546");
    // Both Robinhood Chain networks carry the feather.
    expect(NETWORKS.filter((n) => n.mark === "robinhood").map((n) => n.chainId)).toEqual([46630, 4663]);
    for (const n of NETWORKS) for (const s of [n.name, n.shortName, n.explorer?.name ?? ""]) expect(s).not.toMatch(/Robinhood(?! Chain)/);
  });

  it("finds networks by id and slug, registry entries only", () => {
    expect(networkById(4663)?.slug).toBe("robinhood-mainnet");
    expect(networkById(1)?.slug).toBe("ethereum-mainnet");
    expect(networkById(999)).toBeNull();
    expect(networkBySlug(" Robinhood-Testnet ")?.chainId).toBe(46630);
    expect(networkBySlug("local-b")?.chainId).toBe(31338);
    expect(networkBySlug("46630")).toBeNull();
    expect(networkBySlug("mainnet")).toBeNull();
  });

  it("keeps the chain objects' default RPCs our own and lists the supported ids in errors", () => {
    expect(robinhoodTestnet.rpcUrls.default.http[0]).toBe("https://rpc.testnet.chain.robinhood.com");
    expect(robinhoodTestnet.id).toBe(ROBINHOOD_TESTNET.id);
    expect(robinhoodTestnet.nativeCurrency).toEqual({ name: "Ether", symbol: "ETH", decimals: 18 });
    expect(robinhoodTestnet.blockExplorers?.default.name).toBe("Robinhood Chain Testnet Explorer");
    expect(ROBINHOOD_TESTNET.blockExplorers.default.name).toBe("Robinhood Chain Testnet Explorer");
    expect(anvilB).toMatchObject({ id: 31338 });
    expect(anvilB.rpcUrls.default.http[0]).toBe("http://127.0.0.1:8546");
    expect(getPrivacyChain(46630)).toBe(robinhoodTestnet);
    expect(getPrivacyChain(31337)).toBe(anvil);
    expect(() => getPrivacyChain(999)).toThrow("Unsupported privacy chain id 999 (supported: 46630, 4663, 1, 31337, 31338)");
  });

  it("knows anvil's ten default accounts", () => {
    const mnemonic = "test test test test test test test test test test test junk";
    const derived = Array.from({ length: 10 }, (_, i) => mnemonicToAccount(mnemonic, { addressIndex: i }).address);
    expect(ANVIL_DEFAULT_ACCOUNTS).toEqual(derived);
  });
});

describe("pool identity", () => {
  const a = { chainId: 46630, pool: POOL };
  const b = { chainId: 31338, pool: POOL };

  it("keys a pool by chain and lowercase address", () => {
    expect(poolKey(46630, POOL)).toBe(`46630:${POOL.toLowerCase()}`);
    expect(poolKey(46630, POOL)).not.toBe(poolKey(31338, POOL));
    expect(parsePoolKey(`31338:${POOL}`)).toEqual({ chainId: 31338, pool: POOL.toLowerCase() });
    expect(parsePoolKey(POOL)).toBeNull();
    expect(parsePoolKey("robinhood-testnet:0x1")).toBeNull();
  });

  it("matches a pool only on the same chain and address", () => {
    expect(samePool(a, { chainId: 46630, pool: POOL.toLowerCase() as Address })).toBe(true);
    expect(samePool(a, b)).toBe(false); // the same address on another chain is another pool
    expect(samePool(a, { chainId: 46630, pool: OTHER_POOL })).toBe(false);
    expect(samePool(a, { chainId: 46630, pool: null as unknown as Address })).toBe(false);
  });

  it("picks the entry of the requested chain when two chains share an address", () => {
    const list = [
      { ...b, now: 2 },
      { ...a, now: 1 },
    ];
    expect(pickPoolEntry(list, a)?.now).toBe(1);
    expect(pickPoolEntry(list, b)?.now).toBe(2);
    expect(pickPoolEntry(list, { chainId: 31337, pool: POOL })).toBeNull();
    expect(pickPoolEntry(undefined, a)).toBeNull();
    expect(pickPoolEntry(list, null)).toBeNull();
  });
});

describe("resolveNetworks: modes", () => {
  it("serves Robinhood Chain Testnet alone, pending, when nothing is set", () => {
    const r = resolve({});
    expect(r.mode).toBe("multi");
    expect(r.warnings).toEqual([]);
    expect(r.networks.map((n) => n.network.chainId)).toEqual([46630]);
    for (const n of r.networks) {
      expect(n).toMatchObject({ rpcSource: "default", pool: null, poolSource: "none", deployBlock: null, deployBlockSource: "none", problems: [], warnings: [] });
      expect(n.rpcUrl).toBe(n.network.defaultRpcUrl);
      expect(n.explorer).toEqual(n.network.explorer);
    }
  });

  it("lists PRIVACY_CHAIN_IDS in registry order, once each", () => {
    expect(resolve({ PRIVACY_CHAIN_IDS: "31338, 46630,46630" }).networks.map((n) => n.network.chainId)).toEqual([46630, 31338]);
    expect(resolve({ PRIVACY_CHAIN_IDS: "31338,31337" }).networks.map((n) => n.network.chainId)).toEqual([31337, 31338]);
    const one = resolve({ PRIVACY_CHAIN_IDS: "46630" });
    expect(one.mode).toBe("multi");
    expect(one.warnings).toEqual([]);
    expect(one.networks.map((n) => n.network.chainId)).toEqual([46630]);
  });

  it("throws on unknown or malformed ids, naming the supported ones", () => {
    expect(() => resolveNetworks(serverRead({ PRIVACY_CHAIN_IDS: "46630,999" }), {})).toThrow(/not built for network 999 \(supported: 46630, 4663, 1, 31337, 31338\)/);
    expect(() => resolveNetworks(serverRead({ PRIVACY_CHAIN_IDS: "46630,robinhood" }), {})).toThrow(/"robinhood" is not a chain id/);
    expect(() => resolveNetworks(serverRead({ PRIVACY_CHAIN_IDS: " , " }), {})).toThrow(/lists no network/);
    expect(() => resolveNetworks(serverRead({ PRIVACY_CHAIN_ID: "9999" }), {})).toThrow(/not built for network 9999/);
    expect(() => resolveNetworks(clientRead({ PRIVACY_CHAIN_ID: "999" }), {})).toThrow(/PRIVACY_CHAIN_ID/);
  });

  it("refuses a stale id that this registry no longer has (an unknown id), on the server and in the browser build", () => {
    const STALE = 11155111; // a network an older configuration listed: no longer in the registry
    expect(networkById(STALE)).toBeNull();
    expect(() => getPrivacyChain(STALE)).toThrow(`Unsupported privacy chain id ${STALE} (supported: 46630, 4663, 1, 31337, 31338)`);
    expect(() => resolveNetworks(serverRead({ PRIVACY_CHAIN_IDS: `46630,${STALE}` }), {})).toThrow(
      `PRIVACY_CHAIN_IDS: Hylsia is not built for network ${STALE} (supported: 46630, 4663, 1, 31337, 31338)`,
    );
    expect(() => resolveNetworks(clientRead({ PRIVACY_CHAIN_IDS: `${STALE}` }), {})).toThrow(`not built for network ${STALE}`);
    expect(() => resolveNetworks(serverRead({ PRIVACY_CHAIN_ID: `${STALE}` }), {})).toThrow(`PRIVACY_CHAIN_ID: Hylsia is not built for network ${STALE}`);
    // its suffixed variables are simply not read (no network of the registry has that id)
    expect(resolve({ [`PRIVACY_RPC_URL_${STALE}`]: "https://rpc.example.com" }).warnings).toEqual([]);
  });

  it("names the VITE_ variable for the browser build (vite.config.ts checks it when Vite starts; the client at import)", () => {
    const STALE = 11155111;
    expect(() => resolveViteNetworks({ VITE_PRIVACY_CHAIN_IDS: `46630,${STALE}` }, {})).toThrow(
      `VITE_PRIVACY_CHAIN_IDS: Hylsia is not built for network ${STALE} (supported: 46630, 4663, 1, 31337, 31338)`,
    );
    expect(() => resolveViteNetworks({ VITE_PRIVACY_CHAIN_ID: "999" }, {})).toThrow(/^VITE_PRIVACY_CHAIN_ID: Hylsia is not built for network 999 /);
    // the server's names are not read in the browser build
    expect(resolveViteNetworks({ PRIVACY_CHAIN_IDS: `${STALE}` }, {}).networks.map((n) => n.network.chainId)).toEqual([46630]);
    // warnings name the VITE_ variables too
    expect(resolveViteNetworks({ VITE_PRIVACY_CHAIN_IDS: "46630", VITE_PRIVACY_RPC_URL: "http://127.0.0.1:8547" }, {}).warnings).toEqual([
      "VITE_PRIVACY_RPC_URL has no network suffix and is ignored; set VITE_PRIVACY_RPC_URL_46630",
    ]);
    // the valid build answers like resolveNetworks
    const valid = resolveViteNetworks({ VITE_PRIVACY_CHAIN_IDS: "31337,31338", VITE_PRIVACY_RPC_URL_31338: "http://127.0.0.1:8546" }, {});
    expect(valid.networks.map((n) => [n.network.chainId, n.rpcSource])).toEqual([
      [31337, "default"],
      [31338, "env"],
    ]);
  });

  it("runs legacy single mode on PRIVACY_CHAIN_ID with today's unsuffixed variables", () => {
    const r = resolve({
      PRIVACY_CHAIN_ID: "31337",
      PRIVACY_RPC_URL: "http://127.0.0.1:8547",
      PRIVACY_POOL_ADDRESS: POOL.toLowerCase(),
      PRIVACY_POOL_DEPLOY_BLOCK: "7",
    });
    expect(r.mode).toBe("legacy");
    expect(r.warnings).toEqual([]);
    expect(r.networks).toHaveLength(1);
    expect(r.networks[0]).toMatchObject({
      rpcUrl: "http://127.0.0.1:8547",
      rpcSource: "env",
      pool: POOL, // checksummed
      poolSource: "env",
      deployBlock: 7n,
      deployBlockSource: "env",
      problems: [],
    });
    // the suffixed form wins over the unsuffixed one
    const s = resolve({ PRIVACY_CHAIN_ID: "31337", PRIVACY_RPC_URL: "http://127.0.0.1:8547", PRIVACY_RPC_URL_31337: "http://127.0.0.1:8548" });
    expect(s.networks[0].rpcUrl).toBe("http://127.0.0.1:8548");
    // blank values count as unset
    expect(resolve({ PRIVACY_CHAIN_ID: "31337", PRIVACY_RPC_URL: "  " }).networks[0].rpcSource).toBe("default");
  });

  it("ignores the unsuffixed per-network variables in multi mode, with a warning naming the suffixed forms", () => {
    const r = resolve({
      PRIVACY_RPC_URL: "http://127.0.0.1:8547",
      PRIVACY_POOL_ADDRESS: POOL,
      PRIVACY_POOL_DEPLOY_BLOCK: "7",
      PRIVACY_EXPLORER_URL: "none",
    });
    expect(r.mode).toBe("multi");
    for (const n of r.networks) expect(n).toMatchObject({ rpcSource: "default", pool: null, poolSource: "none", problems: [] });
    expect(r.warnings).toEqual([
      "PRIVACY_RPC_URL has no network suffix and is ignored; set PRIVACY_RPC_URL_46630",
      "PRIVACY_POOL_ADDRESS has no network suffix and is ignored; set PRIVACY_POOL_ADDRESS_46630",
      "PRIVACY_POOL_DEPLOY_BLOCK has no network suffix and is ignored; set PRIVACY_POOL_DEPLOY_BLOCK_46630",
      "PRIVACY_EXPLORER_URL has no network suffix and is ignored; set PRIVACY_EXPLORER_URL_46630",
    ]);
    // with several networks served, the warning names each one's variable
    expect(resolve({ PRIVACY_CHAIN_IDS: "31337,31338", PRIVACY_RPC_URL: "http://127.0.0.1:8547" }).warnings).toEqual([
      "PRIVACY_RPC_URL has no network suffix and is ignored; set PRIVACY_RPC_URL_31337 or PRIVACY_RPC_URL_31338",
    ]);
    // PRIVACY_CHAIN_ID next to PRIVACY_CHAIN_IDS is ignored too
    expect(resolve({ PRIVACY_CHAIN_IDS: "31337", PRIVACY_CHAIN_ID: "31338" }).warnings).toEqual([
      "PRIVACY_CHAIN_ID is ignored because PRIVACY_CHAIN_IDS is set",
    ]);
  });

  it("never lets one network's RPC, pool or deploy block reach another network", () => {
    const r = resolve({
      PRIVACY_CHAIN_IDS: "31337,31338",
      PRIVACY_RPC_URL_31337: "http://127.0.0.1:8645",
      PRIVACY_POOL_ADDRESS_31337: POOL,
      PRIVACY_POOL_DEPLOY_BLOCK_31337: "3",
    });
    expect(only(r, 31337)).toMatchObject({ rpcUrl: "http://127.0.0.1:8645", pool: POOL, deployBlock: 3n });
    expect(only(r, 31338)).toMatchObject({ rpcUrl: "http://127.0.0.1:8546", rpcSource: "default", pool: null, deployBlock: null });
  });

  it("warns about suffixed variables of a network it does not serve", () => {
    const r = resolve({ PRIVACY_POOL_ADDRESS_31337: POOL, PRIVACY_RPC_URL_31337: "http://127.0.0.1:8545" });
    expect(r.networks.map((n) => n.network.chainId)).toEqual([46630]);
    expect(r.warnings).toEqual(["PRIVACY_RPC_URL_31337, PRIVACY_POOL_ADDRESS_31337 are ignored: Local chain A (31337) is not served"]);
  });
});

describe("resolveNetworks: per network", () => {
  it("keeps an env RPC out of the chain object and prints only its host", () => {
    const secret = "https://user:hunter2@rpc.example.com/v3/SECRETKEY?apikey=SECRET2";
    const r = resolve({ PRIVACY_CHAIN_IDS: "31337,46630", PRIVACY_RPC_URL_31337: secret, PRIVACY_RPC_URL_46630: secret });
    const local = only(r, 31337);
    expect(local).toMatchObject({ rpcUrl: secret, rpcSource: "env" });
    expect(only(r, 46630).rpcUrl).toBe(secret);
    expect(local.network.chain.rpcUrls.default.http[0]).toBe("http://127.0.0.1:8545");
    expect(robinhoodTestnet.rpcUrls.default.http[0]).toBe("https://rpc.testnet.chain.robinhood.com");
    // a local network on a non-loopback RPC is worth a warning, which names the host only
    expect(local.warnings).toEqual(["Local chain A: RPC host rpc.example.com is not a loopback address (local networks are anvil chains on this machine)"]);
    const all = JSON.stringify([r.warnings, r.networks.map((n) => n.warnings)]);
    for (const s of ["SECRETKEY", "SECRET2", "hunter2", "user:"]) expect(all).not.toContain(s);
    // not an http(s) URL
    expect(only(resolve({ PRIVACY_CHAIN_IDS: "46630", PRIVACY_RPC_URL_46630: "wss://rpc.example.com" }), 46630).warnings).toEqual([
      "PRIVACY_RPC_URL_46630 is not an http(s) URL",
    ]);
  });

  it("disables explorer links with none and accepts an explorer of the operator's choice", () => {
    expect(only(resolve({ PRIVACY_CHAIN_IDS: "46630", PRIVACY_EXPLORER_URL_46630: "none" }), 46630).explorer).toBeNull();
    expect(only(resolve({ PRIVACY_CHAIN_IDS: "46630", PRIVACY_EXPLORER_URL_46630: "NONE" }), 46630).explorer).toBeNull();
    expect(only(resolve({ PRIVACY_CHAIN_IDS: "31337", PRIVACY_EXPLORER_URL_31337: "http://127.0.0.1:5100/" }), 31337).explorer).toEqual({
      url: "http://127.0.0.1:5100",
      name: "127.0.0.1:5100",
    });
    // the network's own explorer, written with a trailing slash, keeps its name
    expect(only(resolve({ PRIVACY_EXPLORER_URL_46630: "https://explorer.testnet.chain.robinhood.com/" }), 46630).explorer).toEqual({
      url: "https://explorer.testnet.chain.robinhood.com",
      name: "Robinhood Chain Testnet Explorer",
    });
    const bad = only(resolve({ PRIVACY_CHAIN_IDS: "46630", PRIVACY_EXPLORER_URL_46630: "explorer" }), 46630);
    expect(bad.explorer).toEqual(networkById(46630)!.explorer);
    expect(bad.warnings).toEqual(['PRIVACY_EXPLORER_URL_46630 is neither "none" nor an http(s) URL; the default explorer is used']);
    expect(only(resolve({ PRIVACY_CHAIN_IDS: "31337" }), 31337).explorer).toBeNull();
  });

  describe("deploy block", () => {
    it("takes the env value first", () => {
      const r = resolve({ PRIVACY_CHAIN_IDS: "46630", PRIVACY_POOL_ADDRESS_46630: POOL, PRIVACY_POOL_DEPLOY_BLOCK_46630: "0x10" }, { 46630: record(46630) });
      expect(only(r, 46630)).toMatchObject({ pool: POOL, poolSource: "env", deployBlock: 16n, deployBlockSource: "env", problems: [] });
    });

    it("takes the record's block only when the record's pool is the resolved pool", () => {
      const fromRecord = only(resolve({}, { 46630: record(46630) }), 46630);
      expect(fromRecord).toMatchObject({ pool: POOL, poolSource: "deployment", deployBlock: 12345n, deployBlockSource: "deployment", problems: [], warnings: [] });
      // the env names the same pool (any case): still the record's pool, so its block applies
      const same = only(resolve({ PRIVACY_POOL_ADDRESS_46630: POOL.toLowerCase() }, { 46630: record(46630) }), 46630);
      expect(same).toMatchObject({ poolSource: "env", deployBlock: 12345n, deployBlockSource: "deployment", problems: [] });
      // another pool from the env never inherits the record's block (today it would, server/privacy/config.ts:30-33)
      const other = only(resolve({ PRIVACY_POOL_ADDRESS_46630: OTHER_POOL }, { 46630: record(46630) }), 46630);
      expect(other).toMatchObject({ pool: OTHER_POOL, deployBlock: null, deployBlockSource: "none", problems: ["missing_deploy_block"] });
      expect(other.warnings).toEqual([
        "PRIVACY_POOL_ADDRESS_46630 names another pool than the deployment record for Robinhood Chain Testnet; the record is not used",
      ]);
    });

    it("falls back to 0 on local networks only; a public network without one is unavailable", () => {
      const local = only(resolve({ PRIVACY_CHAIN_IDS: "31338", PRIVACY_POOL_ADDRESS_31338: POOL }), 31338);
      expect(local).toMatchObject({ deployBlock: 0n, deployBlockSource: "local", problems: [] });
      const localOther = only(resolve({ PRIVACY_CHAIN_IDS: "31337", PRIVACY_POOL_ADDRESS_31337: OTHER_POOL }, { 31337: record(31337) }), 31337);
      expect(localOther).toMatchObject({ deployBlock: 0n, deployBlockSource: "local", problems: [] });
      const rh = only(resolve({ PRIVACY_POOL_ADDRESS_46630: POOL }), 46630);
      expect(rh).toMatchObject({ pool: POOL, deployBlock: null, deployBlockSource: "none", problems: ["missing_deploy_block"] });
    });

    it("ignores a deploy block that is not a block number, and a public record's block 0", () => {
      const bad = only(resolve({ PRIVACY_POOL_ADDRESS_46630: POOL, PRIVACY_POOL_DEPLOY_BLOCK_46630: "-5" }), 46630);
      expect(bad.problems).toEqual(["missing_deploy_block"]);
      expect(bad.warnings).toEqual(["PRIVACY_POOL_DEPLOY_BLOCK_46630 is not a block number; it is ignored"]);
      const zero = only(resolve({}, { 46630: record(46630, { deployBlock: "0" }) }), 46630);
      expect(zero).toMatchObject({ deployBlock: null, problems: ["missing_deploy_block"] });
      expect(zero.warnings).toEqual(["the deployment record for Robinhood Chain Testnet gives deploy block 0; it is ignored"]);
      // 0 is a real deploy block on a fresh anvil
      expect(only(resolve({ PRIVACY_CHAIN_IDS: "31337" }, { 31337: record(31337, { deployBlock: "0" }) }), 31337)).toMatchObject({
        deployBlock: 0n,
        deployBlockSource: "deployment",
        problems: [],
      });
      // a deploy block without a pool says so
      expect(only(resolve({ PRIVACY_POOL_DEPLOY_BLOCK_46630: "9" }), 46630).warnings).toEqual([
        "PRIVACY_POOL_DEPLOY_BLOCK_46630 is set, but Robinhood Chain Testnet has no pool",
      ]);
    });

    it("refuses an env deploy block 0 on a public network like a record's 0: never a scan from genesis", () => {
      const zero = only(resolve({ PRIVACY_POOL_ADDRESS_46630: POOL, PRIVACY_POOL_DEPLOY_BLOCK_46630: "0" }), 46630);
      expect(zero).toMatchObject({ pool: POOL, deployBlock: null, deployBlockSource: "none", problems: ["missing_deploy_block"] });
      expect(zero.warnings).toEqual([
        "PRIVACY_POOL_DEPLOY_BLOCK_46630 is 0 on Robinhood Chain Testnet; a public pool is never scanned from genesis, so it is ignored",
      ]);
      // "0x0" is the same block
      expect(only(resolve({ PRIVACY_POOL_ADDRESS_46630: POOL, PRIVACY_POOL_DEPLOY_BLOCK_46630: "0x0" }), 46630).problems).toEqual([
        "missing_deploy_block",
      ]);
      // the record's own block still applies when the env names the record's pool with 0
      const withRecord = only(resolve({ PRIVACY_POOL_DEPLOY_BLOCK_46630: "0" }, { 46630: record(46630) }), 46630);
      expect(withRecord).toMatchObject({ deployBlockSource: "deployment", problems: [] });
      expect(withRecord.deployBlock).toBe(BigInt(record(46630).deployBlock));
      // (resolve() reads the VITE_ twins too and checks that both prefixes agree)
      // on a local chain, 0 is a real deploy block; so it is on an anvil on this machine that runs a public chain id
      // (the two-network e2e), where a scan from block 0 is cheap
      expect(only(resolve({ PRIVACY_CHAIN_IDS: "31337", PRIVACY_POOL_ADDRESS_31337: POOL, PRIVACY_POOL_DEPLOY_BLOCK_31337: "0" }), 31337)).toMatchObject({
        deployBlock: 0n,
        deployBlockSource: "env",
        problems: [],
      });
      const anvil46630 = only(
        resolve({ PRIVACY_RPC_URL_46630: "http://127.0.0.1:18801", PRIVACY_POOL_ADDRESS_46630: POOL, PRIVACY_POOL_DEPLOY_BLOCK_46630: "0" }),
        46630,
      );
      expect(anvil46630).toMatchObject({ deployBlock: 0n, deployBlockSource: "env", problems: [], warnings: [] });
    });
  });

  describe("problems", () => {
    it("invalid_address: a malformed, mis-checksummed or zero pool, from the env or the record", () => {
      const cases = ["0x123", "0xdC64a140Aa3E981100a9becA4E685f962f0cF6C9", "0x0000000000000000000000000000000000000000", "pool"];
      for (const v of cases) {
        const n = only(resolve({ PRIVACY_POOL_ADDRESS_46630: v, PRIVACY_POOL_DEPLOY_BLOCK_46630: "1" }), 46630);
        expect(n).toMatchObject({ pool: null, poolSource: "env", problems: ["invalid_address"] });
      }
      const rec = only(resolve({}, { 46630: record(46630, { pool: "0xnope" as Address, scope: "1" }) }), 46630);
      expect(rec).toMatchObject({ pool: null, poolSource: "deployment", problems: ["invalid_address"] });
    });

    it("anvil_account_record: a public network's record made with anvil's default accounts", () => {
      for (const field of ["owner", "aspPostman", "deployer"] as const) {
        const n = only(resolve({}, { 46630: record(46630, { [field]: ANVIL_DEFAULT_ACCOUNTS[0] }) }), 46630);
        expect(n.problems).toEqual(["anvil_account_record"]);
        expect(n.pool).toBe(POOL);
      }
      // lower case counts too
      expect(only(resolve({}, { 46630: record(46630, { owner: ANVIL_DEFAULT_ACCOUNTS[9].toLowerCase() as Address }) }), 46630).problems).toEqual([
        "anvil_account_record",
      ]);
      // on a local chain they are expected (contracts/deployments/31337.json uses account 0)
      const local = record(31337, { owner: ANVIL_DEFAULT_ACCOUNTS[0], aspPostman: ANVIL_DEFAULT_ACCOUNTS[0], deployer: ANVIL_DEFAULT_ACCOUNTS[0], deployBlock: "0" });
      expect(only(resolve({ PRIVACY_CHAIN_IDS: "31337" }, { 31337: local }), 31337).problems).toEqual([]);
      // a record the env overrides with another pool is not in use
      expect(
        only(resolve({ PRIVACY_POOL_ADDRESS_46630: OTHER_POOL, PRIVACY_POOL_DEPLOY_BLOCK_46630: "5" }, { 46630: record(46630, { owner: ANVIL_DEFAULT_ACCOUNTS[0] }) }), 46630)
          .problems,
      ).toEqual([]);
    });

    it("scope_mismatch_record: a record whose scope is not computeScope(pool, chainId)", () => {
      expect(only(resolve({}, { 46630: record(46630, { scope: "42" }) }), 46630).problems).toEqual(["scope_mismatch_record"]);
      expect(only(resolve({}, { 46630: record(46630, { scope: "not a number" }) }), 46630).problems).toEqual(["scope_mismatch_record"]);
      // a record made for another chain, filed under this one
      const moved = { ...record(31337), chainId: 46630 };
      expect(only(resolve({}, { 46630: moved }), 46630).problems).toEqual(["scope_mismatch_record"]);
      // the real local record's scope is right
      const real: PoolDeployment = {
        aspPostman: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        chainId: 31337,
        commitmentVerifier: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
        deployBlock: "0",
        minDepositWei: "0",
        owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        pool: POOL,
        scope: "12691614063895361675117108811459504883212868408867308191992060068028485866925",
        withdrawVerifier: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
      };
      expect(only(resolve({ PRIVACY_CHAIN_IDS: "31337" }, { 31337: real }), 31337).problems).toEqual([]);
    });

    it("can report several problems for one record", () => {
      const n = only(resolve({}, { 46630: record(46630, { owner: ANVIL_DEFAULT_ACCOUNTS[1], scope: "1", deployBlock: "0" }) }), 46630);
      expect(n.problems).toEqual(["missing_deploy_block", "anvil_account_record", "scope_mismatch_record"]);
    });
  });
});

describe("networkEnv (per-network values the server reads)", () => {
  const vars = { PRIVACY_RELAYER_FEE_BPS: "50", PRIVACY_RELAYER_FEE_BPS_31338: "75", PRIVACY_ASP_CONFIRMATIONS: "1", PRIVACY_LOG_CHUNK_46630: " " };

  it("falls back to the shared value for keys and fees, in both modes", () => {
    expect(networkEnv(serverRead(vars), "PRIVACY_RELAYER_FEE_BPS", 31338, { mode: "multi", fallback: "always" })).toBe("75");
    expect(networkEnv(serverRead(vars), "PRIVACY_RELAYER_FEE_BPS", 46630, { mode: "multi", fallback: "always" })).toBe("50");
  });

  it("never lets a global value weaken another network in multi mode", () => {
    expect(networkEnv(serverRead(vars), "PRIVACY_ASP_CONFIRMATIONS", 31338, { mode: "multi", fallback: "legacy" })).toBeUndefined();
    expect(networkEnv(serverRead(vars), "PRIVACY_ASP_CONFIRMATIONS", 31337, { mode: "legacy", fallback: "legacy" })).toBe("1");
    expect(networkEnv(serverRead(vars), "PRIVACY_LOG_CHUNK", 46630, { mode: "legacy", fallback: "legacy" })).toBeUndefined();
  });
});

// ─── reorg-safe event sync ────────────────────────────────────────────────────

const tx = (n: number): Hex => keccak256(toBytes(`networks-tx-${n}`));
const deposit = (leafIndex: number, blockNumber: bigint, logIndex: number, txN = leafIndex): PoolEvent => ({
  kind: "deposit",
  depositor: OWNER,
  commitment: 1_000n + BigInt(txN),
  label: 7n + BigInt(txN),
  value: 10n ** 17n,
  precommitment: 3n,
  leafIndex,
  blockNumber,
  txHash: tx(txN),
  logIndex,
});
const root = (blockNumber: bigint, logIndex: number): PoolEvent => ({ kind: "asproot", root: 5n, cid: "c", blockNumber, txHash: tx(900), logIndex });
const where = (events: PoolEvent[]) => events.map((e) => `${e.kind}@${e.blockNumber}:${e.logIndex}`);

describe("nextScanRange", () => {
  it("scans from the deploy block without a cache", () => {
    expect(nextScanRange({ deployBlock: 100n, lastBlock: null, head: 150n, reorgWindow: 12 })).toEqual({ from: 100n, to: 150n });
  });

  it("re-scans the trailing reorg window, never below the deploy block", () => {
    expect(nextScanRange({ deployBlock: 100n, lastBlock: 150n, head: 160n, reorgWindow: 12 })).toEqual({ from: 139n, to: 160n });
    expect(nextScanRange({ deployBlock: 100n, lastBlock: 105n, head: 160n, reorgWindow: 20 })).toEqual({ from: 100n, to: 160n });
    expect(nextScanRange({ deployBlock: 0n, lastBlock: 3n, head: 9n, reorgWindow: 20 })).toEqual({ from: 0n, to: 9n });
    expect(nextScanRange({ deployBlock: 0n, lastBlock: 9n, head: 12n, reorgWindow: 0 })).toEqual({ from: 10n, to: 12n });
  });

  it("keeps the cache when the head is below the last scanned block", () => {
    expect(nextScanRange({ deployBlock: 100n, lastBlock: 150n, head: 149n, reorgWindow: 12 })).toBeNull();
    // the same head scans the window again (nothing new without one)
    expect(nextScanRange({ deployBlock: 100n, lastBlock: 150n, head: 150n, reorgWindow: 12 })).toEqual({ from: 139n, to: 150n });
    expect(nextScanRange({ deployBlock: 0n, lastBlock: 9n, head: 9n, reorgWindow: 0 })).toEqual({ from: 10n, to: 9n });
  });
});

describe("headRegression (a head below the cache)", () => {
  it("keeps the cache inside the reorg window; beyond it, or on a chain without one, scans again from the deploy block", () => {
    expect(headRegression({ lastBlock: 20n, head: 20n, reorgWindow: 3 })).toBe("keep");
    expect(headRegression({ lastBlock: 20n, head: 17n, reorgWindow: 3 })).toBe("keep"); // a node 3 blocks behind
    expect(headRegression({ lastBlock: 20n, head: 16n, reorgWindow: 3 })).toBe("rescan");
    expect(headRegression({ lastBlock: 20n, head: 19n, reorgWindow: 0 })).toBe("rescan"); // a local chain restarted or reverted
    expect(headRegression({ lastBlock: 154_136_400n, head: 5n, reorgWindow: 20 })).toBe("rescan"); // a regenesis
    expect(headRegression({ lastBlock: 20n, head: 25n, reorgWindow: 0 })).toBe("keep"); // not a fall at all
  });
});

describe("fetchPoolEvents with several calls in flight", () => {
  const POOL_ADDR = "0x2222222222222222222222222222222222222222" as Address;
  /** A fake RPC: one deposit per listed block; spans above `limit` blocks fail the way providers word it. */
  function fakeRpc(blocks: bigint[], limit: bigint) {
    const calls: [bigint, bigint][] = [];
    const client = {
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        calls.push([fromBlock, toBlock]);
        if (toBlock - fromBlock + 1n > limit) throw new Error(`query spans ${toBlock - fromBlock + 1n} blocks, but only ${limit} are allowed; narrow the block range`);
        return blocks
          .map((b, i) => ({ b, i }))
          .filter(({ b }) => b >= fromBlock && b <= toBlock)
          .map(({ b, i }) => ({
            eventName: "Deposited",
            args: { depositor: POOL_ADDR, commitment: 1_000n + BigInt(i), label: 7n, value: 1n, precommitment: 9n, leafIndex: i },
            blockNumber: b,
            transactionHash: tx(i),
            logIndex: 0,
          }));
      },
    };
    return { client: client as never, calls };
  }
  const blocks = [3n, 17n, 18n, 41n, 99n, 100n];

  it("finds the same events as one call at a time, in chain order, with fewer rounds", async () => {
    const one = fakeRpc(blocks, 1_000n);
    const many = fakeRpc(blocks, 1_000n);
    const a = await fetchPoolEvents(one.client, POOL_ADDR, 0n, 100n, { chunkSize: 10n, minChunkSize: 5n });
    const b = await fetchPoolEvents(many.client, POOL_ADDR, 0n, 100n, { chunkSize: 10n, minChunkSize: 5n, concurrency: 4 });
    expect(b).toEqual(a);
    expect(b.map((e) => e.blockNumber)).toEqual(blocks);
    expect(many.calls).toHaveLength(one.calls.length); // the same 11 chunks, 4 at a time
    expect(many.calls[0]).toEqual([0n, 9n]);
  });

  it("halves the chunk on a range error and starts again at the first chunk that failed, keeping nothing twice", async () => {
    const rpc = fakeRpc(blocks, 7n); // the provider allows 7 blocks: chunks of 10 fail, 5 pass
    const progress: [bigint, bigint, number][] = [];
    const events = await fetchPoolEvents(rpc.client, POOL_ADDR, 0n, 100n, {
      chunkSize: 10n,
      minChunkSize: 5n,
      concurrency: 4,
      onProgress: (from, to, evs) => progress.push([from, to, evs.length]),
    });
    expect(events.map((e) => e.blockNumber)).toEqual(blocks);
    expect(new Set(events.map((e) => e.txHash)).size).toBe(blocks.length);
    // progress comes in block order, as a run of chunks without a gap, and covers the whole range once
    expect(progress[0][0]).toBe(0n);
    for (let i = 1; i < progress.length; i++) expect(progress[i][0]).toBe(progress[i - 1][1] + 1n);
    expect(progress.at(-1)![1]).toBe(100n);
    expect(progress.reduce((n, p) => n + p[2], 0)).toBe(blocks.length);
  });

  it("throws anything but a range error, after keeping the progress of the chunks before it", async () => {
    const rpc = fakeRpc(blocks, 1_000n);
    const failing = {
      getLogs: (o: { fromBlock: bigint; toBlock: bigint }) =>
        o.fromBlock >= 30n ? Promise.reject(new Error("HTTP request failed. (connection reset)")) : (rpc.client as { getLogs: (x: unknown) => Promise<unknown> }).getLogs(o),
    } as never;
    const done: bigint[] = [];
    await expect(
      fetchPoolEvents(failing, POOL_ADDR, 0n, 100n, { chunkSize: 10n, concurrency: 4, onProgress: (_f, to) => done.push(to) }),
    ).rejects.toThrow("HTTP request failed");
    expect(done).toEqual([9n, 19n, 29n]);
  });
});

describe("mergePoolEvents", () => {
  it("replaces everything from the scan's first block and keeps chain order", () => {
    const cached = [deposit(0, 10n, 0), deposit(1, 20n, 1), root(20n, 2), deposit(2, 30n, 0)];
    const fresh = [deposit(2, 30n, 0), deposit(3, 31n, 4), deposit(4, 31n, 1, 5)];
    const merged = mergePoolEvents(cached, fresh, 25n);
    expect(where(merged)).toEqual(["deposit@10:0", "deposit@20:1", "asproot@20:2", "deposit@30:0", "deposit@31:1", "deposit@31:4"]);
    expect(stateLeaves(merged)).toHaveLength(5);
    expect(cached).toHaveLength(4); // inputs untouched
  });

  it("keeps one copy of a transaction a reorg moved to another block and log index", () => {
    // cached: leaf 2 at block 100, log 3. After a reorg the same transaction lands in block 101 at log 0.
    const cached = [deposit(0, 90n, 0), deposit(1, 95n, 0), deposit(2, 100n, 3)];
    const range = nextScanRange({ deployBlock: 0n, lastBlock: 100n, head: 104n, reorgWindow: 12 })!;
    expect(range).toEqual({ from: 89n, to: 104n });
    const fresh = [deposit(0, 90n, 0), deposit(1, 95n, 0), deposit(2, 101n, 0)];
    const merged = mergePoolEvents(cached, fresh, range.from);
    expect(merged.filter((e) => e.txHash === tx(2))).toHaveLength(1);
    expect(where(merged)).toEqual(["deposit@90:0", "deposit@95:0", "deposit@101:0"]);
    expect(stateLeaves(merged)).toEqual([1_000n, 1_001n, 1_002n]);
    // matching on (txHash, logIndex) would keep both copies, and the leaves would no longer be contiguous
    const keyed = new Map([...cached, ...fresh].map((e) => [`${e.txHash}:${e.logIndex}`, e]));
    expect(() => stateLeaves([...keyed.values()])).toThrow(/state tree gap/);
  });

  it("never duplicates events when the head falls back", () => {
    let cache = { events: [deposit(0, 5n, 0), deposit(1, 8n, 0)], lastBlock: 10n };
    const sync = (head: bigint, chain: PoolEvent[]) => {
      const range = nextScanRange({ deployBlock: 0n, lastBlock: cache.lastBlock, head, reorgWindow: 0 });
      if (!range) return; // keep the cache
      const fresh = chain.filter((e) => e.blockNumber >= range.from && e.blockNumber <= range.to);
      cache = { events: mergePoolEvents(cache.events, fresh, range.from), lastBlock: head };
    };
    const chain = [deposit(0, 5n, 0), deposit(1, 8n, 0), deposit(2, 12n, 0)];
    sync(7n, chain); // a lagging RPC answers with an older head
    expect(cache.lastBlock).toBe(10n);
    sync(12n, chain);
    expect(where(cache.events)).toEqual(["deposit@5:0", "deposit@8:0", "deposit@12:0"]);
    expect(stateLeaves(cache.events)).toHaveLength(3);
    // the old rule (lastBlock follows the lower head, then resume at lastBlock + 1) fetches block 8 twice
    const naive = [...[deposit(0, 5n, 0), deposit(1, 8n, 0)], ...chain.filter((e) => e.blockNumber >= 8n)];
    expect(() => stateLeaves(naive)).toThrow(/state tree gap/);
  });

  it("leaves a leaf gap visible when a scan was incomplete (stateLeaves fails closed)", () => {
    const cached = [deposit(0, 10n, 0)];
    const merged = mergePoolEvents(cached, [deposit(2, 40n, 0)], 11n); // leaf 1 (block 30) missing from the scan
    expect(() => stateLeaves(merged)).toThrow("state tree gap: expected leaf 1, got 2");
  });
});

// ─── the browser config ───────────────────────────────────────────────────────

type ClientConfig = typeof import("../../client/src/privacy/config");

/**
 * The browser config, built from `vars` (as VITE_ variables) and `deployments` alone. Vite loads the developer's own
 * .env into import.meta.env, and shared/privacy/deployments.ts holds whatever pool is live: neither may reach these
 * cases, so every VITE_PRIVACY_* variable is blanked (blank counts as unset) and the records are replaced.
 */
async function clientConfig(vars: Vars, deployments: Record<number, PoolDeployment> = {}): Promise<ClientConfig> {
  vi.resetModules();
  const env = import.meta.env as Record<string, unknown>;
  for (const k of Object.keys(env)) if (k.startsWith("VITE_PRIVACY_")) vi.stubEnv(k, "");
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(`VITE_${k}`, v);
  vi.doMock("../../shared/privacy/deployments", () => ({ DEPLOYMENTS: deployments }));
  return import("../../client/src/privacy/config");
}

describe("client config (client/src/privacy/config.ts)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("../../shared/privacy/deployments");
    vi.resetModules();
  });

  it("offers Robinhood Chain Testnet alone, pending, with no VITE_ variable: one network, no network choice", async () => {
    const c = await clientConfig({});
    expect(c.PRIVACY_CONFIG_MODE).toBe("multi");
    expect(c.PRIVACY_NETWORKS.map((n) => [n.network.chainId, n.pool, n.problem])).toEqual([[46630, null, null]]);
    expect(c.PRIVACY_POOLS).toEqual([]);
    // one network: the UI shows no filter, switcher, chip or per-network breakdown, and names the network where it informs
    expect(c.MULTI_NETWORK).toBe(false);
    expect(c.ONLY_NETWORK?.chainId).toBe(46630);
    // (a fresh module graph: compare by value) the chain objects keep their public default RPC
    const first = c.PRIVACY_NETWORKS[0].network.chain;
    expect([first.id, first.name, first.rpcUrls.default.http[0]]).toEqual([
      robinhoodTestnet.id,
      robinhoodTestnet.name,
      robinhoodTestnet.rpcUrls.default.http[0],
    ]);
    expect(c.rpcUrlFor(46630)).toBe("https://rpc.testnet.chain.robinhood.com");
    expect(() => c.rpcUrlFor(31337)).toThrow(/not built for network 31337/);
    expect(c.explorerTxUrl(46630, "0xabc")).toBe("https://explorer.testnet.chain.robinhood.com/tx/0xabc");
    expect(c.explorerAddressUrl(46630, POOL)).toBe(`https://explorer.testnet.chain.robinhood.com/address/${POOL}`);
    expect(c.explorerAddressUrl(31337, POOL)).toBeNull(); // not offered, no explorer
    expect(c.explorerTxUrl(1, "0xabc")).toBe("https://etherscan.io/tx/0xabc");
    expect(c.explorerTxUrl(999, "0xabc")).toBeNull();
    expect(c.DEVICE_KEYS).toEqual({
      vault: "hylsia.pp.vault.v2",
      backupVerified: "hylsia.pp.backupVerified.v2",
      activity: "hylsia.pp.activity.v3", // encrypted with a key from the seed
      legacyActivity: "hylsia.pp.activity.v2", // the older plaintext log, read on unlock only to be moved
      activityQuarantine: "hylsia.pp.activity.quarantine",
    });
    // a pending network is offered (wallet transports need its RPC), so a read-only client can be made; creating it sends nothing
    expect(c.publicClientFor(46630)).toBe(c.publicClientFor(46630));
    // the single-network shims are gone after integration
    for (const name of ["PRIVACY_CHAIN_ID", "PRIVACY_CHAIN", "PRIVACY_POOL_ADDRESS", "PRIVACY_RPC_URL", "PRIVACY_DEPLOY_BLOCK", "EXPLORER_URL", "privacyPublicClient", "storageKey", "txUrl", "addressUrl"]) {
      expect(c).not.toHaveProperty(name);
    }
  });

  it("serves the recorded pool with no VITE_ variable", async () => {
    const c = await clientConfig({}, { 46630: record(46630) });
    expect(c.PRIVACY_NETWORKS.map((n) => [n.network.chainId, n.pool?.pool ?? null, n.problem])).toEqual([[46630, POOL, null]]);
    expect(c.PRIVACY_POOLS).toHaveLength(1);
    expect(c.PRIVACY_POOLS[0]).toMatchObject({ chainId: 46630, pool: POOL, deployBlock: 12345n, rpcUrl: "https://rpc.testnet.chain.robinhood.com" });
    expect(c.poolBySlug("robinhood-testnet")).toBe(c.PRIVACY_POOLS[0]);
    expect(c.MULTI_NETWORK).toBe(false);
  });

  it("keeps two pools at one address on two chains apart", async () => {
    const c = await clientConfig({
      PRIVACY_CHAIN_IDS: "31337,31338",
      PRIVACY_RPC_URL_31337: "http://127.0.0.1:8645",
      PRIVACY_RPC_URL_31338: "http://127.0.0.1:8646",
      PRIVACY_POOL_ADDRESS_31337: POOL,
      PRIVACY_POOL_ADDRESS_31338: POOL.toLowerCase(),
      PRIVACY_POOL_DEPLOY_BLOCK_31338: "4",
    });
    const [a, b] = c.PRIVACY_POOLS;
    expect(c.PRIVACY_POOLS).toHaveLength(2);
    expect(a).toMatchObject({ chainId: 31337, pool: POOL, key: poolKey(31337, POOL), deployBlock: 0n, rpcUrl: "http://127.0.0.1:8645", explorer: null });
    expect(b).toMatchObject({ chainId: 31338, pool: POOL, key: poolKey(31338, POOL), deployBlock: 4n, rpcUrl: "http://127.0.0.1:8646" });
    expect(a.scope).toBe(computeScope(POOL, 31337));
    expect(b.scope).toBe(computeScope(POOL, 31338));
    expect(a.scope).not.toBe(b.scope);
    expect(c.findPool(31338, POOL.toLowerCase() as Address)).toBe(b);
    expect(c.findPool(46630, POOL)).toBeNull(); // registry only
    expect(c.poolBySlug("local-b")).toBe(b);
    expect(c.poolBySlug("robinhood-testnet")).toBeNull(); // not offered by this build
    expect(c.poolRefByKey(`31337:${POOL.toUpperCase().replace("0X", "0x")}`)).toBe(a);
    expect(c.poolRefByKey(POOL)).toBeNull();
    expect(c.poolStorageKey(b, "pendingDeposits")).toBe(`hylsia.pp.31338.${POOL.toLowerCase()}.pendingDeposits`);
    expect(c.poolStorageKey(a, "events")).not.toBe(c.poolStorageKey(b, "events"));
    // one memoized read-only client per chain, on that chain's RPC; never for a network the build does not offer
    const client = c.publicClientFor(31338);
    expect(c.publicClientFor(31338)).toBe(client);
    expect(client.chain?.id).toBe(31338);
    expect(client.chain?.rpcUrls.default.http[0]).toBe("http://127.0.0.1:8546");
    expect(() => c.publicClientFor(46630)).toThrow(/not built for network 46630/);
    expect(c.explorerTxUrl(31337, "0xabc")).toBeNull();
    // the first offered network comes first, in registry order; two networks: the UI offers a choice
    expect(c.PRIVACY_NETWORKS.map((n) => n.network.chainId)).toEqual([31337, 31338]);
    expect(c.MULTI_NETWORK).toBe(true);
    expect(c.ONLY_NETWORK).toBeNull();
    expect(c.rpcUrlFor(31337)).toBe("http://127.0.0.1:8645");
  });

  it("gives a network with a problem no pool, so nothing reads it", async () => {
    const c = await clientConfig({ PRIVACY_POOL_ADDRESS_46630: POOL }); // a public pool without a deploy block
    expect(c.PRIVACY_NETWORKS.map((n) => [n.network.chainId, n.pool, n.problem])).toEqual([[46630, null, "missing_deploy_block"]]);
    expect(c.PRIVACY_POOLS).toEqual([]);
    expect(c.findPool(46630, POOL)).toBeNull();
    const two = await clientConfig({ PRIVACY_CHAIN_IDS: "31337,31338", PRIVACY_POOL_ADDRESS_31338: "0x1234" });
    expect(two.PRIVACY_NETWORKS.map((n) => [n.network.chainId, n.pool, n.problem])).toEqual([
      [31337, null, null],
      [31338, null, "invalid_address"],
    ]);
  });

  it("reads a legacy single-network build exactly as before", async () => {
    const c = await clientConfig({ PRIVACY_CHAIN_ID: "31337", PRIVACY_POOL_ADDRESS: POOL.toLowerCase(), PRIVACY_POOL_DEPLOY_BLOCK: "12" });
    expect(c.PRIVACY_CONFIG_MODE).toBe("legacy");
    expect(c.PRIVACY_NETWORKS).toHaveLength(1);
    const [ref] = c.PRIVACY_POOLS;
    expect(c.PRIVACY_POOLS).toHaveLength(1);
    expect([ref.network.chain.id, ref.network.chain.name]).toEqual([anvil.id, anvil.name]);
    expect(ref).toMatchObject({ chainId: 31337, pool: POOL, deployBlock: 12n, rpcUrl: "http://127.0.0.1:8545", explorer: null });
    // today's per-pool storage format, so a legacy build's event cache survives
    expect(c.poolStorageKey(ref, "events")).toBe(`hylsia.pp.31337.${POOL.toLowerCase()}.events`);
    expect(c.explorerTxUrl(31337, "0xabc")).toBeNull();
  });
});
