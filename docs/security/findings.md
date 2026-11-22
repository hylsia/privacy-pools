# Phase 6 — local security review

Date: **19 November 2026 (UTC+08:00)**. Clean repository baseline: `99d97d3c27fe44ce3a47f65947a86ba2ab77ebb3`.
Scope: native ETH, testnet; deployed source comes from `5328dd0`. This is an implementation review and local testing,
not an independent audit. **H-01 still blocks release. Phases 7–9 are incomplete.**

## Release gates and findings

| ID | Severity / type | Evidence and impact | Status |
| --- | --- | --- | --- |
| H-01 | **High — demonstrated loss of access to funds** | `test_duplicatePrecommitmentCanStrandSecondDeposit`: a second deposit accepts the same precommitment; both ownership proofs are valid; withdrawing the first note consumes the nullifier also needed by the second note. The second ragequit then reverts with `NullifierAlreadySpent`. Neither normal exit path can release the second note's funds. No theft or forgery was demonstrated. | **Residual release blocker.** Web Locks, persistent reservations and a watermark fix concurrency within the same origin/profile. Browsers without coordination/storage refuse deposits. Different profiles, origins, devices and old-build tabs remain uncoordinated: the single-active-profile warning is a mitigation, not a resolution. |
| M-01 | Medium — local data | The activity writer previously wrote each tab's entire snapshot; the last writer discarded other tabs' entries. This did not demonstrate loss of funds. | Fixed: an origin-wide Web Lock covers decrypt/merge/encrypt/write and migration; merging by ID retains the newest update. Another vault's envelope is never overwritten. |
| M-02 | Medium — relayer operations | Parallel submissions previously lacked a signer queue or idempotency; the same valid proof could be simulated before the first transaction was mined and then sent again. Response timeouts were also ambiguous. | Fixed within **one process**: serialization, nullifier + calldata deduplication, retained result hashes, conflict rejection, and signer suspension for reconciliation after a broadcast failure. Queue tests use a mock transport; contract/E2E suites still test proof validity. Multiple instances and restarts with ambiguous relayer transactions remain untested; do not run multiple signer processes. |
| M-03 | Medium — tree design limit | Withdrawals always call `_insert`, including full spends with zero-valued change. Tree depth is 20: at most 1,048,576 deposit + withdrawal leaves. Capacity-injection tests demonstrate that deposits and private withdrawals revert, with nullifier/state rollback; ragequit remains available. | Contract unchanged. The terminal-capacity flow is demonstrated; one million actual inserts and an operational capacity assessment have not been performed. A future pool could omit zero-valued full-spend leaves; this requires new circuits/contracts. |
| M-04 | Medium — screening design limit | The contract accepts 16 ASP roots. Removing a deposit from the newest root does not revoke older roots. An old proof can still be submitted directly until every relevant root copy leaves the ring. | Known; tested in contracts and E2E. The app blocks announced exclusions and uses the newest root; the relayer rejects older offending roots. Bursts remain manual; heartbeat/automatic bursts are disabled. See the [runbook](../privacy-pools/asp-window.md). |
| L-01 | Low — wording/recovery | Deposit copy promised roughly one hour without the root wait; backup wording was unclear about activity history; privacy counts could be mistaken for independent people. | Fixed: eligibility followed by inclusion; estimates assume a healthy publisher; Strong is a model; counts refer to deposits; backups reconstruct onchain notes/balance, not the complete local log; ragequit/change disclosure and metadata inference are explained. |
| O-01 | Operational — secret custody | A variable-name inventory found `DEPLOY_PRIVATE_KEY_TESTNET` populated in `.env`; its value and correspondence to the owner were **not inspected or printed**. The runtime reads only service keys. No key leak was demonstrated. | Not moved/deleted. The host must keep the owner wallet/keystore outside the runtime; steps are in the [release checklist](../privacy-pools/release-checklist.md). |

