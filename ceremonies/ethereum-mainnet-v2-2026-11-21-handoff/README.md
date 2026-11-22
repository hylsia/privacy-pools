# Hylsia native ETH: Ethereum ceremony and review handoff

This is a contribution/source-review handoff for Ethereum mainnet (chain ID 1).
It is not a production release, audit approval, deployment record, or a usable mainnet pool.
No mainnet transaction was signed or sent in this preparation.
The operator contribution source records automation in its original repository context; independent participants should use the separate workflow below.

## What is included

- The immutable original circuit snapshot, public phase-1 transcript and initial challenges under `ceremony/`.
- Successful full snarkjs phase-1 verification output and its exit status under `phase1-verification/`.
- Exactly ONE LOCAL OPERATOR phase-2 contribution per circuit under `operator/`, with matching Bellman challenges and successful R1CS/transcript verification logs. These are not final keys. Two contributions on the same operator machine would not establish participant independence.
- Current native ETH contract, runtime and deployment source extracts under `review-source/`. Development verifiers and proof fixtures are explicitly development-only regression material. This source extract is not the deployable application build or finalized release package.
- A successful owned-local-chain deployment smoke using an Anvil test key, shared owner/publisher custody and chain ID 1. This is local validation, not an Ethereum mainnet receipt or production wallet/browser validation.
- `handoff.json` binds the included files by SHA-256 and length. Compare the archive digest through the coordinator's authenticated channel; a manifest by itself does not prove origin or independent review.

Both circuits are shared across target networks. The original preparation workspace records chain 4663; this handoff targets chain 1. A final Ethereum release must be built explicitly for chain ID 1 and has its own content binding and onchain scope. No manifest was relabelled to claim an approved Ethereum release.

## Independent participant workflow

Use a controlled environment under the independent participant's custody. Verify the archive digest, inspect the source and check the circuit/R1CS and public transcript provenance independently. See `review-source/docs/privacy-pools/mainnet-ceremony.md`.

Install the pinned tools from the provided package lock:

~~~sh
cd review-source
npm ci
cd ..
~~~

Run full phase-1 verification independently. It can take tens of minutes because the public file comes from a larger ceremony:

~~~sh
node review-source/node_modules/snarkjs/build/cli.cjs powersoftau verify ceremony/phase1.ptau -v
~~~

Verify the coordinator's current withdrawal and commitment keys:

~~~sh
node review-source/node_modules/snarkjs/build/cli.cjs zkey verify ceremony/withdraw/withdraw.r1cs ceremony/phase1.ptau operator/withdraw_0001.zkey
node review-source/node_modules/snarkjs/build/cli.cjs zkey verify ceremony/commitment/commitment.r1cs ceremony/phase1.ptau operator/commitment_0001.zkey
~~~

After successful checks, contribute interactively to BOTH circuits. Use a truthful contribution name; the name alone does not establish independence. Do not put entropy, wallet keys or seed phrases into commands, logs or chat. The proving-key response files are public ceremony artifacts and do not require a wallet key:

~~~sh
mkdir responses
node review-source/node_modules/snarkjs/build/cli.cjs zkey contribute operator/withdraw_0001.zkey responses/withdraw_0002.zkey --name="independent-participant"
node review-source/node_modules/snarkjs/build/cli.cjs zkey contribute operator/commitment_0001.zkey responses/commitment_0002.zkey --name="independent-participant"
node review-source/node_modules/snarkjs/build/cli.cjs zkey verify ceremony/withdraw/withdraw.r1cs ceremony/phase1.ptau responses/withdraw_0002.zkey
node review-source/node_modules/snarkjs/build/cli.cjs zkey verify ceremony/commitment/commitment.r1cs ceremony/phase1.ptau responses/commitment_0002.zkey
~~~

Return the two response files, public contribution hashes and verification logs. Bellman-compatible participants can use the matching `operator/*_0001.mpcparams` challenges; their responses still require verified import and transcript checks.

## Remaining production steps

Freeze and verify the actual independent response chain, agree on a future unpredictable final beacon, finalize and reverify both keys. Build an Ethereum-targeted release from the real final files. Regenerate final-key real-proof tests and validate the production browser/wallet/service bundle. Independent review must bind the exact final release ID, manifest digest, verifiers and deployed sources; this handoff and a local test run cannot serve as that approval.

Only then simulate the exact package against Ethereum mainnet, confirm the current wallet balance covers the simulated cost, broadcast, and reconcile actual receipts. The deployment release registry remains unchanged and empty.
