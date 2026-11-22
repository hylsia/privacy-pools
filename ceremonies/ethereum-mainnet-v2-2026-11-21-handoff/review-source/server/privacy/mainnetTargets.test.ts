import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { ethereumMainnet } from "../../shared/privacy/chains";
import { networkById, resolveNetworks } from "../../shared/privacy/networks";
import { V2_ETH_PROTOCOL } from "../../shared/privacy/protocols";
import { mainnetDeploymentConfig } from "../../shared/privacy/mainnetConfig";
import {
  mainnetReleaseRefusal,
  REVIEWED_MAINNET_RELEASES,
} from "../../shared/privacy/mainnetRelease";
import { selectMainnetTarget } from "../../scripts/privacy/mainnet-target";
import { readEnvDeployer } from "../../scripts/privacy/env-deployer";
import { anvilKey } from "../../scripts/privacy/anvilKeys";
import { computeScope } from "../../shared/privacy/context";

const pool = "0x1111111111111111111111111111111111111111" as const;
describe("explicit Ethereum and Robinhood mainnet targets", () => {
  it("registers Ethereum without inheriting testnet deployments or enabling a transactable pool", () => {
    expect(networkById(1)).toMatchObject({
      slug: "ethereum-mainnet",
      kind: "l1",
      chain: ethereumMainnet,
      faucet: null,
    });
    const vars: Record<string, string> = {
      PRIVACY_CHAIN_IDS: "1,4663",
      PRIVACY_PROTOCOL: V2_ETH_PROTOCOL,
      PRIVACY_POOL_ADDRESS_1: pool,
      PRIVACY_POOL_DEPLOY_BLOCK_1: "1",
      PRIVACY_POOL_ADDRESS_4663: pool,
      PRIVACY_POOL_DEPLOY_BLOCK_4663: "1",
    };
    const resolved = resolveNetworks(name => vars[name], {});
    expect(resolved.networks.map(n => n.network.chainId)).toEqual([4663, 1]);
    for (const n of resolved.networks)
      expect(n.problems).toContain("mainnet_release_blocked");
    expect(computeScope(pool, 1)).not.toBe(computeScope(pool, 4663));
    expect(REVIEWED_MAINNET_RELEASES).toHaveLength(0);
  });
  it("requires one unambiguous target and retains the previous Robinhood default", () => {
    expect(selectMainnetTarget([]).target.chainId).toBe(4663);
    expect(
      selectMainnetTarget([
        "--release",
        "local-package",
        "--network",
        "ethereum-mainnet",
      ]).target.chainId
    ).toBe(1);
    for (const argv of [
      ["--network"],
      ["--network", "ethereum"],
      ["--network", "ethereum-mainnet", "--network", "robinhood-mainnet"],
    ])
      expect(() => selectMainnetTarget(argv)).toThrow();
    expect(
      mainnetReleaseRefusal(ethereumMainnet, {
        protocol: V2_ETH_PROTOCOL,
        releaseId: "a".repeat(64),
        artifactManifestSha256: "b".repeat(64),
      })
    ).toContain("blocked");
  });
  it("selects an environment signer from public configuration without reading a private key", () => {
    const vars: Record<string, string> = {
      PRIVACY_DEPLOYER_ADDRESS: pool,
      PRIVACY_POOL_OWNER: pool,
      PRIVACY_ASP_POSTMAN: "0x2222222222222222222222222222222222222222",
      PRIVACY_RELAYER_ADDRESS: "0x3333333333333333333333333333333333333333",
      PRIVACY_DEPLOY_SIGNER: "env",
      PRIVACY_DEPLOY_GAS_BUDGET_ETH_1: "0.01",
      PRIVACY_DEPLOY_GAS_BUDGET_ETH_4663: "0.001",
    };
    const read = vi.fn((name: string) => {
      if (name.includes("PRIVATE_KEY"))
        throw Error("Public preflight attempted to read a secret");
      return vars[name];
    });
    expect(mainnetDeploymentConfig(read, 1)).toMatchObject({
      configured: true,
      signer: { kind: "env", variable: "DEPLOY_PRIVATE_KEY_MAINNET" },
      gasBudgetWei: "10000000000000000",
    });
    expect(mainnetDeploymentConfig(read, 4663).gasBudgetWei).toBe(
      "1000000000000000"
    );
    vars.PRIVACY_DEPLOY_ACCOUNT = "other-account";
    expect(mainnetDeploymentConfig(read, 1).configured).toBe(false);
  });
  it("normalizes a locally supplied deployment key and rejects mismatches without including supplied values", () => {
    const secret = anvilKey(0);
    const expected = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    expect(readEnvDeployer(() => secret.slice(2), expected).address).toBe(
      expected
    );
    expect(() => readEnvDeployer(() => secret, pool)).toThrow("does not match");
    for (const value of [
      undefined,
      "invalid-private-input",
      "0x" + "00".repeat(32),
      "0x" + "ff".repeat(32),
    ]) {
      let failure: unknown;
      try {
        readEnvDeployer(() => value);
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toMatch(/missing|valid/);
      if (value) expect((failure as Error).message).not.toContain(value);
    }
  });
  it.each(["ethereum-mainnet", "robinhood-mainnet"])(
    "refuses signing %s before opening a key or missing release directory",
    network => {
      const result = spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "scripts/privacy/v2/deploy-native-eth.ts",
          "--network",
          network,
          "--release",
          "/missing/package",
          "--broadcast",
        ],
        {
          encoding: "utf8",
          timeout: 15000,
          env: {
            ...process.env,
            DEPLOY_PRIVATE_KEY_MAINNET: "invalid-private-input",
          },
        }
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Mainnet release blocked");
      expect(result.stderr).not.toContain("invalid-private-input");
      expect(result.stderr).not.toContain("ENOENT");
    }
  );
});
