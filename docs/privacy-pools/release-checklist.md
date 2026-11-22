# Phases 7–9 — release gates and runbook

Prepared 19 November 2026 (UTC+08:00). **Not executed on public hosting. H-01 blocks release**, as documented in
[findings](../security/findings.md). This document does not automatically authorize funding, signatures or publication.
The target remains native ETH on Robinhood Chain Testnet, without new features or policies.

## Phase 7 — source verification

Public-read evidence: [deployment-verification.json](../security/deployment-verification.json).
Deployed source: `5328dd0`; compare that source before using the working tree with these application changes.
Compiler **0.8.28+commit.7893614a**, optimizer **enabled / 200**, EVM **shanghai**, viaIR disabled,
metadata bytecodeHash **ipfs**. Complete settings and ABI-encoded constructor arguments are in the evidence JSON.
Public `eth_getCode` at review time matched the local pool runtime after library-link/immutable substitution;
verifiers were byte-for-byte identical; libraries differed only in the self-address in the first PUSH20, as expected for deployed libraries.
This establishes bytecode agreement with the RPC used, not explorer verification or multi-provider finality.

| Component | Actual address | Constructor / linkage |
| --- | --- | --- |
| PoseidonT3 | `0xff4044510b61a631ab192cd4f60d45731c0c12f3` | No explicit constructor arguments |
| PoseidonT4 | `0xa553216d49f01c26e2a8ed86860d4c789c194b33` | No explicit constructor arguments |
| WithdrawVerifier | `0x7594c1923973Ee026040e935DF93244A41de7977` | No arguments |
| CommitmentVerifier | `0xfB1BFc18294a884B040f3e4B633A08f1D577ffE2` | No arguments |
| PrivacyPool | `0xbBc4362133e4d50157206Cc907909d0C0211913f` | Owner `0x2629cCae35E1e6F5958ed618a75DE28d08763bC4`, publisher `0x4D62c8c148a847788C385b436ed760BDe5b1b80C`, both verifiers above, minDeposit `0`; linked to both libraries above |

**[PUBLICATION — not authorized]** The following commands submit source to the explorer. They were not run during the review.
Run from the repository root after release gates and exact source/build checks are approved. `forge verify-contract --help`
was checked for command options. The Blockscout endpoint and target Sourcify/API behavior still require validation at execution time.
Source verification requires neither the owner private key nor a wallet signature.

```sh
forge verify-contract --root contracts --chain 46630 --compiler-version v0.8.28+commit.7893614a --num-of-optimizations 200 --evm-version shanghai --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/ 0xff4044510b61a631ab192cd4f60d45731c0c12f3 ../node_modules/poseidon-solidity/PoseidonT3.sol:PoseidonT3
forge verify-contract --root contracts --chain 46630 --compiler-version v0.8.28+commit.7893614a --num-of-optimizations 200 --evm-version shanghai --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/ 0xa553216d49f01c26e2a8ed86860d4c789c194b33 ../node_modules/poseidon-solidity/PoseidonT4.sol:PoseidonT4
forge verify-contract --root contracts --chain 46630 --compiler-version v0.8.28+commit.7893614a --num-of-optimizations 200 --evm-version shanghai --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/ 0x7594c1923973Ee026040e935DF93244A41de7977 src/verifiers/WithdrawVerifier.sol:WithdrawVerifier
forge verify-contract --root contracts --chain 46630 --compiler-version v0.8.28+commit.7893614a --num-of-optimizations 200 --evm-version shanghai --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/ 0xfB1BFc18294a884B040f3e4B633A08f1D577ffE2 src/verifiers/CommitmentVerifier.sol:CommitmentVerifier
```

The pool command uses constructor bytes from the evidence JSON rather than guessing current administrative state:

```sh
# [PUBLICATION — not executed]
HYLSIA_CONSTRUCTOR_ARGS=$(node -p "JSON.parse(require('fs').readFileSync('docs/security/deployment-verification.json','utf8')).constructorArgs")
forge verify-contract --root contracts --chain 46630 --compiler-version v0.8.28+commit.7893614a --num-of-optimizations 200 --evm-version shanghai --verifier blockscout --verifier-url https://explorer.testnet.chain.robinhood.com/api/ --libraries ../node_modules/poseidon-solidity/PoseidonT3.sol:PoseidonT3:0xff4044510b61a631ab192cd4f60d45731c0c12f3 --libraries ../node_modules/poseidon-solidity/PoseidonT4.sol:PoseidonT4:0xa553216d49f01c26e2a8ed86860d4c789c194b33 --constructor-args "$HYLSIA_CONSTRUCTOR_ARGS" 0xbBc4362133e4d50157206Cc907909d0C0211913f src/PrivacyPool.sol:PrivacyPool
```

