import fs from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeEventTopics,
  keccak256,
  toBytes,
} from "viem";
import { PRIVACY_POOL_ABI } from "../../shared/privacy/abi";
import {
  computePrecommitment,
  deriveMasterKeys,
} from "../../shared/privacy/notes";
import { SNARK_SCALAR_FIELD } from "../../shared/privacy/constants";
import { PRIVACY_POOL_V2_ABI } from "../../shared/privacy/v2/abi";
import {
  discoverNotesV2,
  type DepositedEventV2,
  type PoolEventV2,
} from "../../shared/privacy/v2/indexer";
import {
  deriveMasterKeysV2,
  deriveNoteSecretsV2,
  V2_PROTOCOL,
} from "../../shared/privacy/v2/notes";

const fixture = JSON.parse(
  fs.readFileSync("contracts/test/fixtures/v2/pool.json", "utf8")
);
const seed = toBytes(keccak256(toBytes("hylsia-v2-test-seed")));
const keys = () => deriveMasterKeysV2(seed);
const scope = BigInt(fixture.scope);
const events: PoolEventV2[] = fixture.events.map((e: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(e).map(([key, value]) => [
      key,
      typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : value,
    ])
  )
);
const deposits = events.filter(
  (e): e is DepositedEventV2 => e.kind === "deposit"
);
const balance = (notes: ReturnType<typeof discoverNotesV2>["notes"]) =>
  notes.filter(n => !n.spent && n.value > 0n).reduce((s, n) => s + n.value, 0n);

describe("v2 mainnet protocol candidate (development only)", () => {
  it("recovers independent devices' deposits using only the seed and public random nonces", () => {
    const recovered = discoverNotesV2(keys(), scope, deposits);
    expect(recovered.notes).toHaveLength(3);
    expect(balance(recovered.notes)).toBe(25n * 10n ** 17n);
    expect(recovered.notes[0].nullifier).toBe(recovered.notes[1].nullifier);
    expect(recovered.notes[0].nullifierHash).not.toBe(
      recovered.notes[1].nullifierHash
    );
    expect(recovered.reusedRecoveryNonces).toEqual([deposits[0].recoveryNonce]);
    expect(deposits[2].recoveryNonce).toBeGreaterThan(2n ** 240n); // no sequential scan/gap bound
  });

  it("spending a copied deposit leaves the original and both change chains recoverable", () => {
    const recovered = discoverNotesV2(keys(), scope, events.slice(0, 4));
    expect(balance(recovered.notes)).toBe(21n * 10n ** 17n);
    expect(
      recovered.notes.find(n => n.label === deposits[1].label)?.spent
    ).toBe(false);
    const complete = discoverNotesV2(keys(), scope, events);
    expect(complete.notes).toHaveLength(7);
    expect(balance(complete.notes)).toBe(5n * 10n ** 17n);
    expect(
      discoverNotesV2(deriveMasterKeysV2(seed.slice()), scope, events)
    ).toEqual(complete);
  });

  it("reconstructs a ragequit without an ASP root or any local activity store", () => {
    const recovered = discoverNotesV2(keys(), scope, [
      ...deposits,
      {
        kind: "ragequit",
        ragequitter: deposits[1].depositor,
        commitment: deposits[1].commitment,
        label: deposits[1].label,
        value: deposits[1].value,
        blockNumber: 2n,
        txHash: deposits[1].txHash,
        logIndex: 0,
      },
    ]);
    expect(recovered.notes[1].spentBy?.kind).toBe("ragequit");
    expect(recovered.notes[0].spent).toBe(false);
    expect(balance(recovered.notes)).toBe(15n * 10n ** 17n);
  });

  it("does not discover another seed's, scope's or protocol's notes", () => {
    expect(
      discoverNotesV2(deriveMasterKeysV2(new Uint8Array(32)), scope, events)
        .notes
    ).toEqual([]);
    expect(discoverNotesV2(keys(), scope + 1n, events).notes).toEqual([]);
    expect(
      discoverNotesV2(deriveMasterKeys(seed), scope, events).notes
    ).toEqual([]);
  });

  it("fails on tampered owned commitments and non-forward change events", () => {
    expect(() =>
      discoverNotesV2(keys(), scope, [
        { ...deposits[0], value: deposits[0].value + 1n },
      ])
    ).toThrow("commitment mismatch");
    const withdrawal = events[3];
    if (withdrawal.kind !== "withdraw")
      throw new Error("fixture missing withdrawal");
    expect(() =>
      discoverNotesV2(keys(), scope, [
        ...deposits,
        { ...withdrawal, leafIndex: 0 },
      ])
    ).toThrow("follow its input");
  });

  it("validates public nonce/hop inputs and keeps the new seed domain separate", () => {
    expect(() => deriveNoteSecretsV2(keys(), scope, 0n, 0)).toThrow();
    expect(() =>
      deriveNoteSecretsV2(keys(), scope, SNARK_SCALAR_FIELD, 0)
    ).toThrow();
    expect(() => deriveNoteSecretsV2(keys(), scope, 1n, -1)).toThrow();
    expect(() =>
      deriveNoteSecretsV2(keys(), scope, 1n, Number.MAX_SAFE_INTEGER + 1)
    ).toThrow();
    expect(
      computePrecommitment(
        deriveNoteSecretsV2(keys(), scope, deposits[0].recoveryNonce, 0)
      )
    ).toBe(deposits[0].precommitment);
    expect(keys()).not.toEqual(deriveMasterKeys(seed));
  });

  it("uses a deposit event that v1 cannot silently decode", () => {
    const dep = deposits[0];
    const topics = encodeEventTopics({
      abi: PRIVACY_POOL_V2_ABI,
      eventName: "Deposited",
      args: { depositor: dep.depositor },
    });
    const data = encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint32" },
      ],
      [
        dep.commitment,
        dep.label,
        dep.value,
        dep.precommitment,
        dep.recoveryNonce,
        dep.leafIndex,
      ]
    );
    const decoded = decodeEventLog({ abi: PRIVACY_POOL_V2_ABI, data, topics });
    expect(decoded.eventName).toBe("Deposited");
    expect(decoded.args).toMatchObject({ recoveryNonce: dep.recoveryNonce });
    expect(() =>
      decodeEventLog({ abi: PRIVACY_POOL_ABI, data, topics })
    ).toThrow();
  });

  it("pins the real-proof fixtures to their v2 circuits and dev verifiers", () => {
    expect(fixture.protocol).toBe(V2_PROTOCOL);
    expect(fixture.developmentOnly).toBe(true);
    const sha256 = (file: string) =>
      createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    for (const [name, contract] of [
      ["withdraw", "WithdrawVerifierV2Dev"],
      ["commitment", "CommitmentVerifierV2Dev"],
    ]) {
      expect(sha256(`circuits/v2/${name}.circom`)).toBe(
        fixture.artifactPins[name].sourceSha256
      );
      expect(sha256(`contracts/src/v2/dev-verifiers/${contract}.sol`)).toBe(
        fixture.artifactPins[name].verifierSha256
      );
    }
  });
});
