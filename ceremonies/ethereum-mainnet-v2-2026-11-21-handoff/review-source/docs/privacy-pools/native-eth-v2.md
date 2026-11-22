# Native ETH v2 implementation

The deployer now supports Ethereum mainnet (1) and Robinhood Chain mainnet (4663). Use the
[two-network guide](dual-mainnet.md) for explicit network selection and environment signing.

`hylsia-pp-v2-eth` is the production-target identity for Hylsia's native ETH pool. The contract, application
runtime, release-packaging pipeline and dedicated deployment entry are implemented. **No reviewed mainnet
release, production proving package or public mainnet pool is available yet.**

## Pool behavior

[`PrivacyPoolV2ETH`](../../contracts/src/v2/PrivacyPoolV2ETH.sol) uses the v2 accounting and circuits:

- Deposit native ETH with a precommitment and random public recovery nonce.
- Withdraw privately with association-set membership and a label-bound spend nullifier.
- Return unspent ETH to a change note, retaining its original deposit label.
- Allow the original depositor to ragequit without the association-set provider.
- Permanently stop new deposits through wind-down while retaining withdrawal and ragequit access.

Amounts are variable, subject to the configured minimum and the circuit's 128-bit limit. There are no fixed
denomination pools or ERC-20 deposits in this implementation. The constructor requires nonzero owner/publisher roles, deployed verifier code and a minimum within the circuit range. Owner and publisher may share a wallet; the relayer service is optional.

The native ETH identity has its own seed-derivation domain, authenticated backup protocol, activity-key
domain and `hylsia.pp.protocol-v2-eth.` device-storage namespace. The v1 and candidate-v2 backups remain
separate. Relabelling a backup does not convert it or migrate its notes. Recovery scans validated complete
RPC history; v1 snapshots cannot supply v2 recovery-nonce metadata.

## Local validation

```sh
npm run check
npm run check:privacy-scripts
npm test
forge test --root contracts -vv
npm run zk:v2:e2e -- --native-eth-local
npm run zk:v2:deploy:smoke
node --import tsx scripts/privacy/check-frozen-artifacts.ts
```

The native ETH E2E owns a disposable local Anvil. It uses **development verifiers**, restores an encrypted
native ETH backup, discovers intentionally duplicated deposits, runs the actual publisher/relayer,
generates a real private-withdrawal proof, ragequits the other deposit and recovers the change balance.
Its test-only deployment binding is in memory and removed afterward; no public record is generated.

The deployment smoke test owns another Anvil on `127.0.0.1:8552`. It uses chain ID 4663 to exercise the
mainnet-target Solidity template locally, with clearly marked development verifiers. It checks compilation,
the actual Forge simulation gas fields, local receipts, protocol identity, verifier code and library
reconciliation. It also matches the pool runtime, library links and constructor immutables, and rejects
altered pool bytecode. It does not contact Robinhood Chain or approve development keys for production.

## Prepare final ceremony artifacts

Complete the [ceremony process](mainnet-ceremony.md) for **both** circuits. The release builder requires
at least two phase-2 contributions and a final beacon in each actual zkey's contribution section. Counts
and participant names cannot establish independence: that remains part of independent review.

```sh
npm run zk:v2:release:build -- \
  --ceremony ceremonies/<verified-source-session> \
  --withdraw-zkey <final-withdraw.zkey> \
  --commitment-zkey <final-commitment.zkey> \
  --out releases/<new-session>
```

Initial keys and the current development keys are rejected before output creation. The builder validates
the ceremony snapshot and pinned public phase-1 digest, performs full phase-1 verification, recompiles
the circuit snapshots with the recorded compiler, compares their R1CS digests, and verifies the final keys.
Full phase-1 verification can take tens of minutes; its detailed log is retained.

It then generates final verification keys and Solidity verifiers, snapshots the native ETH deployment
sources/dependencies and runtime sources, and compiles a separate Foundry project. The content-derived
`releaseId` covers the input/output files, sources, dependency/toolchain evidence and ceremony metadata.
The package includes an exact-byte artifact-manifest SHA-256 pin. Generated files stay under ignored
`releases/`; v1 files, development keys and active website assets are not overwritten.

Successful preparation sets `status: ceremony-verified`, `productionReady: false` and
`reviewedRelease: false`. It establishes consistency and creates a reviewable package, not an approval.
No completed final production package was generated during implementation because independent ceremony
contributions and review remain outstanding.