- [ ] Retain standard-json compiler input, source commit, hashes of every input, request IDs/status and explorer URLs for all five contracts.
- [ ] Confirm the explorer uses those library addresses and constructor bytes; recheck pool SCOPE, owner/postman and
  verifier references through read-only RPC at verification time.
- [ ] Run the frozen-artifact check before and after; **do not** run `zk:build` to resolve a mismatch.

## Phase 8 — long-running Docker host

`Dockerfile` now separates runtime dist/node_modules, runs as user `node` and defines a health check. `compose.yaml`
configures one replica, a read-only filesystem, mounted exclusions and two service-key secrets. **The local Docker daemon is stopped**;
image build/start and Compose on the target host are untested. The Node build and local production HTTP were tested separately.

**[HOST ACCESS — preparation]** Prepare existing absolute paths; never put key values in shell history:

```sh
export HYLSIA_RELAYER_KEY_FILE=/host/secret-store/relayer-key
export HYLSIA_PUBLISHER_KEY_FILE=/host/secret-store/publisher-key
export HYLSIA_EXCLUSIONS_FILE=/host/config/asp-exclusions.json
# Once the host is ready: validate configuration without starting or publishing
docker compose config --quiet
# [HOST DEPLOYMENT — not authorized/executed]
# docker compose up --build -d
```

- [ ] Exactly one publisher is active per `(chainId,pool)`, including old hosts/CLI/schedulers. Do not scale the service.
  One relayer signer per process; use different publisher and relayer keys. The in-memory queue is not a distributed lock.
- [ ] Secret-store/keystore files are readable only by the runtime UID; mount read-only. Validate the exclusion file and mount
  its directory, or use controlled in-place edits so atomic host-file replacement cannot leave the bind mount on the old inode.
  Starting the service can **publish an ASP root** if funded/root due: treat startup as a public action.
- [ ] No owner/deployer key in the runtime. `DEPLOY_PRIVATE_KEY_TESTNET` was still detected as populated in the user's file;
  do not delete its only copy. The operator must prepare a hardware wallet or `cast wallet import hylsia-owner --interactive`
  on the approved machine/keystore, then privately verify its address and signing capability before removing the old copy.
  Never put the owner key in Docker, runtime environment, command arguments, screenshots, logs or reports.
- [ ] Publisher restart: compare mined root/record with the onchain recipe; if `pending nonce > latest nonce`, wait/reconcile
  before starting a second process. Local E2E covers publisher pending-nonce recovery. A real host restart with a pending transaction
  and a retained receipt without secrets remains untested.
- [ ] Relayer timeout: an unanswered response **does not prove the transaction was not sent**. The queue suspends the signer
  after an ambiguous send. Check receipt/nullifier/events and the signer's pending/latest nonce; record any discovered hash.
  Do not blindly restart or resubmit to free the queue. If RPC cannot establish the outcome, retain the suspension.
  The idempotency map is lost on restart and holds 1,000 entries; reconcile before resetting. No fee bump,
  replacement or automatic failover is enabled.
- [ ] `/health/live` checks the process; `/health/ready` returns 503 if RPC/pool fails, the publisher/schedule cannot serve a due root,
  or the root remains due for more than two observation intervals. An old idle root is not considered broken. Health checks
  send no transactions. External monitoring retains history across restarts and tracks restart count and publisher-error logs.
- [ ] HTTPS reverse proxy, request/body rate limits and TLS termination. Do not log request bodies, proof/recipient pairs,
  vault operations, authorization data or RPC credentials; minimize/disable visitor access logs.
- [ ] Check `Content-Security-Policy`, `Referrer-Policy: no-referrer`, nosniff and framing denial on the **public origin**, including
  HTML fallback and `/api/trpc`. Enable proxy HSTS after HTTPS is verified. CSP supports WASM/worker blobs and manually chosen
  HTTPS RPC/relayer endpoints; production browser proving and wallet injection must be validated on the target origin.
- [ ] Permanent warning visible: **“Testnet only. Not audited. Development trusted setup. Do not use real funds.”**
- [ ] No new analytics/telemetry. Existing Google Fonts requests expose IP/metadata; do not claim there are no third-party requests.

