import { describe, expect, it, vi } from "vitest";
import { mainnetDeploymentConfig } from "../../shared/privacy/mainnetConfig";
import { ANVIL_DEFAULT_ACCOUNTS } from "../../shared/privacy/networks";
import fs from "node:fs";
import { loadRuntimeSecrets } from "../_core/runtimeSecrets";

const vars = () => ({
  PRIVACY_DEPLOYER_ADDRESS: "0x1111111111111111111111111111111111111111",
  PRIVACY_POOL_OWNER: "0x1111111111111111111111111111111111111111",
  PRIVACY_ASP_POSTMAN: "0x2222222222222222222222222222222222222222",
  PRIVACY_RELAYER_ADDRESS: "0x3333333333333333333333333333333333333333",
  PRIVACY_DEPLOY_ACCOUNT: "hylsia-mainnet",
  PRIVACY_DEPLOY_GAS_BUDGET_ETH: "0.05",
});
const read = (env: Record<string, string>) => (key: string) => env[key];
describe("mainnet .env preparation, public values only", () => {
  it("uses service-secret file names supported by the runtime loader", () => {
    const template = fs.readFileSync(
      "config/robinhood-mainnet.env.example",
      "utf8"
    );
    const names = [
      ...template.matchAll(
        /^(PRIVACY_(?:RELAYER|ASP_POSTMAN)_PRIVATE_KEY\w*_FILE)=$/gm
      ),
    ].map(match => match[1]);
    expect(names).toHaveLength(2);
    const env: Record<string, string> = Object.fromEntries(
      names.map(name => [name, "/test/service-secret"])
    );
    loadRuntimeSecrets(env, () => "0x" + "01".repeat(32));
    for (const name of names) expect(env[name.slice(0, -5)]).toBeDefined();
  });
  it("reports all missing public configuration without constructing or reading a signer", () => {
    const reader = vi.fn(() => undefined);
    const config = mainnetDeploymentConfig(reader);
    expect(config.configured).toBe(false);
    expect(config.issues).toHaveLength(4);
    expect(
      reader.mock.calls.every(([key]) => !/PRIVATE_KEY|PASSWORD|SEED/.test(key))
    ).toBe(true);
  });
  it("accepts explicit separate operational roles and a keystore alias", () => {
    const config = mainnetDeploymentConfig(read(vars()));
    expect(config.issues).toEqual([]);
    expect(config.signer).toEqual({
      kind: "keystore",
      account: "hylsia-mainnet",
    });
    expect(config.gasBudgetWei).toBe("50000000000000000");
    expect(config.configured).toBe(true);
    expect(config).not.toHaveProperty("readyForBroadcast"); // public configuration cannot approve a protocol release
  });
  it("allows contract deployment before a relayer service is configured", () => {
    const config = mainnetDeploymentConfig(
      read({ ...vars(), PRIVACY_RELAYER_ADDRESS: "" })
    );
    expect(config.configured).toBe(true);
    expect(config.roles.relayer).toBeNull();
  });
  it("allows the publisher to deploy for a distinct owner", () => {
    const config = mainnetDeploymentConfig(
      read({ ...vars(), PRIVACY_DEPLOYER_ADDRESS: vars().PRIVACY_ASP_POSTMAN })
    );
    expect(config.configured).toBe(true);
    expect(config.roles.deployer).toBe(config.roles.publisher);
    expect(config.roles.owner).not.toBe(config.roles.publisher);
  });
  it("accepts a Ledger without an account alias and refuses ambiguous signer selection", () => {
    const env: Record<string, string> = {
      ...vars(),
      PRIVACY_DEPLOY_ACCOUNT: "",
      PRIVACY_DEPLOY_HARDWARE: "ledger",
    };
    expect(mainnetDeploymentConfig(read(env)).signer).toEqual({
      kind: "ledger",
    });
    env.PRIVACY_DEPLOY_ACCOUNT = "hylsia-mainnet";
    expect(mainnetDeploymentConfig(read(env)).configured).toBe(false);
  });
  it("refuses zero, malformed and known development accounts", () => {
    for (const address of [
      "0x" + "0".repeat(40),
      "not-an-address",
      ANVIL_DEFAULT_ACCOUNTS[0],
    ]) {
      const config = mainnetDeploymentConfig(
        read({ ...vars(), PRIVACY_POOL_OWNER: address })
      );
      expect(config.roles.owner).toBeNull();
      expect(config.configured).toBe(false);
      expect(config.issues.join(" ")).not.toContain(address);
    }
  });
  it("accepts an explicitly shared owner/publisher without requiring a relayer or custom gas cap", () => {
    const config = mainnetDeploymentConfig(
      read({
        ...vars(),
        PRIVACY_ASP_POSTMAN: vars().PRIVACY_POOL_OWNER,
        PRIVACY_RELAYER_ADDRESS: "",
        PRIVACY_DEPLOY_GAS_BUDGET_ETH: "",
      })
    );
    expect(config.configured).toBe(true);
    expect(config.sharedOwnerPublisher).toBe(true);
    expect(config.gasBudgetWei).toBeNull();
  });
  it("validates a separately configured relayer service account", () => {
    expect(
      mainnetDeploymentConfig(
        read({ ...vars(), PRIVACY_RELAYER_ADDRESS: vars().PRIVACY_POOL_OWNER })
      ).issues
    ).toContain("Owner must be separate from the operator relayer");
    expect(
      mainnetDeploymentConfig(
        read({ ...vars(), PRIVACY_RELAYER_ADDRESS: vars().PRIVACY_ASP_POSTMAN })
      ).issues
    ).toContain("Publisher and relayer must use separate accounts");
  });
  it.each(["0", "-1", "1e-3", "0.0000000000000000001", "bad"])(
    "rejects an invalid gas budget: %s",
    budget => {
      expect(
        mainnetDeploymentConfig(
          read({ ...vars(), PRIVACY_DEPLOY_GAS_BUDGET_ETH: budget })
        ).gasBudgetWei
      ).toBeNull();
    }
  );
});
