import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { keccak256, toBytes } from "viem";
import { PROTOCOL_VERSION } from "../../shared/privacy/constants";
import { deriveMasterKeysV2, V2_PROTOCOL } from "../../shared/privacy/v2/notes";
import {
  discoverNotesV2,
  type PoolEventV2,
} from "../../shared/privacy/v2/indexer";
import * as legacy from "../../shared/privacy/vault";
import * as vault from "../../shared/privacy/v2/vault";

const PASSWORD = "correct horse battery";
const ITERATIONS = 1_000;
const seed = () => toBytes(keccak256(toBytes("hylsia-v2-test-seed")));
const fixture = JSON.parse(
  fs.readFileSync("contracts/test/fixtures/v2/pool.json", "utf8")
);
const history: PoolEventV2[] = fixture.events.map(
  (e: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(e).map(([key, value]) => [
        key,
        typeof value === "string" && /^\d+$/.test(value)
          ? BigInt(value)
          : value,
      ])
    )
);
const balance = (notes: ReturnType<typeof discoverNotesV2>["notes"]) =>
  notes
    .filter(n => !n.spent && n.value > 0n)
    .reduce((sum, n) => sum + n.value, 0n);

describe("protocol v2 encrypted backup and independent-device restore", () => {
  it("restores the seed with production-default KDF settings and no chain/pool/counter metadata", async () => {
    const backup = await vault.encryptSeed(seed(), PASSWORD);
    expect(backup).toMatchObject({
      version: 2,
      protocol: V2_PROTOCOL,
      kdf: { iterations: 600_000 },
    });
    const serialized = JSON.stringify(backup);
    expect(serialized).not.toMatch(
      /chainId|"pool"|recoveryNonce|depositIndex|masterNullifier/
    );
    expect(
      await vault.decryptSeed(vault.parseBackup(serialized), PASSWORD)
    ).toEqual(seed());
    expect(backup.fingerprint).toBe(vault.seedFingerprint(seed()));
    expect(backup.fingerprint).not.toBe(legacy.seedFingerprint(seed()));
  });

  it("recovers deposits and both change chains from an exported file on another device", async () => {
    const exportedFile = JSON.stringify(
      await vault.encryptSeed(seed(), PASSWORD, ITERATIONS)
    );
    const restoredSeed = await vault.decryptSeed(
      vault.parseBackup(exportedFile),
      PASSWORD
    );
    const recovered = discoverNotesV2(
      deriveMasterKeysV2(restoredSeed),
      BigInt(fixture.scope),
      history
    );
    expect(recovered.notes).toHaveLength(7);
    expect(balance(recovered.notes)).toBe(5n * 10n ** 17n);
    const concurrent = discoverNotesV2(
      deriveMasterKeysV2(restoredSeed),
      BigInt(fixture.scope),
      history.slice(0, 3)
    );
    expect(balance(concurrent.notes)).toBe(25n * 10n ** 17n);
    expect(concurrent.notes[0].nullifierHash).not.toBe(
      concurrent.notes[1].nullifierHash
    );
  });

  it("keeps salt and IV fresh for independent exports of the same vault", async () => {
    const a = await vault.encryptSeed(seed(), PASSWORD, ITERATIONS);
    const b = await vault.encryptSeed(seed(), PASSWORD, ITERATIONS);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("rejects a v1 protocol backup in v2 and a v2 protocol backup in the active v1 vault", async () => {
    const v1 = await legacy.encryptSeedV2(seed(), PASSWORD, ITERATIONS);
    const v2 = await vault.encryptSeed(seed(), PASSWORD, ITERATIONS);
    expect(() => vault.parseBackup(JSON.stringify(v1))).toThrow(
      legacy.VaultError
    );
    await expect(vault.decryptSeed(v1, "wrong password")).rejects.toMatchObject(
      { code: "WRONG_CONTEXT" }
    );
    await expect(
      legacy.decryptSeed(v2, "wrong password")
    ).rejects.toMatchObject({ code: "WRONG_CONTEXT" });
  });

  it("authenticates the protocol domain even when the metadata and fingerprint are relabeled", async () => {
    const v1 = await legacy.encryptSeedV2(seed(), PASSWORD, ITERATIONS);
    const v2 = await vault.encryptSeed(seed(), PASSWORD, ITERATIONS);
    await expect(
      vault.decryptSeed(
        { ...v1, protocol: V2_PROTOCOL, fingerprint: v2.fingerprint },
        PASSWORD
      )
    ).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    await expect(
      legacy.decryptSeed(
        { ...v2, protocol: PROTOCOL_VERSION, fingerprint: v1.fingerprint },
        PASSWORD
      )
    ).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
  });

  it("rejects a relabeled legacy single-pool envelope for the v2 protocol", async () => {
    const old = await legacy.encryptSeed(
      seed(),
      PASSWORD,
      { chainId: 46630, pool: "0x1111111111111111111111111111111111111111" },
      ITERATIONS
    );
    const relabeled = {
      ...old,
      protocol: V2_PROTOCOL,
      fingerprint: vault.seedFingerprint(seed()),
    };
    expect(() => vault.parseBackup(JSON.stringify(relabeled))).toThrow(
      "version 2 backup envelope"
    );
    await expect(vault.decryptSeed(relabeled, PASSWORD)).rejects.toMatchObject({
      code: "BAD_FORMAT",
    });
  });

  it("rejects changed fingerprints, corrupted ciphertext and wrong passwords", async () => {
    const backup = await vault.encryptSeed(seed(), PASSWORD, ITERATIONS);
    await expect(
      vault.decryptSeed({ ...backup, fingerprint: "42" }, PASSWORD)
    ).rejects.toMatchObject({ code: "CORRUPT" });
    await expect(
      vault.decryptSeed({ ...backup, ciphertext: "AAAA" }, PASSWORD)
    ).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    await expect(
      vault.decryptSeed(backup, "incorrect password")
    ).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
  });

  it("bounds untrusted KDF work before WebCrypto and rejects unsupported protocols", async () => {
    const backup = await vault.encryptSeed(seed(), PASSWORD, ITERATIONS);
    const excessive = {
      ...backup,
      kdf: { ...backup.kdf, iterations: legacy.MAX_PBKDF2_ITERATIONS + 1 },
    };
    const derive = vi.spyOn(crypto.subtle, "deriveKey");
    try {
      expect(() => vault.parseBackup(JSON.stringify(excessive))).toThrow(
        legacy.VaultError
      );
      await expect(
        vault.decryptSeed(excessive, PASSWORD)
      ).rejects.toMatchObject({ code: "BAD_FORMAT" });
      expect(derive).not.toHaveBeenCalled();
    } finally {
      derive.mockRestore();
    }
    await expect(
      legacy.encryptProtocolSeed(
        seed(),
        PASSWORD,
        "hylsia-pp-v99" as never,
        ITERATIONS
      )
    ).rejects.toThrow("Unsupported privacy protocol");
    await expect(
      vault.encryptSeed(new Uint8Array(31), PASSWORD, ITERATIONS)
    ).rejects.toThrow("32 bytes");
  });
});
