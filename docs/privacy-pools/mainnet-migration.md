# Robinhood Chain mainnet migration

Ethereum mainnet (1) is also supported as a separate preparation target. The [two-network guide](dual-mainnet.md)
describes per-chain packages and the `DEPLOY_PRIVATE_KEY_MAINNET` signer selected with `PRIVACY_DEPLOY_SIGNER=env`.

Target: **Robinhood Chain, chain ID 4663**, native ETH. This is migration preparation, not a mainnet launch.
The existing testnet deployment on chain 46630 remains the default and is not modified.

## Implemented

- Mainnet chain/registry entry, public RPC, wallet add/switch configuration and explorer.
- Explicit network selection with `PRIVACY_CHAIN_IDS=4663` and `VITE_PRIVACY_CHAIN_IDS=4663`.
- A mainnet preparation profile in `config/robinhood-mainnet.env.example`; publisher auto-start disabled.
- Read-only readiness report: `npm run zk:mainnet:preflight` (`-- --offline` skips RPC reads).
- Deployment simulation entry: `npm run zk:deploy:robinhood-mainnet -- --sender <deployer-address>`.
  A simulation needs a public sender address; it does not need a key or transmit transactions.
- Shared app/server refusal to expose a transactable mainnet pool while the current protocol is release-blocked.
  Valid-looking address overrides or copied deployment records do not enable it.
- CLI rejection of mainnet `--broadcast` before RPC selection, signer access or invocation of Forge.
- Isolated [phase-2 ceremony preparation](mainnet-ceremony.md) using a digest-pinned public phase-1
  transcript, snapshotted circuit sources, initial keys and contribution challenges. These initial
  keys are unsafe and do not enable deployment.
- [Native ETH v2 implementation](native-eth-v2.md): a distinct protocol identity, native ETH contract,
  protocol-bound vault/recovery runtime, content-bound final-artifact packager, and dedicated deployment CLI.
  Its reviewed-release registry is empty; final production artifacts are not yet available.

