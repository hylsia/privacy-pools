/**
 * Generate real Groth16 proofs for the Foundry tests (contracts/test/PrivacyPool.t.sol).
 *
 * The test deploys the pool from DEPLOYER with nonce 0 on chain 31337, so the
 * pool address — and therefore SCOPE and every label — is deterministic and can
 * be reproduced here without running the EVM.
 *
 * Usage: npx tsx scripts/privacy/gen-fixtures.ts   (after `npm run zk:build`)
 */
import fs from "node:fs";
import path from "node:path";
import { getContractAddress, keccak256, toBytes, type Address } from "viem";
import { TREE_DEPTH } from "../../shared/privacy/constants";
import { computeContext, computeScope } from "../../shared/privacy/context";
import { MerkleTree } from "../../shared/privacy/merkleTree";
import {
  computeCommitment,
  computeLabel,
  computeNullifierHash,
  computePrecommitment,
  deriveMasterKeys,
  deriveNoteSecrets,
} from "../../shared/privacy/notes";
import { proveCommitment, proveWithdraw, type ProofResult } from "../../shared/privacy/prover";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BUILD = path.join(ROOT, "circuits", "build");
const OUT = path.join(ROOT, "contracts", "test", "fixtures", "pool.json");

const CHAIN_ID = 31337;
const DEPLOYER: Address = "0x1111111111111111111111111111111111111111";
const RECIPIENT: Address = "0x00000000000000000000000000000000000000a1";
const RECIPIENT2: Address = "0x00000000000000000000000000000000000000a2";
const RELAYER: Address = "0x00000000000000000000000000000000000000f1";
const ZERO: Address = "0x0000000000000000000000000000000000000000";

const artifacts = (name: string) => ({
  wasm: new Uint8Array(fs.readFileSync(path.join(BUILD, `${name}_js`, `${name}.wasm`))),
  zkey: new Uint8Array(fs.readFileSync(path.join(BUILD, `${name}_final.zkey`))),
});

const s = (v: bigint | number) => BigInt(v).toString(10);
const proofJson = (r: ProofResult) => ({
  pA: r.proof.pA.map(s),
  pB: [...r.proof.pB[0].map(s), ...r.proof.pB[1].map(s)],
  pC: r.proof.pC.map(s),
  pubSignals: r.publicSignals.map(s),
});

