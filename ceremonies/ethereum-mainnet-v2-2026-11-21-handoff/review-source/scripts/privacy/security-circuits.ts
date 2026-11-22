/** Read-only frozen-artifact checks. Writes only the additional public test proof fixture, never keys or verifiers.
 * Synthetic deterministic test notes; no user seed, secret or environment file is read or printed.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { keccak256, toBytes } from "viem";
import { MerkleTree } from "../../shared/privacy/merkleTree";
import {
  computeCommitment,
  computeLabel,
  computePrecommitment,
  deriveMasterKeys,
  deriveNoteSecrets,
} from "../../shared/privacy/notes";
import {
  proveCommitment,
  proveWithdraw,
  verifyLocally,
  type WithdrawCircuitInputs,
} from "../../shared/privacy/prover";
const dir = "client/public/zk/";
const manifest = JSON.parse(fs.readFileSync(dir + "manifest.json", "utf8"));
const artifacts = (name: string) => {
  const c = manifest.circuits[name];
  const read = (entry: { path: string; sha256: string }) => {
    const bytes = fs.readFileSync(dir + entry.path);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      entry.sha256
    );
    return new Uint8Array(bytes);
  };
  return { wasm: read(c.wasm), zkey: read(c.zkey) };
};
const wa = artifacts("withdraw");
const ca = artifacts("commitment");
const vkey = JSON.parse(
  fs.readFileSync(dir + manifest.circuits.withdraw.vkey.path, "utf8")
);
const fixture = JSON.parse(
  fs.readFileSync("contracts/test/fixtures/pool.json", "utf8")
);
const keys = deriveMasterKeys(
  toBytes(keccak256(toBytes("hylsia-privacy-pool-fixture-seed")))
);
const s0 = deriveNoteSecrets(keys, BigInt(fixture.scope), 0, 0);
const s1 = deriveNoteSecrets(keys, BigInt(fixture.scope), 0, 1);
const label = BigInt(fixture.deposits[0].label);
const max = (1n << 128n) - 1n;
const field =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const state = new MerkleTree();
state.insert(computeCommitment(max, label, computePrecommitment(s0)));
const asp = new MerkleTree();
asp.insert(label);
const input: WithdrawCircuitInputs = {
  withdrawnValue: max,
  existingValue: max,
  label,
  existingNullifier: s0.nullifier,
  existingSecret: s0.secret,
  newNullifier: s1.nullifier,
  newSecret: s1.secret,
  context: 123n,
  stateRoot: state.root,
  ASPRoot: asp.root,
  stateIndex: 0,
  ASPIndex: 0,
  stateSiblings: state.proof(0).siblings,
  ASPSiblings: asp.proof(0).siblings,
};
let rejected = 0;
const cases: [string, Partial<WithdrawCircuitInputs>][] = [
  ["withdraw 2^128", { withdrawnValue: 1n << 128n }],
  ["existing 2^128", { existingValue: 1n << 128n }],
  ["field subtraction wrap", { withdrawnValue: max, existingValue: 1n }],
  ["field minus one", { withdrawnValue: field - 1n }],
  ["negative value", { withdrawnValue: -1n }],
  [
    "wrong state sibling",
    { stateSiblings: [0n, ...input.stateSiblings.slice(1)] },
  ],
  ["wrong ASP sibling", { ASPSiblings: [0n, ...input.ASPSiblings.slice(1)] }],
  ["state index outside tree", { stateIndex: 2 ** 20 }],
  ["ASP index outside tree", { ASPIndex: 2 ** 20 }],
  ["wrong secret", { existingSecret: s0.secret + 1n }],
];
for (const [name, patch] of cases) {
  await assert.rejects(
    () => proveWithdraw({ ...input, ...patch }, wa),
    undefined,
    name
  );
  rejected++;
}
const started = performance.now();
const valid = await proveWithdraw(input, wa);
assert(await verifyLocally(vkey, valid));
const proofMs = Math.round(performance.now() - started);
for (let i = 0; i < 6; i++) {
  const changed = { ...valid, publicSignals: [...valid.publicSignals] };
  changed.publicSignals[i]++;
  assert.equal(
    await verifyLocally(vkey, changed),
    false,
    `public signal ${i} must bind`
  );
}
await assert.rejects(() =>
  proveCommitment(
    { value: 1n << 128n, label, nullifier: s1.nullifier, secret: s1.secret },
    ca
  )
);
const change = await proveCommitment(
  {
    value: 600000000000000000n,
    label,
    nullifier: s1.nullifier,
    secret: s1.secret,
  },
  ca
);
assert.equal(
  change.publicSignals[0].toString(),
  fixture.withdraw1.changeCommitment
);
const dec = (x: bigint) => x.toString();
const duplicate = await proveCommitment(
  {
    value: 1000000000000000000n,
    label: computeLabel(BigInt(fixture.scope), 4n),
    nullifier: s0.nullifier,
    secret: s0.secret,
  },
  ca
);
const encode = (result: typeof change) => ({
  pA: result.proof.pA.map(dec),
  pB: result.proof.pB.flat().map(dec),
  pC: result.proof.pC.map(dec),
  pubSignals: result.publicSignals.map(dec),
});
const publicFixture = {
  ragequitChange: encode(change),
  ragequitDuplicate: encode(duplicate),
};
fs.writeFileSync(
  "contracts/test/fixtures/security.json",
  JSON.stringify(publicFixture, null, 2) + "\n"
);
console.log(
  JSON.stringify({
    validProofs: 3,
    invalidWitnessesRejected: rejected + 1,
    publicInputMutationsRejected: 6,
    max128WithdrawProofMs: proofMs,
    peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    platform: `${process.platform}/${process.arch}`,
    fixture: "contracts/test/fixtures/security.json",
  })
);
process.exit(0); // snarkjs worker pool otherwise keeps Node alive
