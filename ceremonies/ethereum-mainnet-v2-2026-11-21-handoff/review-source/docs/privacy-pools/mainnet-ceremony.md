# V2 mainnet ceremony preparation

This workflow prepares **initial phase-2 challenges**, not production proving keys or a deployment.
The protocol is still `hylsia-pp-v2-candidate`; Hylsia has no approved mainnet release or pool address.
The initial `*_0000.zkey` files have **zero circuit-specific contributions** and must never be used
to secure real funds. A successful `zkey verify` establishes consistency, not a completed ceremony.

## Public phase 1

The preparation script accepts only the public, prepared power-16 transcript listed by
[snarkjs](https://github.com/iden3/snarkjs#7-prepare-phase-2). Its pinned **BLAKE2b-512** digest is:

```text
6a6277a2f74e1073601b4f9fed6e1e55226917efb0f0db8a07d98ab01df1ccf43eb0e8c3159432acd4960e2f29fe84a4198501fa54c8dad9e43297453efec125
```

Download it into the ignored `ceremonies/` directory:

```sh
mkdir -p ceremonies/phase1
curl --fail --location https://circom.info/powersOfTau28_hez_final_16.ptau \
  --output ceremonies/phase1/powersOfTau28_hez_final_16.ptau
```

The identically named file under `circuits/ptau/` belongs to Hylsia's frozen **local development**
setup. The preparation script rejects it by its content digest. Keep it unchanged for v1 reproduction.
No URL, filename, or successful self-consistency verification can substitute for provenance.

## Create an isolated session

```sh
npm run zk:v2:ceremony:prepare -- \
  --ptau ceremonies/phase1/powersOfTau28_hez_final_16.ptau \
  --out ceremonies/robinhood-mainnet-v2-<new-session>
```

The output must be a new directory below `ceremonies/`; existing sessions and symlinked output
directories are refused. The command does not load `.env`, signer or service keys, send transactions,
contribute entropy, export Solidity verifiers, modify active key pins, or publish application assets.

It snapshots both circuit sources, their local Merkle dependency, all circomlib circuit dependencies,
and package metadata/lockfile before compiling with `--O1`. It copies and rechecks the public phase-1
file, compiles each snapshot, generates initial zkeys, verifies their consistency against the snapshot
R1CS and phase 1, and exports Bellman-format challenges. It does **not** claim full phase-1 transcript
verification. Progress names are printed; detailed output goes into `logs/`.

Full phase-1 verification is a separate prerequisite for accepting the challenge for a ceremony:

```sh
npm run zk:v2:ceremony:verify:phase1 -- \
  ceremonies/robinhood-mainnet-v2-<new-session>/phase1.ptau -v
```

Retain its complete successful output and independently check the published digest. The power-16
file originates in a power-28 ceremony; snarkjs recomputes the original initial-challenge hash, so
this command can take tens of minutes. Until it completes, transcript verification stays pending.

The resulting `manifest.json` records source and output SHA-256 hashes, phase-1 provenance, toolchain
versions, compiler options, git HEAD and whether the working tree was dirty. A dirty snapshot is useful
for development handoff and is explicitly **not a reviewed release**. Failure leaves a `failed` marker
and its stage; a session is never silently reused. Success retains all of these values:

```json
{
  "status": "awaiting-phase1-verification-and-independent-contributions",
  "productionReady": false,
  "broadcastAllowed": false,
  "phase1TranscriptVerified": false,
  "phase2ContributionCount": 0
}
```

Keep the full workspace and manifest together. The large generated files are ignored by git;
the preparation record under `docs/security/` identifies the local session for review. It does not
serve as a deployment record or independently authenticate a release.

On 21 November 2026, the local session
`ceremonies/robinhood-mainnet-v2-2026-11-21-challenges/` completed initial-key and challenge generation
for both circuits. The [preparation record](../security/mainnet-ceremony-preparation.json) pins its
manifest hash. All **86** recorded source, transcript, circuit-output and log files passed size/hash
checks; both compiled R1CS digests match the separately tested v2 development circuits. This only
establishes local preparation consistency. The original preparation manifest records pending full
phase-1 verification and zero phase-2 contributions; it is retained unchanged as an initial snapshot.

A subsequent full run completed successfully on 21 November 2026, with `Powers of Tau Ok!` and exit code
0. The [verification receipt](../security/mainnet-phase1-verification.json) binds the public transcript,
the unchanged preparation CLI and the complete successful log by SHA-256. This is local phase-1
verification evidence, not independent protocol review, final phase-2 keys or release approval.

## Independent contributions and finalization

A coordinator and reviewers still need to agree on the exact circuit snapshot, contribution process,
participant verification, and a future unpredictable final beacon. Independent participants must
recompute or verify the circuit/R1CS and transcript provenance before contributing. Both the withdrawal
and commitment circuits require their own phase-2 contribution chain.

For the direct snarkjs route, a participant can contribute interactively to a verified current zkey:

```sh
node node_modules/snarkjs/build/cli.cjs zkey contribute \
  <verified-current.zkey> <new-response.zkey> --name="<participant>"
node node_modules/snarkjs/build/cli.cjs zkey verify \
  <snapshot.r1cs> <verified-public-phase1.ptau> <new-response.zkey>
```

Never put entropy in chat, committed files, or shell arguments. For independently implemented
participants, the exported `.mpcparams` files support the Bellman workflow documented by
[snarkjs](https://github.com/iden3/snarkjs#18-provide-a-third-contribution-using-third-party-software).
Each response needs verification, a retained transcript, and its actual contribution identity/hash.
This repository does not infer participant independence from a name or from a local contribution.

After actual independent contributions, use the agreed beacon and reverify the final keys. Reviewers
must then bind the final verification keys and generated Solidity verifiers to an exact, reviewed
protocol release, regenerate its real-proof tests, and validate the browser/operator bundle against
those same pins. The existing v2 development verifiers and `/zk-v2-dev` namespace cannot be promoted
by renaming files or editing a readiness boolean.

Mainnet broadcast remains blocked until those steps, the independent security review, production
validation, public role/signer configuration, and the exact deployment simulation are complete.
See the [migration checklist](mainnet-migration.md).