**[HOST/BROWSER INSPECTION]** In a fresh profile without user data, record URL, commit/build and network-request origins
on load, quote, artifact download, sync and proof/submit. Expected origins: static/API site, configured RPC, manually selected
relayer and disclosed font providers. No seed/password/note secret/witness/local activity may appear in requests/logs.
Relayer submission does send proof and public signals/recipient. Check RPC choice and one relayer throughout each operation;
inspect referrer/cookies on remote-relayer requests, CSP console violations, WASM, workers and the wallet modal. Retain only
redacted metadata logs; do not archive backups/decrypted seeds in HAR files. This has not been done on public hosting.

## Phase 9 — live-validation evidence

Every checkbox below remains **unexecuted**. Record public URL, commit/build hash, date/time (UTC+08:00), chain ID and pool,
actual device/browser, wallet/provider/version, RPC and relayer origin. Signatures and transactions require closed release
blockers or approval for a limited operator test with explicit risks. Testnet ETH only.

### Path A — full private withdrawal

- [ ] **[WALLET SIGNATURE / PUBLIC TX]** Create/verify a test-vault backup; make Deposit A; retain receipt/value/leaf/label and balance.
- [ ] **[PUBLIC READ]** Verify block time +3600 s reaches eligibility, then retain the `ASPRootUpdated` receipt and reconstructed
  inclusion of label A. Eligibility is not root inclusion; record publisher timing and funding/health.
- [ ] **[PUBLIC TX VIA RELAYER]** Fully withdraw A through the relayer to a fresh address. Record the approved fee, deadline,
  receipt, recipient net increase `amount-fee`, relayer fee and spent nullifier; remaining note value is zero.
- [ ] Do not schedule ragequit for spent note A. Confirm the app rejects reuse before broadcast.

### Path B — partial withdrawal, restore, public change exit

- [ ] **[WALLET SIGNATURE / PUBLIC TX]** Make a separate Deposit B; retain its receipt and subsequent verified-root inclusion.
- [ ] **[PUBLIC TX VIA RELAYER]** Partially withdraw B to a fresh address; check net payout + fee + remaining = input value.
  The old note is spent, the change commitment/value is correct, and label/original depositor remain B's.
- [ ] **[ANOTHER BROWSER PROFILE]** After all wallet requests settle, restore the backup on another profile/device;
  full sync discovers the change note and remaining balance. Local activity history is not assumed to recover.
  Do not deposit concurrently from two profiles using the same backup (H-01).
- [ ] **[WALLET SIGNATURE / PUBLIC TX]** Connect the original depositor wallet in the new profile, provide gas, create a commitment
  proof and ragequit the **unspent change note**. Record receipt and depositor balance delta after gas, spent nullifier and
  zero vault balance. Explain that revealing the label links change to Deposit B and may link the earlier private withdrawal.
  A wrong-wallet attempt must stop before sending.

### Failures, wallets and devices

- [ ] **[HOST ACCESS]** Publisher off/unfunded/RPC failure: eligible deposits wait for inclusion; health explains why without
  creating automatic roots/evictions. Resume one publisher after nonce reconciliation; retain the receipt.
- [ ] **[HOST ACCESS]** Relayer down/timeout/pending: no automatic fallback; select a relayer manually and retain a consistent fee cap;
  inspect ambiguous outcomes onchain before retry/restart. Simulate quote expiry during proving; reject without raising the fee.
- [ ] **[PUBLIC READ + WALLET]** RPC lag/reorg/historical-state unavailable: reject snapshots with a different checkpoint;
  full-history fallback must not claim completion before the scan finishes. User-selected RPC endpoints are not sent to other services.
- [ ] **[WALLET SIGNATURE]** Actual MetaMask and Rabby deposit, self-paid withdrawal and ragequit flows; rejection, pending,
  wrong chain, switch/add chain and reconnect. Unit-test simulated providers do not establish live-wallet support.
- [ ] **[TARGET MOBILE DEVICE]** Record actual device/browser/wallet; measure cold/warm artifact download, cold/warm history sync,
  proof time, memory/OS termination, responsiveness and restore. Unmeasured so far. Desktop Node results are not mobile/browser results.
- [ ] **[HOST ACCESS / POLICY DECISION]** Review exclusion criteria/reason codes, dispute contact and old-root exposure.
  This checklist does not enable eviction bursts, heartbeat or automatic failover. Public eviction requires a separate
  operator decision, funding and a service-wallet signature.

Retain receipts, root/inclusion evidence, balance calculations, build hash and failure-test results in the release record.
Do not store seeds, private keys, passwords, witnesses or user backups. Checkboxes without evidence remain open.
