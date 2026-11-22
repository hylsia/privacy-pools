import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import { robinhoodMainnet, robinhoodTestnet } from "../../shared/privacy/chains";
import { DEPLOYMENTS } from "../../shared/privacy/deployments";
import { computeScope } from "../../shared/privacy/context";
import { mainnetReleaseRefusal } from "../../shared/privacy/mainnetRelease";
import { networkById, resolveNetworks } from "../../shared/privacy/networks";

const POOL = getAddress("0x1111111111111111111111111111111111111111");
const rpcCalls = vi.hoisted(() => ({ getPublicClient: vi.fn(() => { throw new Error("Blocked mainnet must not access RPC"); }) }));
vi.mock("./chain", () => ({ ...rpcCalls, makeWalletClient: vi.fn(() => { throw new Error("Blocked mainnet must not create a signer"); }) }));
const read = (vars: Record<string, string>) => (name: string) => vars[name];
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("Robinhood Chain mainnet migration", () => {
  it("uses chain 4663 and the official RPC/explorer, without a faucet or invented deployment", () => {
    const n = networkById(4663)!;
    expect(n.chain).toBe(robinhoodMainnet);
    expect(n.chain.testnet).toBe(false);
    expect(n.defaultRpcUrl).toBe("https://rpc.mainnet.chain.robinhood.com");
    expect(n.explorer?.url).toBe("https://robinhoodchain.blockscout.com");
    expect(n.faucet).toBeNull();
    expect(DEPLOYMENTS[4663]).toBeUndefined();
  });

  it("never inherits the existing testnet pool when selecting mainnet", () => {
    const r = resolveNetworks(read({ PRIVACY_CHAIN_IDS: "4663" }), DEPLOYMENTS);
    expect(r.networks).toHaveLength(1);
    expect(r.networks[0]).toMatchObject({ pool: null, deployBlock: null, problems: [] });
  });

  it("cannot enable development contracts with a mainnet address override or a valid-looking record", () => {
    const vars = { PRIVACY_CHAIN_IDS: "4663", PRIVACY_POOL_ADDRESS_4663: POOL, PRIVACY_POOL_DEPLOY_BLOCK_4663: "123" };
    expect(resolveNetworks(read(vars), {}).networks[0].problems).toContain("mainnet_release_blocked");
    const record = { ...DEPLOYMENTS[46630], chainId: 4663, pool: POOL, scope: computeScope(POOL,4663).toString() };
    const r = resolveNetworks(read({ PRIVACY_CHAIN_IDS: "4663" }), { 4663: record });
    expect(r.networks[0].problems).toContain("mainnet_release_blocked");
    expect(r.networks[0].warnings.join(" ")).toContain("H-01");
  });

  it("offers no transactable browser pool while mainnet is release-blocked", async () => {
    vi.stubEnv("VITE_PRIVACY_CHAIN_IDS", "4663");
    vi.stubEnv("VITE_PRIVACY_POOL_ADDRESS_4663", POOL);
    vi.stubEnv("VITE_PRIVACY_POOL_DEPLOY_BLOCK_4663", "123");
    const config = await import("../../client/src/privacy/config");
    expect(config.ONLY_NETWORK?.chainId).toBe(4663);
    expect(config.PRIVACY_POOLS).toEqual([]);
    expect(config.PRIVACY_NETWORKS[0].problem).toBe("mainnet_release_blocked");
  });

  it("retains the testnet path while refusing the current protocol for real-fund chains", () => {
    expect(mainnetReleaseRefusal(robinhoodTestnet)).toBeNull();
    expect(mainnetReleaseRefusal(robinhoodMainnet)).toContain("development trusted setup");
  });

  it("reports a blocked server pool as unavailable without contacting its RPC", async () => {
    vi.stubEnv("PRIVACY_CHAIN_IDS", "4663");
    vi.stubEnv("PRIVACY_POOL_ADDRESS_4663", POOL);
    vi.stubEnv("PRIVACY_POOL_DEPLOY_BLOCK_4663", "123");
    const { getNetworks } = await import("./pools");
    const result = await getNetworks();
    expect(result.networks).toEqual([{ chainId: 4663, configured: true, available: false, pool: POOL, reason: "config_error" }]);
    expect(rpcCalls.getPublicClient).not.toHaveBeenCalled();
  });

  it("rejects mainnet broadcast before parsing an RPC URL or loading a signer", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/privacy/deploy.ts", "--network", "robinhood-mainnet", "--broadcast", "--account", "does-not-exist", "--sender", POOL, "--rpc-url", "invalid-url"], { encoding: "utf8", timeout: 15_000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Mainnet release blocked");
    expect(result.stderr).toContain("H-01");
    expect(result.stderr).not.toContain("the RPC is not a URL");
    expect(result.stdout).not.toContain("Deploying");
  });
});
