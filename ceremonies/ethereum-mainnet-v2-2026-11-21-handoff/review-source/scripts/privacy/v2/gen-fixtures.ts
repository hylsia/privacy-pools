/** Real v2 Groth16 proofs and seed-only recovery checks; writes only v2 test fixtures. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { getContractAddress, keccak256, toBytes, type Address } from "viem";
import { TREE_DEPTH } from "../../../shared/privacy/constants";
import { computeContext, computeScope } from "../../../shared/privacy/context";
import {
  computeCommitment,
  computeLabel,
  computePrecommitment,
} from "../../../shared/privacy/notes";
import { MerkleTree } from "../../../shared/privacy/merkleTree";
import {
  proveCommitment,
  proveWithdraw,
  verifyLocally,
  type ProofResult,
} from "../../../shared/privacy/prover";
import {
  discoverNotesV2,
  type DepositedEventV2,
  type PoolEventV2,
} from "../../../shared/privacy/v2/indexer";
import {
  computeNullifierHashV2,
  deriveMasterKeysV2,
  deriveNoteSecretsV2,
  V2_PROTOCOL,
} from "../../../shared/privacy/v2/notes";
import * as vault from "../../../shared/privacy/v2/vault";
import { protocolDefinition } from "../../../shared/privacy/protocols";
import {
  createArtifactLoader,
  type CircuitName,
} from "../../../client/src/privacy/artifacts";

const root = path.resolve(import.meta.dirname, "../../..");
const build = path.join(root, "circuits/v2/build");
const output = path.join(root, "contracts/test/fixtures/v2/pool.json");
const deployer: Address = "0x1111111111111111111111111111111111111111";
const recipient: Address = "0x00000000000000000000000000000000000000a1";
const relayer: Address = "0x00000000000000000000000000000000000000f1";
const hash = `0x${"11".repeat(32)}` as const;
const sha256 = (file: string) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const decimal = (n: bigint) => n.toString();
const serializeProof = (result: ProofResult) => ({
  pA: result.proof.pA.map(decimal),
  pB: result.proof.pB.flat().map(decimal),
  pC: result.proof.pC.map(decimal),
  pubSignals: result.publicSignals.map(decimal),
});

async function main() {
  if (process.argv.length > 2) throw new Error("Usage: npm run zk:v2:fixtures");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(build, "manifest.json"), "utf8")
  );
  if (
    manifest.protocol !== V2_PROTOCOL ||
    manifest.status !== "development" ||
    manifest.productionReady !== false
  ) {
    throw new Error("Complete the separate v2 development build first");
  }
  if (
    sha256(path.join(root, "circuits/lib/merkleProof.circom")) !==
    manifest.merkleProofSha256
  )
    throw new Error("Merkle source drift");
  for (const [name, contract] of [
    ["withdraw", "WithdrawVerifierV2Dev"],
    ["commitment", "CommitmentVerifierV2Dev"],
  ]) {
    const pins = manifest.circuits[name];
    for (const [file, pin] of [
      [`circuits/v2/${name}.circom`, "sourceSha256"],
      [`circuits/v2/build/${name}.r1cs`, "r1csSha256"],
      [`circuits/v2/build/${name}_final.zkey`, "zkeySha256"],
      [`circuits/v2/build/${name}_js/${name}.wasm`, "wasmSha256"],
      [`circuits/v2/build/${name}_verification_key.json`, "vkeySha256"],
      [`contracts/src/v2/dev-verifiers/${contract}.sol`, "verifierSha256"],
    ])
      if (sha256(path.join(root, file)) !== pins[pin])
        throw new Error(`V2 artifact drift: ${file}`);
  }
  // Exercise the browser-compatible loader against isolated local files. No assets are published or RPCs contacted.
  const base = protocolDefinition(V2_PROTOCOL).artifactBase;
  const localFiles = new Map<string, string>();
  const browserCircuits = Object.fromEntries(
    (["withdraw", "commitment"] as const).map(name => {
      const locations = {
        wasm: `${name}_js/${name}.wasm`,
        zkey: `${name}_final.zkey`,
        vkey: `${name}_verification_key.json`,
      };
      const files = Object.fromEntries(
        (["wasm", "zkey", "vkey"] as const).map(kind => {
          const file = path.join(build, locations[kind]);
          const publicName = `${name}.${kind === "vkey" ? "vkey.json" : kind}`;
          localFiles.set(`${base}/${publicName}`, file);
          return [
            kind,
            {
              path: publicName,
              bytes: fs.statSync(file).size,
              sha256: manifest.circuits[name][`${kind}Sha256`],
            },
          ];
        })
      );
      return [name, { ...files, nPublic: name === "withdraw" ? 6 : 4 }];
    })
  );
  const browserManifest = {
    protocol: V2_PROTOCOL,
    status: "development",
    productionReady: false,
    builtAt: new Date().toISOString(),
    circuits: browserCircuits,
  };
  const loader = createArtifactLoader(
    {
      protocol: V2_PROTOCOL,
      vkeySha256: {
        withdraw: manifest.circuits.withdraw.vkeySha256,
        commitment: manifest.circuits.commitment.vkeySha256,
      },
    },
    async (url, options) => {
      if (options?.credentials !== "omit")
        throw new Error("Artifact request carries credentials");
      if (url === `${base}/manifest.json`)
        return Response.json(browserManifest);
      const file = localFiles.get(url);
      if (!file) throw new Error("Unexpected v2 artifact request");
      return new Response(new Uint8Array(fs.readFileSync(file)));
    }
  );
  const loaded = {
    withdraw: await loader.loadArtifacts("withdraw"),
    commitment: await loader.loadArtifacts("commitment"),
  };
  const artifacts = (name: CircuitName) => loaded[name];
  async function checked(result: ProofResult, name: CircuitName) {
    const vk = await loader.loadVerificationKey(name);
    if (!(await verifyLocally(vk, result)))
      throw new Error(`Invalid real ${name} proof`);
    for (let i = 0; i < result.publicSignals.length; i++) {
      const mutated = { ...result, publicSignals: [...result.publicSignals] };
      mutated.publicSignals[i] += 1n;
      if (await verifyLocally(vk, mutated))
        throw new Error(`${name} public signal ${i} is not bound`);
    }
    return result;
  }
  const pool = getContractAddress({ from: deployer, nonce: 0n });
  const scope = computeScope(pool, 31337);
  const seed = toBytes(keccak256(toBytes("hylsia-v2-test-seed")));
  // A new device has only the exported encrypted backup and its password, never local allocation metadata.
  const backupFile = JSON.stringify(
    await vault.encryptSeed(seed, "hylsia-v2-fixture-password")
  );
  const restoredSeed = await vault.decryptSeed(
    vault.parseBackup(backupFile),
    "hylsia-v2-fixture-password"
  );
  const keys = deriveMasterKeysV2(restoredSeed);
  const state = new MerkleTree(TREE_DEPTH);
  const asp = new MerkleTree(TREE_DEPTH);
  const recoveryNonces = [2n ** 240n + 7n, 2n ** 240n + 7n, 2n ** 247n + 911n];
  const deposits: DepositedEventV2[] = recoveryNonces.map(
    (recoveryNonce, i) => {
      const secrets = deriveNoteSecretsV2(keys, scope, recoveryNonce, 0);
      const precommitment = computePrecommitment(secrets);
      const label = computeLabel(scope, BigInt(i + 1));
      const value = i === 2 ? 5n * 10n ** 17n : 10n ** 18n;
      const commitment = computeCommitment(value, label, precommitment);
      asp.insert(label);
      return {
        kind: "deposit",
        depositor:
          `0x${(0xd000 + i).toString(16).padStart(40, "0")}` as Address,
        recoveryNonce,
        precommitment,
        label,
        value,
        commitment,
        leafIndex: state.insert(commitment),
        blockNumber: 1n,
        txHash: hash,
        logIndex: i,
      };
    }
  );
  const events: PoolEventV2[] = [...deposits];
  const stateRootAfterDeposits = state.root;
  const withdrawal = { recipient, relayer, fee: 10n ** 16n, deadline: 0n };
  const proofs: Record<string, unknown> = {};
  async function withdraw(
    name: string,
    depositIndex: number,
    hop: number,
    value: bigint,
    amount: bigint,
    leafIndex: number,
    append = true
  ) {
    const deposit = deposits[depositIndex];
    const existing = deriveNoteSecretsV2(
      keys,
      scope,
      deposit.recoveryNonce,
      hop
    );
    const next = deriveNoteSecretsV2(
      keys,
      scope,
      deposit.recoveryNonce,
      hop + 1
    );
    const stateProof = state.proof(leafIndex);
    const aspProof = asp.proof(depositIndex);
    const result = await checked(
      await proveWithdraw(
        {
          withdrawnValue: amount,
          stateRoot: stateProof.root,
          ASPRoot: asp.root,
          context: computeContext(scope, withdrawal),
          label: deposit.label,
          existingValue: value,
          existingNullifier: existing.nullifier,
          existingSecret: existing.secret,
          newNullifier: next.nullifier,
          newSecret: next.secret,
          stateSiblings: stateProof.siblings,
          stateIndex: stateProof.index,
          ASPSiblings: aspProof.siblings,
          ASPIndex: aspProof.index,
        },
        artifacts("withdraw")
      ),
      "withdraw"
    );
    const change = computeCommitment(
      value - amount,
      deposit.label,
      computePrecommitment(next)
    );
    if (
      result.publicSignals[0] !== change ||
      result.publicSignals[1] !==
        computeNullifierHashV2(existing.nullifier, deposit.label)
    ) {
      throw new Error("V2 circuit/TypeScript outputs differ");
    }
    proofs[name] = { ...serializeProof(result), withdrawal, amount };
    if (!append) return -1;
    const newLeafIndex = state.insert(change);
    events.push({
      kind: "withdraw",
      ...withdrawal,
      value: amount,
      spentNullifier: result.publicSignals[1],
      newCommitment: change,
      leafIndex: newLeafIndex,
      blockNumber: BigInt(events.length + 1),
      txHash: hash,
      logIndex: 0,
    });
    return newLeafIndex;
  }
  await withdraw(
    "withdraw1FromDeposits",
    1,
    0,
    10n ** 18n,
    4n * 10n ** 17n,
    1,
    false
  );
  const change0 = await withdraw(
    "withdraw0",
    0,
    0,
    10n ** 18n,
    4n * 10n ** 17n,
    0
  );
  const change1 = await withdraw(
    "withdraw1",
    1,
    0,
    10n ** 18n,
    4n * 10n ** 17n,
    1
  );
  await withdraw(
    "withdrawChange0",
    0,
    1,
    6n * 10n ** 17n,
    6n * 10n ** 17n,
    change0
  );
  await withdraw(
    "withdrawChange1",
    1,
    1,
    6n * 10n ** 17n,
    6n * 10n ** 17n,
    change1
  );
  for (let i = 0; i < deposits.length; i++) {
    const deposit = deposits[i];
    const secrets = deriveNoteSecretsV2(keys, scope, deposit.recoveryNonce, 0);
    const result = await checked(
      await proveCommitment(
        { value: deposit.value, label: deposit.label, ...secrets },
        artifacts("commitment")
      ),
      "commitment"
    );
    if (
      result.publicSignals[0] !== deposit.commitment ||
      result.publicSignals[1] !==
        computeNullifierHashV2(secrets.nullifier, deposit.label)
    ) {
      throw new Error("V2 commitment output mismatch");
    }
    proofs[`ragequit${i}`] = serializeProof(result);
  }
  const changeSecrets = deriveNoteSecretsV2(
    keys,
    scope,
    deposits[0].recoveryNonce,
    1
  );
  proofs.ragequitChange0 = serializeProof(
    await checked(
      await proveCommitment(
        {
          value: 6n * 10n ** 17n,
          label: deposits[0].label,
          ...changeSecrets,
        },
        artifacts("commitment")
      ),
      "commitment"
    )
  );
  // Restore from seed on another device, without any local allocation state or search window.
  const secondDeviceSeed = await vault.decryptSeed(
    vault.parseBackup(backupFile),
    "hylsia-v2-fixture-password"
  );
  const restored = discoverNotesV2(
    deriveMasterKeysV2(secondDeviceSeed),
    scope,
    events
  );
  if (
    restored.notes
      .filter(n => !n.spent && n.value > 0n)
      .reduce((sum, n) => sum + n.value, 0n) !== deposits[2].value
  ) {
    throw new Error("Seed-only recovery balance mismatch");
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        protocol: V2_PROTOCOL,
        developmentOnly: true,
        chainId: 31337,
        deployer,
        pool,
        scope,
        stateRootAfterDeposits,
        aspRoot: asp.root,
        deposits,
        events,
        ...proofs,
        artifactPins: manifest.circuits,
        backupRecovery: {
          protocol: V2_PROTOCOL,
          envelopeVersion: 2,
          kdfIterations: vault.PBKDF2_ITERATIONS,
          artifactNamespace: base,
          runtime: "node",
        },
      },
      (_, value) => (typeof value === "bigint" ? value.toString() : value),
      2
    ) + "\n"
  );
  console.log(
    "V2: encrypted-backup restore, 9 real proofs, all 46 public-input mutations rejected, cross-device recovery passed. Wrote v2 fixture only."
  );
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
