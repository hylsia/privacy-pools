# Mainnet protocol v2 candidate

Status: experimental, local development only. **Not approved or deployed on mainnet.**
The default app, testnet pool, v1 circuits, proving files and deployment record continue to use v1.
The application and server can opt into v2 for local loopback Anvil development only.
This candidate is a protocol change requiring a new pool and new proving setup.

## H-01 design change

V1 spends `Poseidon1(nullifier)`. Two devices restoring the same seed can reuse a deposit index,
create two deposits with the same secrets and consume the same spend nullifier. The contract's
different deposit labels do not protect them in v1.

V2 spends `Poseidon2(nullifier, label)` in **both** the withdrawal and commitment/ragequit circuits.
The label is already bound to the existing commitment and is assigned by the pool using its
scope and incrementing deposit nonce. Repeating secrets across two deposits produces different
spend nullifiers; spending a particular note through either exit path still consumes the same nullifier.
The withdrawal keeps the label private. All value ranges, state membership, ASP membership,
withdrawal-context constraints and public signal ordering are retained from v1.

V2 also removes the need for coordinated deposit-index allocation:

- Generate a fresh public `recoveryNonce` from 248 random bits on each device.
- Derive version-specific master keys with `keccak256(seed || "hylsia-pp-v2-candidate:<purpose>") mod p`.
- Derive note secrets with `Poseidon4(masterKey, scope, recoveryNonce, hop)`.
- Submit `deposit(precommitment, recoveryNonce)`; the new `Deposited` event contains the recovery nonce.
- Recover by checking every deposit's public nonce against the seed-derived precommitment, then follow
  withdrawals using label-bound nullifiers and deterministic change secrets. There is no index search gap,
  per-device allocation file, or dependence on pending wallet requests for recovering confirmed notes.

The recovery nonce is a derivation input, not a secret or an ownership credential. Scope and the v2
master-key domain separate pools/chains and protocol versions. A caller can still create an unrecoverable
deposit by supplying a precommitment that does not match their seed/nonce; the production client must
construct and verify the pair together. Recovery requires complete, validated event history.

## Copied transactions and privacy

There is deliberately no duplicate-precommitment or duplicate-nonce rejection. Someone copying a pending
deposit can fund another note with the same precommitment and nonce, but receives another label. The
original transaction remains valid and its nullifier remains independent. A copier without the secrets
cannot prove ownership of either note; knowing the public nonce does not provide those secrets.
Only each label's original depositor can use its ragequit path. The seed owner may discover the copied
deposit and spend it privately if its label is screened into the ASP; this amounts to a donation by the copier.

Reusing a recovery nonce or precommitment publicly links the deposits. Randomness quality and a fresh
nonce per attempt remain necessary for privacy even though reuse no longer consumes another label's
spend nullifier in the tested cases. Public deposit timing, value and originating wallet remain visible.
The design and its hash/PRF assumptions still require independent cryptographic and front-running review.

## Reproduction

```sh
# Existing frozen development ptau must already be present. Never run zk:build for this candidate.
npm run zk:v2:build:dev
npm run zk:v2:fixtures
forge test --root contracts --match-contract PrivacyPoolV2Test -vv
npm test -- server/privacy/v2.test.ts server/privacy/v2Vault.test.ts server/privacy/artifacts.test.ts server/privacy/protocolIsolation.test.ts server/privacy/mainnet.test.ts
npm run zk:v2:e2e
node --import tsx scripts/privacy/check-frozen-artifacts.ts
```