H-01 cannot be closed merely by increasing the discovery gap, adding a warning, or rejecting duplicate precommitments
that have already been mined: two profiles can still submit concurrently. Options for review include exclusive
cross-device allocation with reconstructible operation identities, or a unique note derivation scheme recoverable
from the seed without reuse or unbounded gaps. Consider duplicate-precommitment rejection on a **new pool** as an
additional layer, with an explicit front-running threat model. This review changes no active protocol or deployment.
Before limited operator testing, close all old-build tabs and use one writer profile per backup.

## Scope and method

- Reviewed contracts, circuit source, verifiers, vault/HKDF/AES-GCM, activity/reservations, recovery/indexer, screening,
  publisher/eviction, snapshots, relayer, wallet routing and Docker/runtime. No `.env` values were read or printed.
- Accounting: `withdrawnValue` **already includes the fee**. Input = (amount − fee) to recipient + relayer fee + change.
  Liabilities are modeled separately from surplus ETH received outside deposits; the invariant uses `balance >= liabilities`.
- Real frozen Groth16 proofs: partial spend followed by a full change spend; withdrawal/ragequit in both and competing orders;
  change retains the original depositor's label; eviction blocks private change spending; public exit after windDown without ASP/relayer.
- Reverting or reentrant recipients/relayers: payout, nullifier, commitment and tree roll back; retrying the same proof
  succeeds after the recipient is fixed. Incorrect ragequit callers are rejected. Existing chain-domain tests plus another same-chain pool domain.
- Mutated all 6 public signals; changing recipient/relayer/fee/deadline **and recomputing context** is still rejected by the real verifier.
  Malformed proofs and field inputs are rejected. The `2^128−1` boundary succeeds; `2^128`, underflow/field wrap, negatives,
  wrong paths, index `2^20` and wrong secrets fail witness generation with the frozen WASM. Witness failure is not counted as state coverage.
- State roots survive 99 subsequent inserts and expire at the 100th. The last ASP root containing a removed deposit survives
  removal +14 posts and expires after +15. E2E tests cover proofs in flight, new roots, manual eviction, pending publisher transactions and nonce conflicts.
- Invariant: real verifier/proof, **256 runs, 128,000 calls** (42,931 donate, 42,654 exit, 42,415 spend in the recorded run).
  The mandatory bootstrap partial spend succeeds in every run; the handler records successes/rejections/skips. The last sample log:
  3 successes (including bootstrap), 203 rejected, 129 skipped. These sample figures are not totals across all runs.
  Invariant scope is limited to fixture-note sequences, not every possible value/proof; separate fuzz tests run 256 cases per function.
- Recovery: E2E decrypts a backup and discovers change from public events; unit tests cover two reservation instances, stale writers,
  Lock/Forget/vault-replacement guards, envelope tampering, unanswered wallet requests and the allocation watermark.
  Allocation may no longer exceed the default discovery gap of 10; after nine empty indices, index 9 is still recovered.
  Ten requests not yet visible onchain hold subsequent deposits until sync/settlement, preserving seed-only recovery.
- Snapshots: baseline tests check chain ID, checkpoint block hash, root, leaf count, SCOPE, unavailable historical state,
  reorgs and full-scan fallback. A snapshot is not assumed to contain complete activity history.
- The selected relayer is captured per operation; the user's fee cap is still checked before proving. Quotes that expire during
  proving are rejected before submission without changing fee/deadline or automatically selecting another relayer.

## Commands and results actually executed