The paths in the build example are placeholders. In this checkout, the prepared challenge workspace is
`ceremonies/robinhood-mainnet-v2-2026-11-21-challenges/`. Its `withdraw_0000.zkey` and
`commitment_0000.zkey` are initial keys with zero phase-2 contributions. Final keys are not yet available
there, so replacing only `--ceremony` in the example is insufficient. Do not create an empty
`ceremonies/source-session` directory or rename initial keys to make the command proceed.

The release CLI reports missing input paths together before reading keys or creating output. Complete
the phase-2 contribution and finalization workflow first, then pass the actual final-key file paths.

## Simulate and deploy the exact package

Merge the [mainnet profile](../../config/robinhood-mainnet.env.example) into your private environment.
It selects `hylsia-pp-v2-eth` on both server and client. Configure the public owner/publisher roles,
signer and a healthy production/archive RPC; an extra gas cap is optional.
Keystore deployments use `PRIVACY_DEPLOY_PASSWORD_FILE` pointing
to a password file in your secret store; deployment tools do not load the runtime service-key files.

```sh
# Read-only simulation; no signer is opened.
npm run zk:v2:deploy:native-eth -- --release releases/<session>
```

Simulation checks package integrity, chain ID, pending deployer transactions and role configuration, then
runs the packaged v2 deployment template. It compares the simulation's gas estimate at the selected fee
cap with an optional configured budget and writes a local `deployment-plan.json`, including funding gaps.
Broadcast requires enough actual wallet balance. That cost is a simulation
estimate, not a guarantee of final chain fees. The old `zk:deploy:robinhood-mainnet` entry still simulates
the legacy v1 deployment and is not the native ETH v2 deployer.

Before signing, close the independent protocol/security review and real browser, wallet, mobile and
production-host validation. Record the actual review evidence for the exact `releaseId` and manifest
digest in `REVIEWED_MAINNET_RELEASES` in `shared/privacy/mainnetRelease.ts`. The registry is currently
empty. A release approval for v2 never enables v1 or an unrelated package; no `.env` readiness flag bypasses it.

```sh
# Refused while the reviewed-release registry has no matching release.
npm run zk:v2:deploy:native-eth -- --release releases/<session> --broadcast
```

The deployer uses a keystore, Ledger or explicitly selected environment signer and deploys the final two verifiers, linked Poseidon
libraries and native ETH pool. A mainnet record is written only after actual successful receipts,
matching simulated addresses/nonces, onchain role/scope/protocol checks, compiled verifier checks and
pool-runtime/library/immutable checks. A failed or ambiguous broadcast is not retried automatically;
retain the package's Forge broadcast/cache data and reconcile its receipts before any further action.
`broadcast-attempt.json` prevents a second signing attempt from the same package until its receipts are
reconciled. Compilation uses `--force` so cached output cannot silently substitute deployment code.

After a verified deployment and release approval, stage the package's exact `artifacts/` files under
`client/public/zk-v2-eth/<releaseId>/`. The browser checks the deployment's manifest digest and key pins
before downloading proving material; it rejects substitutions and development manifests. Then sync:

```sh
npm run zk:deployments:sync -- --chain 4663 --v2-release releases/<session>
```

Sync preserves the production release binding, checks the published manifest and compares the onchain
verifiers with the matching packaged build. Rebuild client/server together, validate the production host,
fund the independent service roles and activate the pool only after the [migration checklist](mainnet-migration.md)
has actual closure evidence. Testnet balances and notes do not migrate automatically.

## Verification on 21 November 2026

- Type checking passed for the application and privacy scripts.
- The application suite passed **618 tests in 37 files**.
- The full contract suite passed **73 tests**, including 17 native ETH wrapper regressions with real
  development proofs and v2 accounting/replay invariants at 64 runs × 32 calls.
- The native ETH local E2E and owned-Anvil deployment-template smoke passed.
- The native ETH/mainnet-preparation build passed, with existing dependency annotation and large-chunk
  warnings. No development or initial ceremony keys were copied into public assets.
- Actual initial keys and current development keys were rejected by the release builder before output
  creation. All **37 frozen v1 files** retained their recorded SHA-256 digests.
- Offline mainnet preflight accepts the configured shared owner/publisher and environment signer for both
  target networks without requiring a relayer or custom gas cap. It still reports no pool record and
  `readyForBroadcast: false`. No final production package was built or public-chain transaction sent.
  Real browser/wallet/mobile validation, independent ceremony contributions and security review remain pending.
