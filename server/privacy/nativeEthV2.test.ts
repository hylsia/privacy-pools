import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { V2_ETH_PROTOCOL, V2_PROTOCOL } from "../../shared/privacy/protocols";
import { PROTOCOL_VERSION } from "../../shared/privacy/constants";
import { protocolRuntime } from "../../shared/privacy/runtime";
import { computeCommitment } from "../../shared/privacy/notes";
import {
  checkContributionChain,
  contentId,
  reserveReleaseDirectory,
  safeFile,
} from "../../scripts/privacy/v2/release-policy";
import { resolveNetworks } from "../../shared/privacy/networks";
import { createArtifactLoader } from "../../client/src/privacy/artifacts";
import { DEPLOYMENTS } from "../../shared/privacy/deployments";
import {
  checkRecord,
  renderDeployments,
} from "../../scripts/privacy/deploymentRecords";
import { computeScope } from "../../shared/privacy/context";
import { resolveReleaseInputs } from "../../scripts/privacy/v2/release-inputs";

const sha = (b: string | Uint8Array) =>
  createHash("sha256").update(b).digest("hex");
const seed = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("native ETH v2 release runtime", () => {
  it("separates production-target keys and backups from candidate and v1 identities", async () => {
    const runtime = protocolRuntime(V2_ETH_PROTOCOL);
    const keys = runtime.deriveMasterKeys(seed);
    expect(keys).not.toEqual(
      protocolRuntime(V2_PROTOCOL).deriveMasterKeys(seed)
    );
    expect(keys).not.toEqual(
      protocolRuntime(PROTOCOL_VERSION).deriveMasterKeys(seed)
    );
    const backup = await runtime.encryptSeed(seed, "native-eth-test-password");
    expect(backup.protocol).toBe(V2_ETH_PROTOCOL);
    expect(
      await runtime.decryptSeed(
        runtime.parseBackup(JSON.stringify(backup)),
        "native-eth-test-password"
      )
    ).toEqual(seed);
    expect(() =>
      protocolRuntime(V2_PROTOCOL).parseBackup(JSON.stringify(backup))
    ).toThrow("does not match");
    const relabelled = {
      ...backup,
      protocol: V2_PROTOCOL,
      fingerprint: protocolRuntime(V2_PROTOCOL).seedFingerprint(seed),
    };
    await expect(
      protocolRuntime(V2_PROTOCOL).decryptSeed(
        relabelled,
        "native-eth-test-password"
      )
    ).rejects.toThrow();
  });
  it("recovers two native ETH deposits with duplicated secrets and distinct labels", () => {
    const runtime = protocolRuntime(V2_ETH_PROTOCOL);
    const keys = runtime.deriveMasterKeys(seed),
      scope = 123n;
    const prepared = runtime.prepareDeposit(keys, scope, -1);
    const events = [11n, 12n].map((label, i) => ({
      kind: "deposit" as const,
      blockNumber: BigInt(i + 1),
      txHash: ("0x" + String(i + 1).repeat(64)) as `0x${string}`,
      logIndex: 0,
      depositor: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      commitment: computeCommitment(1000n, label, prepared.precommitment),
      label,
      value: 1000n,
      precommitment: prepared.precommitment,
      recoveryNonce: prepared.recoveryNonce,
      leafIndex: i,
    }));
    const discovered = runtime.discover(keys, scope, events);
    expect(discovered.notes).toHaveLength(2);
    expect(discovered.notes[0].nullifierHash).not.toBe(
      discovered.notes[1].nullifierHash
    );
    expect(
      protocolRuntime(V2_PROTOCOL).discover(
        protocolRuntime(V2_PROTOCOL).deriveMasterKeys(seed),
        scope,
        events
      ).notes
    ).toHaveLength(0);
  });
  it("requires recorded release pins even for local stable-identity address overrides", () => {
    const vars: Record<string, string> = {
      PRIVACY_PROTOCOL: V2_ETH_PROTOCOL,
      PRIVACY_CHAIN_IDS: "31337",
      PRIVACY_POOL_ADDRESS_31337: "0x1111111111111111111111111111111111111111",
    };
    expect(resolveNetworks(n => vars[n], {}).networks[0].problems).toContain(
      "missing_release_binding"
    );
    vars.PRIVACY_CHAIN_IDS = "4663";
    vars.PRIVACY_POOL_ADDRESS_4663 = vars.PRIVACY_POOL_ADDRESS_31337;
    vars.PRIVACY_POOL_DEPLOY_BLOCK_4663 = "1";
    expect(resolveNetworks(n => vars[n], {}).networks[0].problems).toContain(
      "mainnet_release_blocked"
    );
  });
  it("keeps the native ETH device vault in a separate storage namespace", async () => {
    vi.stubEnv("VITE_PRIVACY_PROTOCOL", V2_ETH_PROTOCOL);
    const config = await import("../../client/src/privacy/config");
    expect(config.DEVICE_STORAGE_PREFIX).toBe("hylsia.pp.protocol-v2-eth.");
    expect(config.activeProtocolStorageKey("hylsia.pp.vault.v2")).toBe(false);
    expect(
      config.activeProtocolStorageKey("hylsia.pp.protocol-v2.vault.v2")
    ).toBe(false);
    expect(config.activeProtocolStorageKey(config.DEVICE_KEYS.vault)).toBe(
      true
    );
  });
});

