<p align="center">
  <a href="https://hylsiapools.tech/">
    <img src="client/public/brand/hylsia/mark-256.png" alt="Hylsia logo" width="88" height="88" />
  </a>
</p>

<h1 align="center">Hylsia Privacy Pools</h1>

<p align="center">
  <strong>Your assets. Your privacy.</strong>
</p>

<p align="center">
  A privacy pools research project by <strong>Hylsia Research</strong>, with a native ETH deployment on Ethereum and a separate Robinhood Chain Testnet pool.
</p>

<p align="center">
  <a href="https://hylsiapools.tech/">Website</a> ·
  <a href="https://hylsiapools.tech/docs">Documentation</a> ·
  <a href="https://hylsiapools.tech/docs/manifesto">Manifesto</a> ·
  <a href="#local-development">Getting started</a> ·
  <a href="#developer-modules">Developer modules</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

Hylsia combines zero-knowledge ETH withdrawals, an encrypted seed vault, and association-set screening in one web application. Users deposit ETH into a pool, generate ownership proofs on their device, and withdraw through a relayer or a wallet that pays its own gas.

The repository includes the application, Solidity contracts, Circom circuits, operator services, and shared TypeScript modules. It is intended for developers and researchers exploring how privacy pools work, how notes can be recovered, and where transaction metadata can still reveal relationships.

> [!WARNING]
> **The hosted application defaults to testnet. No independent audit.**
>
> The active testnet v1 pool has a known deposit-reuse issue, **H-01**, that can leave funds inaccessible. Native ETH v2 has been deployed to **Ethereum mainnet using an explicitly authorized single-operator trusted setup**. The application now supports a separate mainnet profile, wallet-approved ASP publication and self-paid withdrawals. Mainnet has not been independently audited. Deploy the updated client/server together; see [application operation](docs/privacy-pools/application-mainnet.md) and the [deployment trust model](docs/privacy-pools/single-operator-mainnet.md).

## Why Hylsia

Public blockchains make transactions verifiable while exposing amounts, timing, and financial relationships. Hylsia explores how a user can prove ownership of an eligible note without publishing its secrets.

The design brings three concerns together:

- **Proof generation on the device.** Seeds, note secrets, and witnesses stay in the unlocked client session.
- **Recovery from an encrypted backup.** A seed and complete public chain history reconstruct notes and their remaining balances.
- **Explicit operator roles.** The association-set publisher determines eligibility for private withdrawals; a relayer submits proof-authorized transactions. Their powers and limitations are documented.