| Command | Result |
| --- | --- |
| `npm test` baseline | 503 tests / 22 files passed; fresh results, not copied historical figures. |
| `forge test --root contracts -vv` baseline | 24 tests passed. |
| `forge test --root contracts -vv` after the initial security suite | 38 tests passed; invariant above, 102.22 s. |
| `forge test --root contracts --match-contract SecurityReviewTest -vv` after reproducing H-01 | 15 tests passed in the final targeted suite, including duplicate and last-slot/full-withdrawal reproductions. The full 40-case regression followed with 64×32 invariants; see final results. |
| `node --import tsx scripts/privacy/security-circuits.ts` | 3 additional valid proofs/benchmarks; 11 invalid witnesses and 6 public-signal mutations rejected; writes only `contracts/test/fixtures/security.json`. No rebuild/setup. |
| `npm run zk:e2e` | Two loopback Anvil nodes with local keys; baseline 76 s, regression after the relayer queue 78 s; both pool balances ended at zero. The script was inspected before execution: literal `127.0.0.1`, port availability, local child environment and public-record hashes. |
| `npm run check` | TypeScript passed; see final regression status below. |
| `npm run build` | Production build passed; the >500 kB chunk warning remains. |
| `FOUNDRY_OUT=/tmp/hylsia-slither-out FOUNDRY_CACHE_PATH=/tmp/hylsia-slither-cache forge build --root contracts --skip test --skip script --build-info` | Temporary analysis compilation; source/keys unchanged. |
| `VIRTUAL_ENV=/tmp/hylsia-slither /tmp/hylsia-slither/bin/slither contracts --foundry-ignore-compile --foundry-out-directory /tmp/hylsia-slither-out --json /tmp/hylsia-slither-complete.json` | 8 contracts, 100 detectors, 134 findings; nonzero exit because findings were reported. Triage below. |
| `/tmp/hylsia-tools/bin/circomspect circuits/withdraw.circom circuits/commitment.circom -L node_modules --verbose --level INFO --sarif-file /tmp/hylsia-circomspect.sarif` | 7 findings; exit 1 because of warnings. Triage below. |
| `node node_modules/snarkjs/cli.js powersoftau verify circuits/ptau/powersOfTau28_hez_final_16.ptau` | Powers of Tau Ok; contribution #1 **hylsia-local**. The Hermez filename does not establish public-ceremony provenance. |
| `node node_modules/snarkjs/cli.js zkey verify …` for both active R1CS/ptau/zkey sets | Results recorded in the final status below. Read-only verification. |
| `node --import tsx scripts/privacy/check-frozen-artifacts.ts` | **37/37 SHA-256 digests unchanged**; inventory in [frozen-artifacts.json](frozen-artifacts.json), including source, keys, verifiers, manifests, records and application references. |
| `curl` JSON-RPC `eth_chainId`/`eth_getCode` | Public reads only. Pool runtime matches after library-link/immutable substitution; both verifiers match byte for byte; both libraries match after the standard deployed-library self-address patch. [Evidence](deployment-verification.json). No source publication. |
| Local production server, empty keys, publisher off | HTTP 200 + CSP/security headers; `/health/ready` returns 503 for a local build without a pool, as designed. No public writes. |
| `docker version --format '{{.Server.Version}}'` | Daemon not running; image build/run could not be validated. |

Toolchain: Node 24.12.0, project npm lockfile, Vitest 2.1.9, forge/anvil 1.7.1
(`4072e48705af9d93e3c0f6e29e93b5e9a40caed8`), solc 0.8.28+commit.7893614a,
snarkjs 0.7.6, Slither 0.11.4 / crytic-compile 0.3.11, circomspect 0.9.0.
Slither/circomspect were initially unavailable and installed temporarily through a pip venv/Cargo. Initial sandbox DNS/listen
attempts failed; reruns with environment permission succeeded. Forge's default minimal Slither build-info was incompatible
(`KeyError: output`); complete temporary build-info resolved it. Forge's read-only signature-cache warning did not affect test results.

## Static-analysis triage