Network facts were checked on 21 November 2026 against
[Robinhood's wallet configuration](https://docs.robinhood.com/chain/add-network-to-wallet/)
and [connection documentation](https://docs.robinhood.com/chain/connecting/):

| Setting | Value |
| --- | --- |
| Chain ID | `4663` |
| Native currency / gas | ETH, 18 decimals |
| Public fallback RPC | `https://rpc.mainnet.chain.robinhood.com` |
| Explorer | `https://robinhoodchain.blockscout.com` |
| Faucet | None |
| Mainnet pool | Not deployed |

The public endpoint is rate-limited and the official documentation recommends a production provider.
Historical indexing requires suitable archive access. Never put a secret-bearing endpoint in a `VITE_` variable.

## Protocol work required before broadcast

An isolated [v2 protocol candidate](protocol-v2-candidate.md) now addresses note reuse with label-bound
spend nullifiers and public random recovery nonces. It includes separate circuits, a candidate pool,
development-only verifiers and real-proof regression fixtures. Local app/server integration is available,
but it is not approved for public release; the active v1 H-01 finding, production ceremony and validation
blockers remain open.
Protocol-bound encrypted backup/restore, artifact validation and v1/v2 runtime isolation have since been
implemented and tested locally, including real proofs produced from a restored encrypted backup. The
browser's v2 vault flow, event decoding and publisher/relayer are now wired for local development. V2 reads
complete RPC history rather than trusting v1 snapshots. Real-browser/production-host validation and the
final mainnet release bundle remain outstanding; mainnet remains blocked.

## Filling the deployment environment

Merge `config/robinhood-mainnet.env.example` into your own `.env`; do not overwrite an existing secret file.
Provide the public deployer, owner and publisher addresses and choose one signer:
`PRIVACY_DEPLOY_ACCOUNT` for a keystore alias, `PRIVACY_DEPLOY_HARDWARE=ledger`, or
`PRIVACY_DEPLOY_SIGNER=env` with `DEPLOY_PRIVATE_KEY_MAINNET` in the private deployment environment.
Owner, publisher and deployer may share a wallet when explicitly selected. A relayer service and
`PRIVACY_DEPLOY_GAS_BUDGET_ETH` are optional for contract deployment. A configured relayer uses a
separate account. Broadcast always checks the simulated cost against the actual deployer balance,
and enforces the extra gas cap when configured. Unreviewed releases are refused before signer or RPC access.

`npm run zk:mainnet:preflight -- --offline` reports missing or invalid public values without opening a
signer or reading private-key values. The online form additionally probes RPC. Configuration completion
does not approve the v2 protocol or its development proving keys. Mainnet service-key secret-file variables
use the chain suffix before `_FILE`, for example `PRIVACY_RELAYER_PRIVATE_KEY_4663_FILE`.

1. Resolve **H-01** for the new mainnet protocol and prove backup recovery across independent profiles/devices.
   `forge test --root contracts --match-test test_duplicatePrecommitmentCanStrandSecondDeposit -vv`
   currently passes by reproducing stranded funds. A passing reproduction is evidence of the bug, not its resolution.
   A client-side warning or a larger recovery search gap does not solve it. A duplicate-precommitment rejection on a
   new pool needs front-running analysis and cannot replace a recoverable cross-device allocation design.
2. Produce and review a mainnet proving setup. [Ceremony preparation](mainnet-ceremony.md) now produces an isolated
   zero-contribution challenge workspace from the public phase-1 transcript. Independent contributions,
   finalization and review are still outstanding. The active proving files use a local development contribution. Do not rerun
   `zk:build` over the existing deployment; keep protocol versions, circuits, verifiers, proving files and manifests
   separate. A new setup needs independently verifiable provenance and a matching deployed verifier.
3. Complete security review and contract/source verification for the exact mainnet release, plus real browser,
   MetaMask/Rabby, mobile, recovery, relayer/publisher restart and production-host validation.
4. Configure the selected owner/publisher custody and deployment signer. A shared wallet holds both
   administrative and ASP publishing authority. Keep deployment secrets out of the hosted app environment;
   choose separate custody if a publisher service must run without owner authority. Check the simulated
   deployment cost and actual wallet balance before signing; an additional gas cap is optional.
5. After the release blockers have actual closure evidence, update `shared/privacy/mainnetRelease.ts` with the approved
   protocol release and its tests. There is intentionally no environment flag that bypasses the current findings.
6. Simulate the exact deployment using the target sender and RPC, then review the resulting contract artifacts,
   constructor parameters and estimated cost before signing the deployment transactions.

## Activation after a verified deployment

- A new `contracts/deployments/4663.json` must come from actual successful deployment receipts; never fabricate one
  or copy the testnet record. Onchain sync checks chain ID, bytecode, verifiers, scope and artifact pins.
- Use the deployment's real receipt block; a public chain must not be scanned from block zero.
- Rebuild both server and client with the same chain selection. Change landing copy, metadata and the default only
  after mainnet deployment and operational validation; the public site currently describes the testnet implementation.
- Fund and validate the mainnet publisher/relayer, reconcile nonces and ensure one active operator per role.
- Only then activate the mainnet pool and advertise it as live.

For native ETH v2, use `zk:v2:deploy:native-eth` and the matching `--v2-release` package during deployment sync.
The older mainnet deployment command is a legacy-v1 simulation entry. The native ETH runbook describes
the final-key, package-integrity and receipt-based checks; neither entry can currently broadcast mainnet.

The hero address `0xaecf9909e55f5e98b84a9a737db0238b87393e1a` is the separately supplied HYL token CA.
It is not a pool deployment address. Deposits/notes are scoped to their original chain and pool: this project does
not bridge or automatically migrate testnet notes or balances to mainnet.

## Verification recorded on 21 November 2026

- Public RPC returned chain ID `4663` and block `119281461` during the read-only preflight. This is a point-in-time
  read, not evidence of production readiness. Preflight exited 1 as intended because release blockers remain open.
  A later check returned `rpcCheck: unavailable`; a direct curl check failed TLS hostname validation, including
  outside the sandbox. TLS verification remains enabled. Confirm a healthy authenticated production provider
  before any simulation or signing; an earlier chain-ID response does not establish current RPC availability.
- `npm run check` and `npm run check:privacy-scripts` passed; the application suite passed **607 tests in 36 files**.
- The full Forge suite passed **71 tests**, including 15 native ETH wrapper regressions and two v2 accounting/replay invariants at
  **64 runs × 32 calls** each and a duplicate-deposit exit-order fuzz test at **256 runs**. These use
  real v2 development proofs; they do not validate production keys or replace independent review.
- `VITE_PRIVACY_PROTOCOL=hylsia-pp-v2-eth VITE_PRIVACY_CHAIN_IDS=4663 npm run build` passed; existing dependency annotation and large-chunk warnings remain.
- Native ETH local app/server acceptance passed with real development proofs, publisher/relayer and backup recovery.
  The packaged deployment template passed simulation and actual owned-Anvil receipt/runtime checks. These are
  local results, not production browser validation or a public mainnet deployment.
- All **37 frozen artifacts** retained their recorded SHA-256 hashes.
- The pinned public phase-1 file matched the published BLAKE2b-512 digest. A CLI negative check rejected
  the frozen local-development transcript before creating a session. Ceremony output-path tests reject
  writes outside `ceremonies/`, existing sessions and symlinks.
- Both initial v2 zkeys verified against their R1CS and the pinned transcript, and both contribution
  challenges were exported in an ignored, isolated workspace. All 86 recorded files passed integrity
  checks; R1CS hashes match the tested development circuits. The [preparation record](../security/mainnet-ceremony-preparation.json)
  explicitly retains `productionReady: false`, `broadcastAllowed: false`, pending full phase-1 verification
  and zero phase-2 contributions. The long-running full phase-1 verification was interrupted, not completed.
- H-01's real-proof contract reproduction passed, confirming that the existing protocol still has the bug.
- Mainnet broadcast refusal was exercised before RPC parsing/signer creation. No transaction was sent, no mainnet
  pool record was created, and the testnet deployment was not replaced. Browser/mobile UI QA was not performed.
