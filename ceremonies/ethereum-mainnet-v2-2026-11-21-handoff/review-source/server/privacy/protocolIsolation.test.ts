import { afterEach, describe, expect, it, vi } from "vitest";
import { DEPLOYMENTS } from "../../shared/privacy/deployments";
import { PROTOCOL_VERSION } from "../../shared/privacy/constants";
import {
  resolveNetworks,
  resolveViteNetworks,
} from "../../shared/privacy/networks";
import { V2_PROTOCOL } from "../../shared/privacy/protocols";

const calls = vi.hoisted(() => ({
  getPublicClient: vi.fn(() => {
    throw new Error("Wrong protocol must not contact RPC");
  }),
}));
vi.mock("./chain", () => ({
  ...calls,
  makeWalletClient: vi.fn(() => {
    throw new Error("Wrong protocol must not load a signer");
  }),
}));
const read = (env: Record<string, string>) => (name: string) => env[name];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("../../shared/privacy/deployments");
  vi.resetModules();
  vi.clearAllMocks();
});

describe("active runtime protocol isolation", () => {
  it("rejects v2 and unknown deployment protocols through the server and browser resolvers", () => {
    for (const protocol of [V2_PROTOCOL, "hylsia-pp-v99", ""]) {
      const deployments = { 46630: { ...DEPLOYMENTS[46630], protocol } };
      const server = resolveNetworks(
        read({ PRIVACY_CHAIN_IDS: "46630" }),
        deployments
      );
      const browser = resolveViteNetworks(
        { VITE_PRIVACY_CHAIN_IDS: "46630" },
        deployments
      );
      expect(server.networks[0].problems).toContain("protocol_mismatch_record");
      expect(browser.networks[0].problems).toContain(
        "protocol_mismatch_record"
      );
      expect(server.networks[0].warnings.join(" ")).toContain(PROTOCOL_VERSION);
    }
  });

  it("retains explicit v1 records and legacy records without a protocol field", () => {
    for (const protocol of [PROTOCOL_VERSION, undefined]) {
      const deployments = { 46630: { ...DEPLOYMENTS[46630], protocol } };
      expect(
        resolveNetworks(read({}), deployments).networks[0].problems
      ).toEqual([]);
    }
  });

  it("does not bypass an incompatible record by overriding its same pool address", () => {
    const record = { ...DEPLOYMENTS[46630], protocol: V2_PROTOCOL };
    const result = resolveNetworks(
      read({
        PRIVACY_CHAIN_IDS: "46630",
        PRIVACY_POOL_ADDRESS_46630: record.pool,
      }),
      { 46630: record }
    );
    expect(result.networks[0].problems).toContain("protocol_mismatch_record");
  });

  it("exposes no transactable browser pool and no available server pool for a v2 record", async () => {
    const deployments = {
      46630: { ...DEPLOYMENTS[46630], protocol: V2_PROTOCOL },
    };
    vi.doMock("../../shared/privacy/deployments", () => ({
      DEPLOYMENTS: deployments,
    }));
    vi.stubEnv("PRIVACY_CHAIN_IDS", "46630");
    vi.stubEnv("VITE_PRIVACY_CHAIN_IDS", "46630");
    const config = await import("../../client/src/privacy/config");
    expect(config.PRIVACY_POOLS).toEqual([]);
    expect(config.PRIVACY_NETWORKS[0].problem).toBe("protocol_mismatch_record");
    const { getNetworks } = await import("./pools");
    expect((await getNetworks()).networks).toEqual([
      {
        chainId: 46630,
        configured: true,
        available: false,
        pool: deployments[46630].pool,
        reason: "config_error",
      },
    ]);
    expect(calls.getPublicClient).not.toHaveBeenCalled();
  });
});
