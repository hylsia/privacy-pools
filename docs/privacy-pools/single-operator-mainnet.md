# Operator-authorized Ethereum native ETH release

On 22 November 2026, the project owner explicitly authorized deployment to Ethereum mainnet without
independent ceremony contributors. This release uses a **single-operator trusted setup** and has
**no independent security audit**. The same operator made both phase-2 contributions; contribution
counts and the public beacon do not establish independent participation.
Setup soundness therefore depends on this sole operator's handling and destruction of the phase-2
secret material; the beacon does not supply an independent contributor.

This authorization applies to contract deployment for the exact Ethereum package below. It does not
approve an unrelated package, Robinhood Chain deployment, or public application/service activation.
The application's independently reviewed release registry remains unchanged.

## Exact package

| Field | Value |
| --- | --- |
| Network | Ethereum mainnet, chain ID `1` |
| Protocol | `hylsia-pp-v2-eth` |
| Asset | Native ETH, variable amounts; no ERC-20 or fixed-denomination pools |
| Release ID | `23f30ccaa7c30be08724c67b226d37d51b6d4a0310866807f4c73637e54031ef` |
| Artifact manifest SHA-256 | `546ae336183d51bf580d7118b5a945581d6d2bdbb988b12d305e338350e55c32` |
| Deployer, owner and ASP publisher | `0x5636835544d9D49f43dfDA695a51dcB398dDE6cF` |
| Minimum deposit | `0` wei configured; deposits must still have a positive value |
| Pool | [`0xAC84cFAC0a7C55760197b0681576CD27837cCfea`](https://eth.blockscout.com/address/0xAC84cFAC0a7C55760197b0681576CD27837cCfea) |
| Pool deployment block | `26465235` |
| Pool transaction | [`0xd22547f4a1c6c89eb3bfd938bcbedf76117e2b94a7f791eae4e91b5202eabc32`](https://eth.blockscout.com/tx/0xd22547f4a1c6c89eb3bfd938bcbedf76117e2b94a7f791eae4e91b5202eabc32) |

All five deployment transactions succeeded: two Poseidon libraries, two final verifiers and the pool.
The [receipt-verified deployment record](../../contracts/deployments/1.json) records each address and
transaction hash. Actual deployment gas cost was **0.001513695325544250 ETH**; the deployer had
**0.003486304674455750 ETH** remaining at the post-deployment check. No ETH was deposited into the pool
as part of deployment.

The deployed final verifiers are `0x3482C211042894457b48F1870Fc83731cd085B13` (withdrawal) and
`0x0170A74750475BF45DEd1b1873d63Ca583EE42Ea` (commitment). The pool's owner and ASP publisher both
match the explicitly selected wallet above. Robinhood Chain mainnet has no recorded deployment.

Sourcify reports `runtimeMatch: exact_match` for the pool and both verifiers. Both verifier creation
matches are also exact; the pool's creation result is `match`, not `exact_match`. The
[public verification report](../security/ethereum-mainnet-deployment-verification.json) retains the
precise source-verification results, actual gas costs, canonical receipts and runtime checks. Source
verification does not establish an independent security audit.

The local package is `releases/ethereum-mainnet-eth-v2-2026-11-22-single-operator/`. Its artifact loader
requires the exact manifest bytes, protocol and verifying-key pins. Preserve this entire package and the
final ceremony directory in durable storage: generated releases and proving keys are excluded from Git.
The earlier independent-contributor handoff is a historical initial challenge, not these final keys.

## Ceremony and acceptance evidence

The finalization tool reuses the [pinned successful full phase-1 verification](../security/mainnet-phase1-verification.json)
only after checking the receipt, transcript, verifier CLI and complete successful log hashes. It adds a
fresh second contribution from the same operator, with entropy generated and consumed in process.
Before selecting the beacon, it records a future Ethereum block and waits for confirmations. Both
final zkeys are verified against the original circuit snapshots and public phase-1 transcript.

The [public finalization record](../security/ethereum-mainnet-single-operator-finalization.json) is also retained locally as
`ceremonies/ethereum-mainnet-v2-2026-11-22-single-operator/single-operator-finalization.json`
(SHA-256 `0382345776b3ac8dac33f270085ebee87bae57d501b4ae3cbd56c9fcedbf45f5`).
All three contribution sections are checked in each actual final key: two contributions from one
operator, followed by the beacon. Initial and development keys are rejected by release packaging.

The exact final-key package passed:

- Nine real proofs: five withdrawal proofs and four commitment proofs.
- Rejection of all 46 tested public-input mutations.
- Encrypted native ETH backup restoration and seed-based note recovery.
- Seventeen native ETH contract regressions, including repeated-secret deposits, independent
  withdrawal/ragequit access, change notes and the selected shared owner/publisher roles.
- Application regression tests: 628 tests in 38 files.
- Application and privacy-script TypeScript checks; all 37 frozen v1 artifact hashes remain unchanged.

The proof and contract checks execute locally with the final release's actual verifiers. They are
validation evidence, not an independent audit or a live-mainnet deposit/withdrawal test.
The [final-key acceptance report](../security/ethereum-mainnet-final-key-acceptance.json) preserves the
exact report bytes pinned by the operator authorization.

## Deployment authorization

The [operator authorization](../security/ethereum-mainnet-single-operator-release.json) binds the exact
chain, release ID, manifest, deployer, constructor parameters and final-key acceptance report.
[`config/operator-mainnet-deployments.json`](../../config/operator-mainnet-deployments.json) pins its
SHA-256. The CLI accepts this separate authorization only with `--operator-authorized`.

```sh
# Read-only simulation against Ethereum mainnet; no signing key is forwarded.
npm run zk:v2:deploy:native-eth -- \
  --network ethereum-mainnet \
  --release releases/ethereum-mainnet-eth-v2-2026-11-22-single-operator \
  --operator-authorized
```

Broadcast additionally checks actual funding and pending nonces, then passes the configured signer
only to the signing child process. A release's `broadcast-attempt.json` prevents signing twice.
Never delete that marker or rerun a partial deployment to bypass reconciliation. The receipt record
is created only after checking actual RPC receipts, constructor roles/scope, final verifier bytecode,
pool runtime, library links, and simulated addresses/nonces. Explorer verification can be retried
separately without sending deployment transactions again.

Read-only reconciliation uses the original deployment plan and broadcast log:

```sh
# Does not run a deployment script, load a signer or send a transaction.
npm run zk:v2:deploy:native-eth -- \
  --network ethereum-mainnet \
  --release releases/ethereum-mainnet-eth-v2-2026-11-22-single-operator \
  --operator-authorized --reconcile
```

Reconciliation refuses to overwrite an existing deployment record. This package is already recorded;
inspect its record and receipts instead of running another deployment or removing its attempt marker.

`npm run zk:mainnet:preflight -- --network ethereum-mainnet --offline` now reports this contract's
record separately from the inactive application binding. `contractDeploymentRecorded: true` confirms
that a validated record exists. `readyForBroadcast: false` does not undo the deployment: a second
deployment is unnecessary, and the application's separate reviewed-release gate is still closed.

The default reviewed-release deployment route and the application's mainnet gate still require their
own exact reviewed release. This operator authorization does not mark `independentReview`,
`reviewedRelease` or `productionReady` as true.

## Application activation

Contract deployment does not switch the hosted website or start an ASP publisher or relayer. The owner
subsequently authorized the [Testnet/Mainnet application profiles](application-mainnet.md), using manually
approved publisher-wallet signatures and self-paid withdrawals. This is a separate source change and
requires deploying the updated client/server to hosting; it does not claim an independent audit. Before
offering this release in the application, its exact artifacts, deployment binding, operator service
configuration and browser/wallet flows must be integrated and validated together under the selected
release policy. Do not label this setup independently reviewed when enabling that separate flow.
Testnet notes and balances do not migrate into the Ethereum pool.