describe("native ETH v2 pinned browser assets", () => {
  function fixture() {
    const releaseId = "a".repeat(64);
    const key = JSON.stringify({
      protocol: "groth16",
      curve: "bn128",
      nPublic: 6,
    });
    const file = (name: string, bytes: string) => ({
      path: name,
      sha256: sha(bytes),
      bytes: Buffer.byteLength(bytes),
    });
    const circuits = Object.fromEntries(
      ["withdraw", "commitment"].map(name => [
        name,
        {
          nPublic: name === "withdraw" ? 6 : 4,
          wasm: file(name + ".wasm", "test-wasm"),
          zkey: file(name + ".zkey", "test-key"),
          vkey: file(
            name + ".vkey.json",
            name === "withdraw"
              ? key
              : key.replace('"nPublic":6', '"nPublic":4')
          ),
        },
      ])
    );
    const text = JSON.stringify({
      protocol: V2_ETH_PROTOCOL,
      status: "ceremony-verified",
      productionReady: false,
      releaseId,
      builtAt: "2026-11-21",
      circuits,
    });
    return {
      text,
      key,
      binding: {
        protocol: V2_ETH_PROTOCOL,
        releaseId,
        manifestSha256: sha(text),
        vkeySha256: {
          withdraw: circuits.withdraw.vkey.sha256,
          commitment: circuits.commitment.vkey.sha256,
        },
      },
    };
  }
  it("binds the exact manifest bytes and content-addressed URL before requesting a key", async () => {
    const f = fixture();
    const request = vi.fn(
      async (url: string) =>
        new Response(url.endsWith("manifest.json") ? f.text : f.key)
    );
    const loader = createArtifactLoader(f.binding, request);
    expect(await loader.loadVerificationKey("withdraw")).toMatchObject({
      nPublic: 6,
    });
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      `/zk-v2-eth/${f.binding.releaseId}/manifest.json`,
      `/zk-v2-eth/${f.binding.releaseId}/withdraw.vkey.json`,
    ]);
    for (const [, options] of request.mock.calls as any)
      expect(options.credentials).toBe("omit");
  });
  it("rejects manifest substitution before fetching any proving file", async () => {
    const f = fixture();
    const request = vi.fn(async () => new Response(f.text + " "));
    await expect(
      createArtifactLoader(f.binding, request).loadArtifacts("withdraw")
    ).rejects.toThrow("manifest integrity");
    expect(request).toHaveBeenCalledTimes(1);
    expect(() =>
      createArtifactLoader({
        protocol: V2_ETH_PROTOCOL,
        vkeySha256: f.binding.vkeySha256,
      })
    ).toThrow("release ID");
    expect(() =>
      createArtifactLoader({ ...f.binding, releaseId: "../zk-v2-dev" })
    ).toThrow("release ID");
  });
});