async function main() {
  const t0 = Date.now();
  const pool = getContractAddress({ from: DEPLOYER, nonce: 0n });
  const scope = computeScope(pool, CHAIN_ID);
  const seed = toBytes(keccak256(toBytes("hylsia-privacy-pool-fixture-seed")));
  const keys = deriveMasterKeys(seed);

  // ── deposits ──
  const values = [10n ** 18n, 5n * 10n ** 17n, 2n * 10n ** 18n];
  const state = new MerkleTree(TREE_DEPTH);
  const asp = new MerkleTree(TREE_DEPTH);
  const deposits = values.map((value, i) => {
    const secrets = deriveNoteSecrets(keys, scope, i, 0);
    const precommitment = computePrecommitment(secrets);
    const label = computeLabel(scope, BigInt(i + 1));
    const commitment = computeCommitment(value, label, precommitment);
    const leafIndex = state.insert(commitment);
    asp.insert(label);
    return { i, value, secrets, precommitment, label, commitment, leafIndex };
  });
  const stateRootAfterDeposits = state.root;
  const aspRoot = asp.root;

  const withdrawArtifacts = artifacts("withdraw");
  const commitmentArtifacts = artifacts("commitment");

  // ── withdraw 1: partial spend of deposit 0 via relayer ──
  const d0 = deposits[0];
  const w1 = { recipient: RECIPIENT, relayer: RELAYER, fee: 10n ** 16n, deadline: 0n };
  const w1Amount = 4n * 10n ** 17n;
  const next01 = deriveNoteSecrets(keys, scope, 0, 1);
  const stateProof0 = state.proof(d0.leafIndex);
  const aspProof0 = asp.proof(0);
  const r1 = await proveWithdraw(
    {
      withdrawnValue: w1Amount,
      stateRoot: stateProof0.root,
      ASPRoot: aspRoot,
      context: computeContext(scope, w1),
      label: d0.label,
      existingValue: d0.value,
      existingNullifier: d0.secrets.nullifier,
      existingSecret: d0.secrets.secret,
      newNullifier: next01.nullifier,
      newSecret: next01.secret,
      stateSiblings: stateProof0.siblings,
      stateIndex: stateProof0.index,
      ASPSiblings: aspProof0.siblings,
      ASPIndex: aspProof0.index,
    },
    withdrawArtifacts,
  );
  const change = d0.value - w1Amount;
  const changeCommitment = computeCommitment(change, d0.label, computePrecommitment(next01));
  if (r1.publicSignals[0] !== changeCommitment) throw new Error("newCommitment mismatch");
  if (r1.publicSignals[1] !== computeNullifierHash(d0.secrets.nullifier)) throw new Error("nullifier mismatch");
  if (r1.publicSignals[2] !== w1Amount) throw new Error("withdrawnValue mismatch");
  console.log("withdraw1 proved", ((Date.now() - t0) / 1000).toFixed(1), "s");

  // ── withdraw 2: spend the change note fully, self-relayed ──
  const changeLeaf = state.insert(changeCommitment); // index 3, mirrors what the contract does
  const w2 = { recipient: RECIPIENT2, relayer: ZERO, fee: 0n, deadline: 0n };
  const next02 = deriveNoteSecrets(keys, scope, 0, 2);
  const stateProofChange = state.proof(changeLeaf);
  const r2 = await proveWithdraw(
    {
      withdrawnValue: change,
      stateRoot: stateProofChange.root,
      ASPRoot: aspRoot,
      context: computeContext(scope, w2),
      label: d0.label,
      existingValue: change,
      existingNullifier: next01.nullifier,
      existingSecret: next01.secret,
      newNullifier: next02.nullifier,
      newSecret: next02.secret,
      stateSiblings: stateProofChange.siblings,
      stateIndex: stateProofChange.index,
      ASPSiblings: aspProof0.siblings,
      ASPIndex: aspProof0.index,
    },
    withdrawArtifacts,
  );
  console.log("withdraw2 proved", ((Date.now() - t0) / 1000).toFixed(1), "s");

  // ── withdraw 3: deposit 2 with a deadline (for the Expired test) ──
  const d2 = deposits[2];
  const w3 = { recipient: RECIPIENT, relayer: RELAYER, fee: 0n, deadline: 1_900_000_000n };
  const next21 = deriveNoteSecrets(keys, scope, 2, 1);
  const stateProof2 = state.proof(d2.leafIndex); // against the 4-leaf root
  const aspProof2 = asp.proof(2);
  const r3 = await proveWithdraw(
    {
      withdrawnValue: 10n ** 18n,
      stateRoot: stateProof2.root,
      ASPRoot: aspRoot,
      context: computeContext(scope, w3),
      label: d2.label,
      existingValue: d2.value,
      existingNullifier: d2.secrets.nullifier,
      existingSecret: d2.secrets.secret,
      newNullifier: next21.nullifier,
      newSecret: next21.secret,
      stateSiblings: stateProof2.siblings,
      stateIndex: stateProof2.index,
      ASPSiblings: aspProof2.siblings,
      ASPIndex: aspProof2.index,
    },
    withdrawArtifacts,
  );
  console.log("withdraw3 proved", ((Date.now() - t0) / 1000).toFixed(1), "s");

  // ── ragequit: deposit 1 ──
  const d1 = deposits[1];
  const rq = await proveCommitment(
    { value: d1.value, label: d1.label, nullifier: d1.secrets.nullifier, secret: d1.secrets.secret },
    commitmentArtifacts,
  );
  if (rq.publicSignals[0] !== d1.commitment) throw new Error("ragequit commitment mismatch");
  // ragequit proof for deposit 0 (to show it is rejected once the note is spent)
  const rq0 = await proveCommitment(
    { value: d0.value, label: d0.label, nullifier: d0.secrets.nullifier, secret: d0.secrets.secret },
    commitmentArtifacts,
  );
  console.log("ragequits proved", ((Date.now() - t0) / 1000).toFixed(1), "s");

  const fixture = {
    chainId: CHAIN_ID,
    deployer: DEPLOYER,
    pool,
    scope: s(scope),
    deposits: deposits.map((d) => ({
      value: s(d.value),
      precommitment: s(d.precommitment),
      label: s(d.label),
      commitment: s(d.commitment),
      leafIndex: d.leafIndex,
    })),
    stateRootAfterDeposits: s(stateRootAfterDeposits),
    stateRootAfterWithdraw1: s(stateProofChange.root),
    aspRoot: s(aspRoot),
    withdraw1: { withdrawal: w1AsJson(w1), amount: s(w1Amount), changeCommitment: s(changeCommitment), ...proofJson(r1) },
    withdraw2: { withdrawal: w1AsJson(w2), amount: s(change), ...proofJson(r2) },
    withdraw3: { withdrawal: w1AsJson(w3), amount: s(10n ** 18n), ...proofJson(r3) },
    ragequit1: { depositIndex: 1, ...proofJson(rq) },
    ragequit0: { depositIndex: 0, ...proofJson(rq0) },
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(fixture, null, 2));
  console.log(`wrote ${path.relative(ROOT, OUT)} (pool ${pool}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

function w1AsJson(w: { recipient: Address; relayer: Address; fee: bigint; deadline: bigint }) {
  return { recipient: w.recipient, relayer: w.relayer, fee: s(w.fee), deadline: s(w.deadline) };
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
  console.error(err);
  process.exit(1);
});