Privacy also depends on the size of the eligible set and how the application is used. Amounts, timing, RPC access, relayer metadata, and gas-paying wallets can reveal links. See the [privacy guide](https://hylsiapools.tech/docs/privacy).

## What the application includes

| Capability                  | What it does                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Native ETH deposits         | Records deposit commitments and discovers the resulting notes in My vault.                                                        |
| Private withdrawals         | Generates Groth16 proofs locally and supports relayed or self-paid submission.                                                    |
| Partial withdrawals         | Returns the remaining value to the pool as a recoverable change note.                                                             |
| Encrypted vault and backups | Protects the seed with a password and verifies that an exported backup restores it.                                               |
| Association-set screening   | Proves that a note's label belongs to the published eligible set.                                                                 |
| Public exit                 | Provides ragequit for an unspent note, with its ownership proof and original depositor wallet, subject to the v1 H-01 limitation. |
| Product documentation       | Explains deposits, withdrawals, recovery, screening, and privacy limits at `/docs`.                                               |

The implemented asset is **native ETH**. ERC-20 pools, shielded transfers, payment links, and bridging remain outside the current application.

## How a withdrawal works

1. **Prepare the vault.** Create or restore a vault, export its encrypted backup, and verify that backup before depositing. For the active v1 protocol, use one browser profile per backup while H-01 remains open.
2. **Deposit testnet ETH.** The pool records a commitment, and the vault recognizes the note using its derived secrets.
3. **Wait for inclusion.** On Robinhood Chain Testnet, a confirmed deposit becomes eligible one hour after its block timestamp, then waits for a published root that includes it.
4. **Generate a proof and withdraw.** The device proves ownership and association-set membership. A relayer or connected wallet submits the transaction; a partial withdrawal creates a change note.

The recipient receives `withdrawal amount − relayer fee`. Any unwithdrawn note value becomes change. Eligibility and inclusion are separate steps, and association-set counts represent deposits rather than independent people.

Ragequit does not require ASP approval, but it reveals the deposit label. Exiting a change note can link it to its original deposit and earlier partial withdrawal.

## Network and development status

| Area                    | Status                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Active implementation   | Protocol v1 on Robinhood Chain Testnet, chain ID `46630`.                                                                         |
| Asset                   | Native ETH. The hosted application uses testnet; the Ethereum contract is a separate mainnet deployment. |
| Recorded pool           | `0xbBc4362133e4d50157206Cc907909d0C0211913f`                                                                                      |
| Protocol v2             | Label-bound nullifiers, random recovery nonces, protocol-specific backups and application/server integration; Ethereum uses a separately finalized native ETH package. |
| Robinhood Chain mainnet | Chain ID `4663`; preparation only. No mainnet pool deployment is recorded.                                                        |
| Ethereum mainnet | Chain ID `1`; native ETH v2 deployed at [`0xAC84cFAC0a7C55760197b0681576CD27837cCfea`](https://eth.blockscout.com/address/0xAC84cFAC0a7C55760197b0681576CD27837cCfea). Application source supports its separate mainnet vault, manual wallet publisher and self-paid withdrawals; hosting needs the updated build. |
| Security review         | Ethereum deployment uses final keys from one operator, without an independent audit. The separate reviewed application-release gate remains closed. |

Pool details come from the [testnet deployment record](contracts/deployments/46630.json) and [Ethereum deployment record](contracts/deployments/1.json). A deployed contract and passing local tests do not establish that public wallet, browser, hosting, and operational validation are complete.

Read the [v2 development notes](docs/privacy-pools/protocol-v2-candidate.md) and [mainnet migration runbook](docs/privacy-pools/mainnet-migration.md) for the current implementation and remaining release work.

## Local development

Use **Node.js 20.19+** and **npm 11**. Contract and local end-to-end tests also require **Foundry** (`forge` and `anvil`).

From a fresh checkout without service signer keys:

```sh
npm ci
PRIVACY_ASP_AUTO_PUBLISH_SECONDS=0 npm run dev
```

Open `http://localhost:3000`. The development server selects another available port if necessary.

| Route          | Purpose                                           |
| -------------- | ------------------------------------------------- |
| `/`            | Project introduction.                             |
| `/pools`       | Pool statistics and public activity.              |
| `/pools/vault` | Vault, notes, deposits, withdrawals, and backups. |
| `/docs`        | Product documentation and guides.                 |

See [`.env.example`](.env.example) for configuration and the [developer reference](docs/privacy-pools/README.md) for operational details. UI inspection does not require a service private key. Transaction flows additionally require the configured network, wallet, and relevant services.

For local v2 work, use the [local profile](config/v2-local.env.example). For mainnet preparation, merge the public configuration fields from the [mainnet profile](config/robinhood-mainnet.env.example) into your own environment. Completing that configuration does not approve a protocol release.
The [ceremony workflow](docs/privacy-pools/mainnet-ceremony.md) describes the independent-contributor path. The [Ethereum deployment](docs/privacy-pools/single-operator-mainnet.md) instead uses explicit project-owner authorization for final keys from one operator, with its trust model recorded honestly.
The [native ETH v2 runbook](docs/privacy-pools/native-eth-v2.md) covers its separate runtime, final-artifact packaging, local acceptance tests and dedicated deployment command. The default reviewed route requires independent review; the application also has the owner's exact [single-operator Ethereum authorization](docs/privacy-pools/application-mainnet.md).
The [two-network deployment guide](docs/privacy-pools/dual-mainnet.md) covers Ethereum and Robinhood Chain targets, per-chain budgets and the deployment-only environment signer.
The [application network guide](docs/privacy-pools/application-mainnet.md) covers the upper-right Testnet/Mainnet menu, separate vaults/backups, final proving assets, wallet-signed ASP roots and optional relayers. Production builds enable the exact authorized Ethereum profile by default; development uses the public flags in [the application profile](config/application-mainnet.env.example).

### Validation commands

| Command                                     | Purpose                                                                                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                             | TypeScript checks.                                                                                                                       |
| `npm run check:privacy-scripts`             | Release and deployment tooling type checks.                                                                                              |
| `npm run check:artifacts`                   | Fresh-clone verification of the committed v1 frozen artifacts.                                                                            |
| `npm test`                                  | Application and shared-module tests.                                                                                                     |
| `npm run build`                             | Client, standalone Node server, and Vercel API bundle build.                                                                               |
| `npm run zk:contracts:test`                 | Solidity tests with Foundry.                                                                                                             |
| `npm run zk:e2e`                            | V1 flows on two local Anvil chains.                                                                                                      |
| `npm run zk:v2:e2e`                         | V2 deployment, recovery, publisher, relayer, and exit flows on a disposable local Anvil. Requires the separate v2 development artifacts. |
| `npm run zk:mainnet:preflight -- --offline` | Mainnet configuration and release-blocker report without RPC reads or transactions.                                                      |

> [!IMPORTANT]
> Keep the active proving artifacts intact. `npm run zk:build` regenerates the setup and is not a getting-started step for the existing pool. Protocol, circuit, verifier, key, manifest, and deployment changes must stay versioned and coordinated.

Owner and deployer custody stays outside the application runtime. Deployment and publisher commands can broadcast transactions; follow their runbooks before using them.

## Developer modules

[`shared/privacy/`](shared/privacy/) contains the TypeScript modules used by the application and server. They are the foundation for future SDK work; a separately published package and stable external API are not available yet.

| Area                                  | Source                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Note derivation and scope             | [`notes.ts`](shared/privacy/notes.ts), [`context.ts`](shared/privacy/context.ts)                                      |
| Hashing and Merkle trees              | [`poseidon.ts`](shared/privacy/poseidon.ts), [`merkleTree.ts`](shared/privacy/merkleTree.ts)                          |
| ABI and network configuration         | [`abi.ts`](shared/privacy/abi.ts), [`networks.ts`](shared/privacy/networks.ts)                                        |
| Backup encryption and event discovery | [`vault.ts`](shared/privacy/vault.ts), [`indexer.ts`](shared/privacy/indexer.ts)                                      |
| Protocol selection and v2             | [`runtime.ts`](shared/privacy/runtime.ts), [`protocols.ts`](shared/privacy/protocols.ts), [`v2/`](shared/privacy/v2/) |
| Screening and API types               | [`screening.ts`](shared/privacy/screening.ts), [`api.ts`](shared/privacy/api.ts)                                      |
| Local proof generation                | [`prover.ts`](shared/privacy/prover.ts)                                                                               |

The main entry point is [`shared/privacy/index.ts`](shared/privacy/index.ts); proving helpers have a separate module entry point.

## Repository layout

```text
client/src/           Application, vault interface, and product docs
server/privacy/       Pool APIs, publisher, and relayer
shared/privacy/       Shared primitives and protocol runtime
contracts/            Solidity contracts, tests, and deployment scripts
circuits/             Circom sources and separate v1/v2 build workspaces
client/public/zk/     Active v1 proving artifacts and integrity manifest
scripts/privacy/      Local acceptance tests and operator tooling
docs/privacy-pools/   Architecture, development notes, and release runbooks
docs/security/        Findings, verification evidence, and frozen artifact hashes
```

## Security status

**H-01 remains open for the active v1 deployment.** Concurrent use of the same backup across browser profiles or devices can reuse a note precommitment and its spend nullifier. Spending one deposit can then make another deposit inaccessible through both withdrawal and ragequit. Same-profile tab coordination reduces local concurrency risk but does not resolve cross-device reuse.

V2 uses label-bound nullifiers and public random recovery nonces. Ethereum's native ETH v2 deployment uses separately finalized keys from a single operator; the final-key package passed nine real proofs and 17 native ETH contract regressions. This does not establish independent participation, an audit, or public application readiness. The testnet/development artifacts remain separate.

- [Security findings](docs/security/findings.md)
- [V2 protocol and validation notes](docs/privacy-pools/protocol-v2-candidate.md)
- [Release checklist](docs/privacy-pools/release-checklist.md)
- [Association-root window](docs/privacy-pools/asp-window.md)
- [Frozen artifact inventory](docs/security/frozen-artifacts.json)

## Contributing

Contributions are welcome in protocol research, testing, recovery, operator resilience, documentation, accessibility, and developer tooling. See [CONTRIBUTING.md](CONTRIBUTING.md) for the toolchain, checks, review process, and artifact boundaries. Report exploitable vulnerabilities through [SECURITY.md](SECURITY.md).

1. Open an issue describing the bug or proposal. Discuss protocol, cryptography, and public API changes before implementation.
2. Work in a focused branch and follow the surrounding TypeScript, React, Circom, and Solidity conventions.
3. Run the relevant checks and update documentation for changed behavior.
4. Open a pull request explaining the problem, resulting behavior, validation, and security implications.

Keep seeds, note secrets, passwords, decrypted backups, private keys, `.env` contents, and private operator data out of issues, pull requests, fixtures, and logs.

For collaboration or private vulnerability reports: [hylsia101@gmail.com](mailto:hylsia101@gmail.com).

## Licensing and acknowledgments

The root [MIT license](LICENSE) applies to otherwise unmarked project files, consistent with the existing package metadata. Source files with Apache-2.0 or GPL-3.0 headers, generated verifiers, vendored Forge Standard Library, and dependencies retain their own notices. See [licensing and upstream provenance](THIRD_PARTY_NOTICES.md).

Hylsia is an independent project. Robinhood Chain and its logo are trademarks of their owner. Naming the network does not imply endorsement.

## Repository health and verification

The [22 November repository review](docs/repository-health.md) records the public GitHub snapshot,
divergent checkout history, open dependency findings, and remaining maintainer actions. The new
CI workflow runs application types/tests/build, committed artifact integrity checks, and Solidity
tests on PRs and pushes to `main`. It requires no production signing keys and performs no deployment.
Hosted CI results only become available after the workflow is published and run on GitHub.

Dependabot proposes npm and action updates weekly. A separate scheduled production dependency audit
fails on high/critical findings; its initial scan is not clean. These checks and repository scores do
not replace independent cryptographic review or establish production readiness.