`build-dev.ts` uses the existing **local development** phase-1 transcript and a new local phase-2
contribution. Verification of these files establishes consistency, not a production trust ceremony.
The isolated pipeline uses the [snarkjs setup and verification commands](https://github.com/iden3/snarkjs#guide).
It writes only `circuits/v2/build/` and `contracts/src/v2/dev-verifiers/`; fixtures go only into
`contracts/test/fixtures/v2/`. It pins source/R1CS/WASM/zkey/vkey/verifier hashes in its separate manifest,
explicitly sets `productionReady: false`, and does not publish assets to `client/public/zk`.
Rebuilding generates new development keys; regenerate the v2 fixtures afterward. Committed dev verifiers
and real-proof fixtures allow the contract tests to run without generating keys. Ignored build files are
needed only for regenerating proofs. A failed build marks its manifest incomplete.

The fixture generator exports a protocol-v2 encrypted backup, restores its seed on an independent instance,
and loads the separately pinned v2 artifacts through the browser-compatible loader using local files in Node.
It verifies nine real proofs and rejects changes to each of their 46 public signals. It checks both private
withdrawal chains of duplicated secrets, change spending, and a second independent encrypted-backup restore.
Contract tests additionally exercise copied-deposit withdrawal followed by
original-deposit ragequit, the reverse order of exits, replay rejection, depositor authorization,
wind-down exits, and rejection of v1 proofs by v2 verifiers and v2 proofs by v1 verifiers.
V2-specific stateful invariants use real proofs to mix private spends, depositor exits and surplus
donations, checking payout coverage and persistent spent-nullifier state. Setup requires a successful
private withdrawal before fuzzing, so the checks cannot pass solely because every proof was rejected.
An exit-order fuzz test also checks that both duplicate-secret deposits remain independently withdrawable.

An isolated [mainnet ceremony preparation workflow](mainnet-ceremony.md) now accepts only the pinned
public phase-1 transcript and creates source snapshots, R1CS/WASM files, **unsafe initial zkeys** and
phase-2 contribution challenges. It never replaces the development keys or publishes a release.
Independent contributions, finalization and review remain outstanding.

## Protocol-bound backups and artifacts

`shared/privacy/v2/vault.ts` provides explicit v2 encrypt, parse, decrypt and fingerprint operations.
It uses the existing version-2 backup **envelope** with `protocol: hylsia-pp-v2-candidate`; AES-GCM
authenticates that protocol in its additional data. Its fingerprint uses v2 master-key derivation.
The existing vault API continues to read/write protocol v1, including legacy single-pool backup files.
Changing a backup's protocol and fingerprint fields does not convert its ciphertext to another protocol.
Imports reject protocol mismatch before decryption. Untrusted backup files cannot request more than
10,000,000 PBKDF2 iterations; new backups retain the 600,000-iteration default.

`shared/privacy/protocols.ts` defines separate protocol IDs and artifact namespaces. The loader in
`client/src/privacy/artifacts.ts` checks the manifest protocol and public-signal layout, validates file
paths, SHA-256 digests and declared byte lengths, and verifies the actual verification key before
downloading WASM/zkey files. V2 requires explicit expected key pins and a development-only manifest.
Failed loads may retry; protocol/key bindings and validated manifest paths cannot be mutated afterward.
Artifact requests omit credentials.

The active v1 browser now passes the matching deployment's verification-key pins into the loader.
Both server and browser configuration reject a record for a different selected protocol before exposing a
usable pool or contacting RPC. An address override naming the same pool cannot bypass that rejection.
Legacy records without a protocol field retain v1 compatibility. Default builds continue to select v1.

The real-proof fixture reproduction uses a local file adapter for `/zk-v2-dev`. A v2 development server
also serves those separately verified files under that path, only for loopback requests and only when
`NODE_ENV=development` and protocol v2 are explicitly selected. No development keys are copied into the
site's public directory. Production servers do not register the route.

## Local application and server integration

Set both `PRIVACY_PROTOCOL` and `VITE_PRIVACY_PROTOCOL` to `hylsia-pp-v2-candidate` and select a local chain
(`31337` or `31338`) with a loopback RPC. The [local profile](../../config/v2-local.env.example) lists the values.
Use only an actual locally deployed v2 pool address. Any configured public-chain candidate pool remains blocked,
including mainnet, even if addresses, signer settings and development key pins look valid.

The vault's create/import/export/unlock/verify paths select the protocol-specific encrypted vault. Deposit
uses an independently generated nonce instead of a shared v1 index reservation; discovery and change proving
use the v2 derivation. Notes use the original deposit leaf index as a display ordinal in v2, never as a
derivation input. The server checks `PROTOCOL_VERSION()` for v2 and decodes its distinct deposit event before
building the publisher's association set. Common withdrawal and publisher calls retain the same ABI layout.

Device vault, activity and pool cache keys use a separate `hylsia.pp.protocol-v2.` namespace. The activity
encryption key is also protocol-separated. A v2 create/restore/forget does not adopt or delete the v1 vault.
V2 always scans complete public RPC history: v1 snapshots do not authenticate recovery nonces, so neither
the v2 browser nor the snapshot CLI may silently treat a v1 snapshot as a v2 recovery source.

`npm run zk:v2:e2e` starts and stops its own disposable loopback Anvil, deploys the v2 development pool and
verifiers, and exercises encrypted backup restore, deliberately duplicated deposits, the actual server
publisher and relayer, a real private-withdrawal proof, ragequit of the other duplicate, and restored change
balance. `DeployV2Dev.s.sol` requires Anvil and a local chain ID; it cannot target Robinhood mainnet/testnet.
Its temporary record stays under `contracts/deployments/local/` and is removed by the E2E run.

This is Node/local-chain acceptance with browser-compatible modules, not real browser, MetaMask/Rabby,
mobile or production-host validation. The v2 production release, mainnet transaction signing and actual
deployment receipts remain outstanding.

## Local verification on 21 November 2026

- Both separate development zkeys passed `zkey verify`; the development ptau passed its integrity check.
- Nine real v2 proofs from encrypted-backup-restored keys verified; all 46 public-input mutations were rejected.
- All 13 new v2 contract regressions passed. The full contract suite passed **53 tests**, including the
  existing v1 accounting invariant. The latest run used 64 runs and 2,048 calls; the earlier candidate
  check used 256 runs and 128,000 calls. That invariant is v1 coverage, not a new v2 accounting invariant
  or an independent review.
- The application suite passed **594 tests in 34 files**, including artifact-loader, encrypted-v2-vault,
  runtime/storage isolation, public mainnet-configuration and development-key exposure cases. Type checking
  and the v2/mainnet-preparation client build passed;
  existing dependency annotation and large-chunk build warnings remain.
- All **37 frozen v1 files** retained their recorded SHA-256 hashes.
- The local v2 Anvil deployment/publisher/relayer/recovery acceptance run passed. The temporary local deployment
  record was removed and its Anvil stopped; no public-chain transaction was sent.
- Offline mainnet preflight still reported `readyForBroadcast: false`, no recorded mainnet pool,
  and exit status 1 as intended. Mainnet CLI and app refusal tests passed. No transaction was sent.

## Remaining work before release

1. Review the v2 design, implementation and adversarial coverage independently. H-01 remains open for
   the active v1 deployment; the candidate's local tests are not a closure decision for a mainnet release.
2. Finalize production v2 release identity, receipt-based records, immutable artifact manifests and service
   configuration. Local app/server integration is implemented; no development artifact or local record may
   activate a public-chain pool. V2 snapshot support requires an independently reviewed binding for recovery
   nonce metadata; complete RPC history is the current supported recovery path.
3. Validate browser create/import/export/unlock/backup-verification and cross-profile recovery on actual
   browsers and wallets, including CSP, storage failures and mobile proving. The code paths and local Node
   acceptance are implemented; real-browser validation remains outstanding. Default UI backups remain v1.
4. Produce and independently review the mainnet proving ceremony and final pinned release artifacts.
   These dev verifiers and their keys must never be used with real funds.
5. Complete browser/wallet/mobile and production-host tests, operational role configuration, funding,
   exact deployment simulation, contract verification and receipt-based deployment registration.

The mainnet app/CLI release refusal remains active. There is no public deployment command for this candidate.
The separate [native ETH production target](native-eth-v2.md) now has a final-artifact packager and dedicated
deployer; it uses its own protocol/backup domain and requires actual final ceremony keys and independent
release review. No `4663.json` record exists, and balances/notes do not migrate between protocols or pools.