describe("native ETH release preparation and deployment", () => {
  it("reports placeholder paths together instead of a raw ENOENT or creating a release", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hylsia-inputs-"));
    try {
      expect(() =>
        resolveReleaseInputs(
          root,
          "ceremonies/source-session",
          "path/final-withdraw.zkey",
          "path/final-commitment.zkey"
        )
      ).toThrow(
        /--ceremony[\s\S]*--withdraw-zkey[\s\S]*--commitment-zkey[\s\S]*placeholders/
      );
      expect(fs.readdirSync(root)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("requires a ceremony manifest and both actual key files before reading their contents", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hylsia-inputs-"));
    try {
      fs.mkdirSync(path.join(root, "session"));
      fs.writeFileSync(
        path.join(root, "withdraw.zkey"),
        "not parsed by path validation"
      );
      fs.writeFileSync(
        path.join(root, "commitment.zkey"),
        "not parsed by path validation"
      );
      expect(() =>
        resolveReleaseInputs(
          root,
          "session",
          "withdraw.zkey",
          "commitment.zkey"
        )
      ).toThrow("manifest.json is missing");
      fs.writeFileSync(path.join(root, "session/manifest.json"), "{}");
      const paths = resolveReleaseInputs(
        root,
        "session",
        "withdraw.zkey",
        "commitment.zkey"
      );
      expect(paths.ceremony).toBe(fs.realpathSync(path.join(root, "session")));
      expect(paths.finals.withdraw).toBe(path.join(root, "withdraw.zkey"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("rejects initial keys, local single contributions and absent final beacons", () => {
    const first = { type: 0, transcript: "a".repeat(128) };
    const second = { type: 0, transcript: "b".repeat(128) };
    const beacon = {
      type: 1,
      transcript: "c".repeat(128),
      beaconHash: "d".repeat(64),
      numIterationsExp: 10,
    };
    for (const chain of [[], [first], [first, second], [first, first, beacon]])
      expect(() => checkContributionChain(chain)).toThrow();
    expect(() => checkContributionChain([first, second, beacon])).not.toThrow(); // structure only; does not assert participant independence
    expect(contentId({ b: 2, a: 1 })).toBe(contentId({ a: 1, b: 2 }));
    expect(contentId({ a: 1 })).not.toBe(contentId({ a: 2 }));
  });
  it("confines immutable release preparation and rejects path traversal and symlinks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hylsia-release-"));
    try {
      expect(() => reserveReleaseDirectory(root, "client/public/zk")).toThrow();
      const out = reserveReleaseDirectory(root, "releases/session");
      expect(() => reserveReleaseDirectory(root, "releases/session")).toThrow(
        "already exists"
      );
      fs.writeFileSync(path.join(out, "real"), "bytes");
      fs.symlinkSync(path.join(out, "real"), path.join(out, "link"));
      for (const file of ["../real", "/tmp/real", "link"])
        expect(() => safeFile(out, file)).toThrow();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("preserves v2 release identity when validating and rendering a confirmed-record shape", () => {
    const pool = "0x1111111111111111111111111111111111111111";
    const raw = {
      ...DEPLOYMENTS[46630],
      chainId: 4663,
      protocol: V2_ETH_PROTOCOL,
      pool,
      scope: computeScope(pool, 4663).toString(),
      releaseId: "a".repeat(64),
      artifactManifestSha256: "b".repeat(64),
    };
    const checked = checkRecord("4663.json", raw, { includeLocal: false });
    expect(checked.kind).toBe("ok");
    if (checked.kind !== "ok") throw Error("Unexpected record rejection");
    expect(renderDeployments([checked.record])).toContain(
      'releaseId: "' + raw.releaseId + '"'
    );
    expect(
      checkRecord(
        "4663.json",
        { ...raw, artifactManifestSha256: "" },
        { includeLocal: false }
      ).kind
    ).toBe("invalid");
  });
  it("refuses mainnet signing before accessing a nonexistent package or signer", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/privacy/v2/deploy-native-eth.ts",
        "--release",
        "/does/not/exist",
        "--broadcast",
      ],
      { encoding: "utf8", timeout: 15000 }
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Mainnet release blocked");
    expect(result.stdout).not.toContain("Simulating");
    expect(result.stderr).not.toContain("ENOENT");
  });
});
