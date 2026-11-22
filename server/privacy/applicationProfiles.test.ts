import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPLICATION_DEPLOYMENTS,
  ETHEREUM_APPLICATION_RELEASE as record,
  applicationProfileHref,
  applicationProfileReader,
  isAuthorizedApplicationRelease,
  resolveApplicationNetworks,
  selectedApplicationProfile,
} from "../../shared/privacy/applicationProfiles";
import { loadPrivacyConfig } from "./config";
import { V2_ETH_PROTOCOL } from "../../shared/privacy/protocols";
import { poolsForProfile } from "../../client/src/privacy/profileData";
import type { PoolsAnswer } from "../../shared/privacy/api";

const read = (vars: Record<string, string>) => (name: string) => vars[name];
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("explicit testnet / Ethereum application profiles", () => {
  it("selects only a single whitelisted environment, never a protocol, arbitrary pool or duplicate parameter", () => {
    expect(selectedApplicationProfile("?environment=ethereum-mainnet")).toBe(
      "ethereum-mainnet"
    );
    expect(
      selectedApplicationProfile(
        "?action=withdraw&environment=robinhood-testnet"
      )
    ).toBe("robinhood-testnet");
    expect(
      selectedApplicationProfile("", `/pools/ethereum-mainnet/${record.pool}`)
    ).toBe("ethereum-mainnet");
    for (const value of [
      "?environment=4663",
      "?environment=hylsia-pp-v1",
      "?environment=ethereum-mainnet&environment=robinhood-testnet",
      "",
    ])
      expect(selectedApplicationProfile(value)).toBeNull();
  });
  it("keeps the chosen environment, action and hash in same-origin links without rewriting external links", () => {
    expect(
      applicationProfileHref(
        "/pools/vault?action=withdraw#notes",
        "ethereum-mainnet"
      )
    ).toBe("/pools/vault?action=withdraw&environment=ethereum-mainnet#notes");
    expect(
      applicationProfileHref("//another.example/pools", "ethereum-mainnet")
    ).toBe("//another.example/pools");
    expect(
      applicationProfileHref("https://etherscan.io/", "ethereum-mainnet")
    ).toBe("https://etherscan.io/");
  });
  it("requires explicit activation and permits only the actually deployed native ETH package", () => {
    const vars = { PRIVACY_CHAIN_IDS: "1", PRIVACY_PROTOCOL: V2_ETH_PROTOCOL };
    expect(resolveApplicationNetworks(read(vars)).networks[0].pool).toBeNull();
    const activated = resolveApplicationNetworks(
      read({ ...vars, PRIVACY_ENABLE_MAINNET_APP: "true" })
    ).networks[0];
    expect(activated.pool).toBe(record.pool);
    expect(activated.problems).toEqual([]);
    expect(activated.warnings.join(" ")).toContain("not independently audited");
    for (const changed of [
      { ...record, chainId: 4663 },
      { ...record, protocol: "hylsia-pp-v1" },
      {
        ...record,
        pool: "0x1111111111111111111111111111111111111111" as const,
      },
      { ...record, releaseId: "a".repeat(64) },
      { ...record, artifactManifestSha256: "b".repeat(64) },
      {
        ...record,
        vkeySha256: {
          withdraw: "c".repeat(64),
          commitment: record.vkeySha256!.commitment,
        },
      },
    ])
      expect(isAuthorizedApplicationRelease(changed)).toBe(false);
    expect(isAuthorizedApplicationRelease(record)).toBe(true);
  });
  it("keeps address substitutions and v1 on Ethereum blocked even when the application feature is enabled", () => {
    const vars = {
      PRIVACY_CHAIN_IDS: "1",
      PRIVACY_PROTOCOL: V2_ETH_PROTOCOL,
      PRIVACY_ENABLE_MAINNET_APP: "true",
    };
    expect(
      resolveApplicationNetworks(
        read({
          ...vars,
          PRIVACY_POOL_ADDRESS_1: "0x1111111111111111111111111111111111111111",
          PRIVACY_POOL_DEPLOY_BLOCK_1: record.deployBlock,
        })
      ).networks[0].problems
    ).toContain("mainnet_release_blocked");
    expect(
      resolveApplicationNetworks(
        read({ ...vars, PRIVACY_PROTOCOL: "hylsia-pp-v1" })
      ).networks[0].problems
    ).toContain("mainnet_release_blocked");
  });
  it("serves each protocol on its own chain and never inherits testnet or deployment signing keys into Ethereum", () => {
    const key = "0x" + "01".repeat(32);
    const vars = {
      PRIVACY_CHAIN_IDS: "46630",
      PRIVACY_ENABLE_MAINNET_APP: "true",
      PRIVACY_RELAYER_PRIVATE_KEY: key,
      PRIVACY_ASP_POSTMAN_PRIVATE_KEY: key,
    };
    const reader = vi.fn((name: string) => {
      if (name === "DEPLOY_PRIVATE_KEY_MAINNET")
        throw new Error("Deployment key accessed");
      return read(vars)(name);
    });
    const config = loadPrivacyConfig(reader);
    expect(config.byChainId.get(46630)?.protocol).toBe("hylsia-pp-v1");
    expect(config.byChainId.get(1)).toMatchObject({
      protocol: V2_ETH_PROTOCOL,
      pool: record.pool,
      problems: [],
      relayerPrivateKey: null,
      aspPostmanPrivateKey: null,
    });
    expect(config.byChainId.get(46630)?.aspPostmanPrivateKey).toBe(key);
    expect(
      applicationProfileReader(
        reader,
        "ethereum-mainnet"
      )("PRIVACY_ASP_POSTMAN_PRIVATE_KEY")
    ).toBeUndefined();
  });
  it("does not add public RPCs to disposable local E2E configurations", () => {
    const config = loadPrivacyConfig(
      read({ PRIVACY_CHAIN_IDS: "31337", PRIVACY_ENABLE_MAINNET_APP: "true" })
    );
    expect(config.chains.map(chain => chain.chainId)).toEqual([31337]);
  });
  it("keeps testnet usable when the hosting environment initially selects the native mainnet protocol", () => {
    const config = loadPrivacyConfig(read({ PRIVACY_CHAIN_IDS: "1", PRIVACY_PROTOCOL: V2_ETH_PROTOCOL, PRIVACY_ENABLE_MAINNET_APP: "true" }));
    expect(config.byChainId.get(1)).toMatchObject({ protocol: V2_ETH_PROTOCOL, problems: [] });
    expect(config.byChainId.get(46630)).toMatchObject({ protocol: "hylsia-pp-v1", problems: [] });
  });
  it("offers the authorized application in production by default, with an explicit opt-out", () => {
    const production = { NODE_ENV: "production", PRIVACY_CHAIN_IDS: "46630" };
    expect(loadPrivacyConfig(read(production)).byChainId.get(1)?.pool).toBe(
      record.pool
    );
    expect(
      loadPrivacyConfig(
        read({ ...production, PRIVACY_ENABLE_MAINNET_APP: "false" })
      ).byChainId.has(1)
    ).toBe(false);
  });
  it("never mixes real ETH pool totals or crowds with testnet rows from a shared server response", () => {
    const testnet = APPLICATION_DEPLOYMENTS[46630];
    const answer = {
      now: 10,
      networks: [
        { chainId: 1, pool: record.pool },
        { chainId: 46630, pool: testnet.pool },
      ],
      pools: [
        { chainId: 1, pool: record.pool, tvl: 2n },
        { chainId: 46630, pool: testnet.pool, tvl: 999n },
      ],
      unavailable: [],
    } as unknown as PoolsAnswer;
    const selected = poolsForProfile(answer, [
      { network: { chainId: 1 }, pool: record },
    ]);
    expect(selected.pools.map(pool => pool.tvl)).toEqual([2n]);
    expect(selected.networks.map(network => network.chainId)).toEqual([1]);
    expect(answer.pools).toHaveLength(2);
  });
  it("uses a distinct native ETH vault and pinned final artifacts after an explicit mainnet selection", async () => {
    vi.stubEnv("VITE_PRIVACY_ENABLE_MAINNET_APP", "true");
    vi.stubEnv("VITE_PRIVACY_CHAIN_IDS", "46630");
    vi.stubGlobal("window", {
      location: { search: "?environment=ethereum-mainnet" },
      addEventListener: vi.fn(),
    });
    const config = await import("../../client/src/privacy/config");
    expect(config.PRIVACY_PROTOCOL).toBe(V2_ETH_PROTOCOL);
    expect(config.DEVICE_STORAGE_PREFIX).toBe("hylsia.pp.protocol-v2-eth.");
    expect(config.activeProtocolStorageKey("hylsia.pp.vault.v2")).toBe(false);
    expect(config.PRIVACY_POOLS.map(pool => pool.chainId)).toEqual([1]);
    expect(config.PRIVACY_POOLS[0].artifacts).toMatchObject({
      protocol: V2_ETH_PROTOCOL,
      releaseId: record.releaseId,
      manifestSha256: record.artifactManifestSha256,
    });
  });
});