[Machine-readable summary](static-analysis-summary.json). Installation followed
[Slither upstream](https://github.com/crytic/slither) and [circomspect upstream](https://github.com/trailofbits/circomspect).
Even clean results would not constitute an audit; these results also required triage.

| Detector | Count | Assessment |
| --- | --- | --- |
| Slither arbitrary-send-eth (High) | 1 | `_send` intentionally pays the recipient/relayer; withdrawal context/proof, nullifier and the ragequit depositor gate authorize the destination/value. No arbitrary payout without a proof was found; real-proof adversarial tests support this false-positive assessment. |
| Slither incorrect-return (High) | 8 | Generated-verifier Yul `return(0,32)` returns false from the verifier frame; the Poseidon external-library return exits the delegatecall library frame. Neither exits the pool early. Deposit storage/tree, false-proof and withdrawal-effect tests exercise these paths. Generated code is unchanged. |
| missing-zero-check | 2 | A zero postman disables publishing without closing ragequit; the constructor permits it. This does not drain funds; the owner must check addresses before updates. |
| timestamp | 1 | Deadlines use chain timestamps; small manipulation can affect expiry, not the proof-bound payout/fee. No device-clock expiry oracle guarantees finality. |
| assembly / naming / solc-version / pragma / missing-inheritance / low-level-calls | 122 | 12 assembly, 104 naming, 2 solc-version, 1 pragma, 2 missing-inheritance, 1 low-level-call. Verifier/Poseidon assembly and structural interfaces were inspected; the compiler is pinned to 0.8.28. Frozen source was not replaced merely to satisfy lint. |
| circomspect CS0004 | 4 | The 128-bit existing/withdrawn/remaining subtraction ranges prevent wrap; the other three findings concern static loop increments/depth. Boundary witness tests reject underflow and out-of-range input. |
| circomspect CS0003 | 2 | Loop comparisons use compile-time depth 20, not private field inputs exceeding p/2. |
| circomspect CS0017 | 1 | `contextSquare` is used only once. **Sensitivity to preserve**: the active compiler/default O1 and current keys bind context, as mutation tests show. Do not change the optimizer or remove the signal as cleanup; a new build/ceremony must review the context constraint again. This does not formally prove every optimization safe. |

## Performance and limitations

- Desktop **Node, darwin/arm64**, synthetic max128 note: withdrawal proofs take about 1.2–1.4 s;
  peak process RSS was about 812 MiB before the additional duplicate proof. This includes workers/inputs/artifacts during the suite,
  **not** browser-heap or mobile-device measurements. The latest benchmark is recorded in the final status.
- Downloading `withdraw.wasm` through production-build loopback HTTP: 2,549,474 bytes / 0.007780 s;
  this is local throughput, not public-network performance. Zkey download results appear in the final status where available.
- Active history is exercised in E2E (screening/removals/partial spends/recovery), but separate cold/warm sync timing,
  browser proving under the actual CSP, real two-tab browser behavior, supported-wallet signatures and mobile have not been measured.
- Gas from Anvil E2E: partial relayed withdrawal **1,131,196 gas** (recipient 0.396 ETH, fee 0.004 ETH from amount 0.4 ETH);
  deposit 989,536; ragequit about 277.7k. Small differences in proof calldata affect gas. These are transaction-receipt gas figures,
  not total test gas. They exclude Robinhood Chain Testnet parent-chain data fees. Reproduce with `npm run zk:e2e`.
- Not performed: fuzzing of every possible witness, formal R1CS verification, live reorgs, one million actual inserts,
  relayer multi-process/restart tests during ambiguous send responses, mobile testing, public hosting, funding, signatures or explorer submission.
- HTTP readiness detects unavailable RPC/pools, publishers unable to publish a due root, disabled schedules and roots due for
  more than two intervals **since the monitor observed them**. Old idle roots are not treated as broken. Restart resets the observation
  timer; an external monitor must retain history. Liveness is separate from readiness.
- The new CSP supports WASM/worker blobs/fonts and user-selected HTTPS RPC/relayer endpoints, but the endpoint choice requires a
  broad `https:` allowance. CSP does not prove absence of leaks; inspect browser requests on the target host. No telemetry/analytics was added.

## Final regression status

- `npm run check`: passed. `npm test`: **516 tests, 24 files passed** (13.77 s in the consolidated run).
- `FOUNDRY_INVARIANT_RUNS=64 FOUNDRY_INVARIANT_DEPTH=32 forge test --root contracts -vv`: **40 tests passed**, 2.17 s;
  final invariant runs 64 ×32 calls, in addition to the earlier 256×500 stress test. Contract/invariant suites use no mock verifier.
- `npm run build`: passed, 7.63 s before narrowing the whitespace diff; delivery build **passed in 7.45 s**; final targeted persistence/multichain run **94 tests passed** (1.73 s).
- `npm run zk:e2e` after the queue: passed in **78 s**, local loopback only. A later targeted test added RPC-unavailable status:
  RPC errors now report unavailable, rather than claiming pending without a receipt.
- Both `zkey verify` runs reported **ZKey Ok!**; phase 1 reported `Powers of Tau Ok!`, contributor `hylsia-local`;
  phase-2 contribution is local to the development build. No public ceremony or audit is claimed.
- Final synthetic max128 proof benchmark: **1,581 ms**, peak process RSS **756 MiB**, darwin/arm64 Node;
  3 valid proofs, 11 invalid witnesses and 6 public-input mutations. Browser/mobile sync/proof/memory remain unmeasured.
- Loopback downloads: WASM **2,549,474 bytes / 0.007780 s**, zkey **10,775,683 bytes / 0.012639 s**;
  these are not public-network or mobile figures.
- **37/37 frozen SHA-256 digests unchanged**, including ignored local R1CS/ptau/build keys already present at review time.
  The complete baseline inventories this workspace; a clone missing ignored files must obtain matching frozen artifacts,
  not run a new setup. No files under `contracts/src`, `circuits` or `client/public/zk`, active deployment records,
  or `shared/privacy/deployments.ts` were changed.
- Two source-regex tests briefly failed because of formatter line wrapping; restoring original whitespace made all
  516 tests pass again. Assertions were neither weakened nor removed. The final diff was narrowed to relevant changes.
- Docker daemon unavailable; public deployment was not attempted as a substitute for container testing.

**Verified locally:** encryption/tab coordination within the test model, 516 unit tests, 40 contract tests, real-proof circuit
checks, invariants, two-Anvil E2E, build/typecheck, static-analysis triage, key/ptau integrity and frozen hashes.

**Prepared but not executed:** explorer commands for the five deployed components, Docker/Compose host deployment,
public-browser request/log monitoring, CSP/WASM browser proving, public/mobile performance and the two-path A/B checklist.

**Requires access/signatures/decisions:** host/secret store, handling user secrets, funding two service wallets,
real-wallet signatures/public transactions, and exclusion/eviction policy decisions. Preparing a command alone does not authorize it.

**Release blocker:** cross-profile/device H-01 nullifier reuse remains unresolved; single-origin fixes do not close it.
The demonstrated loss of duplicate-note access is sufficient to withhold a completed-public-release label. After the design
is fixed and tested, container/browser/wallet/mobile validation and live receipts are still required. This limited review
did not demonstrate a forgery, theft or value-rounding vulnerability.

## Changed or added files

- `.dockerignore`
- `.env.example`
- `Dockerfile`
- `client/src/components/landing/system.tsx`
- `client/src/components/privacy/DepositPanel.tsx`
- `client/src/components/privacy/PrivacyCheck.tsx`
- `client/src/components/privacy/PrivacyNotice.tsx`
- `client/src/components/privacy/VaultPanel.tsx`
- `client/src/pages/ScreeningPolicy.tsx`
- `client/src/pages/Vault.tsx`
- `client/src/privacy/PrivacyProvider.tsx`
- `client/src/privacy/activityStore.ts`
- `client/src/privacy/artifacts.ts`
- `client/src/privacy/deviceLock.ts`
- `compose.yaml`
- `contracts/test/PrivacyPool.t.sol`
- `contracts/test/SecurityReview.t.sol`
- `contracts/test/fixtures/security.json`
- `docs/privacy-pools/README.md`
- `docs/privacy-pools/asp-window.md`
- `docs/privacy-pools/release-checklist.md`
- `docs/security/deployment-verification.json`
- `docs/security/findings.md`
- `docs/security/frozen-artifacts.json`
- `docs/security/static-analysis-summary.json`
- `readme.txt`
- `scripts/privacy/check-frozen-artifacts.ts`
- `scripts/privacy/security-circuits.ts`
- `server/_core/index.ts`
- `server/_core/loadEnv.ts`
- `server/_core/runtimeSecrets.ts`
- `server/_core/securityHeaders.ts`
- `server/privacy/activityStore.test.ts`
- `server/privacy/health.ts`
- `server/privacy/hosting.test.ts`
- `server/privacy/multichain.test.ts`
- `server/privacy/relayer.ts`
- `server/privacy/submissionQueue.test.ts`
- `server/privacy/submissionQueue.ts`
- `shared/privacy/indexer.ts`
