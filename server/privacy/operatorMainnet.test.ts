import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { ethereumMainnet } from "../../shared/privacy/chains";
import { mainnetReleaseRefusal } from "../../shared/privacy/mainnetRelease";
import { V2_ETH_PROTOCOL } from "../../shared/privacy/protocols";
import {
  assertVerifiedPhase1Hashes,
  VERIFIED_PHASE1,
} from "../../scripts/privacy/v2/verified-phase1";
import {
  matchesOperatorAuthorization,
  type OperatorDeploymentAuthorization,
} from "../../scripts/privacy/v2/operator-authorization";
import type { ReleasePackage } from "../../scripts/privacy/v2/release-policy";

const deployer = "0x1111111111111111111111111111111111111111" as const;
const release: ReleasePackage = {
  schemaVersion: 1,
  protocol: V2_ETH_PROTOCOL,
  status: "ceremony-verified",
  productionReady: false,
  reviewedRelease: false,
  releaseId: "a".repeat(64),
  artifactManifestSha256: "b".repeat(64),
  identity: {
    protocol: V2_ETH_PROTOCOL,
    targetChainId: 1,
    asset: "native-ETH",
    files: {},
    ceremony: { trustModel: "single-operator", independenceReviewed: false },
  },
};
const approval: OperatorDeploymentAuthorization = {
  chainId: 1,
  protocol: V2_ETH_PROTOCOL,
  releaseId: release.releaseId,
  artifactManifestSha256: release.artifactManifestSha256,
  deployer,
  evidencePath: "docs/security/example-operator-release.json",
  evidenceSha256: "c".repeat(64),
};
describe("exact user-authorized single-operator mainnet deployment", () => {
  it("reports the recorded Ethereum contract separately from inactive application configuration without a signer or RPC", () => {
    const record = JSON.parse(
      fs.readFileSync("contracts/deployments/1.json", "utf8")
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/privacy/mainnet-preflight.ts",
        "--network",
        "ethereum-mainnet",
        "--offline",
      ],
      {
        encoding: "utf8",
        timeout: 15000,
        env: {
          ...process.env,
          DEPLOY_PRIVATE_KEY_MAINNET: "invalid-private-input",
          PRIVACY_ENABLE_MAINNET_APP: "false",
          PRIVACY_DEPLOY_RPC_URL_1: "https://rpc.invalid",
        },
      }
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      expectedChainId: 1,
      rpcCheck: "not_checked",
      recordedPool: record.pool,
      recordedReleaseId: record.releaseId,
      contractDeploymentRecorded: true,
      recordedTrustModel: "single-operator",
      applicationRegisteredPool: null,
      applicationReleaseStatus: "blocked_pending_independent_review",
      readyForBroadcast: false,
    });
    expect(result.stdout).not.toContain("invalid-private-input");
  });
  it("permits the exact operator deployment binding without representing independent review", () => {
    expect(matchesOperatorAuthorization(approval, release, 1, deployer)).toBe(
      true
    );
    expect(mainnetReleaseRefusal(ethereumMainnet, release)).not.toBeNull();
  });
  it("does not reuse authorization on another chain or sender", () => {
    expect(
      matchesOperatorAuthorization(approval, release, 4663, deployer)
    ).toBe(false);
    expect(
      matchesOperatorAuthorization(
        approval,
        release,
        1,
        "0x2222222222222222222222222222222222222222"
      )
    ).toBe(false);
  });
  it("rejects substituted package and artifact-manifest digests", () => {
    expect(
      matchesOperatorAuthorization(
        { ...approval, releaseId: "d".repeat(64) },
        release,
        1,
        deployer
      )
    ).toBe(false);
    expect(
      matchesOperatorAuthorization(
        { ...approval, artifactManifestSha256: "d".repeat(64) },
        release,
        1,
        deployer
      )
    ).toBe(false);
  });
  it("does not let single-operator deployment approval relabel the setup as independently reviewed", () => {
    expect(
      matchesOperatorAuthorization(
        approval,
        {
          ...release,
          identity: {
            ...release.identity,
            ceremony: {
              trustModel: "single-operator",
              independenceReviewed: true,
            },
          },
        },
        1,
        deployer
      )
    ).toBe(false);
    expect(
      matchesOperatorAuthorization(
        approval,
        {
          ...release,
          identity: {
            ...release.identity,
            ceremony: { trustModel: "unreviewed", independenceReviewed: false },
          },
        },
        1,
        deployer
      )
    ).toBe(false);
  });
});
describe("pinned completed phase-1 verification evidence", () => {
  it("accepts only the exact previously completed full verification", () => {
    expect(() => assertVerifiedPhase1Hashes(VERIFIED_PHASE1)).not.toThrow();
  });
  for (const field of [
    "receiptSha256",
    "transcriptSha256",
    "cliSha256",
    "logSha256",
  ] as const)
    it(`rejects replacement of ${field} despite any claimed success flag`, () => {
      expect(() =>
        assertVerifiedPhase1Hashes({
          ...VERIFIED_PHASE1,
          [field]: "f".repeat(64),
        })
      ).toThrow("evidence mismatch");
    });
});
