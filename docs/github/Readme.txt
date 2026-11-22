<p align="center">
  <img src="public/web-share.png" alt="Hylsia Privacy Pools — Your assets. Your privacy." width="960" />
</p>

# Hylsia

**Private payments on Ethereum.**

Hylsia is a privacy pools research project by **Hylsia Research**, building a web application and developer foundations for private ETH withdrawals using zero-knowledge proofs. The current implementation is built for **Robinhood Chain Testnet**.

[Website](https://www.hylsiapools.tech) · [Documentation](https://www.hylsiapools.tech/docs) · [Manifesto](https://www.hylsiapools.tech/docs/manifesto) · [Developer modules](#developer-modules) · [Contributing](#contributing)

> [!WARNING]
> **Testnet only. Not audited. Development trusted setup. Do not use real funds.**
>
> Public release remains blocked by **H-01**, a known issue that can strand duplicate deposits. Read the [security status](#security-status) before testing deposit or withdrawal flows.

## Why Hylsia

Public ledgers make transactions verifiable, but they also expose financial relationships. Hylsia explores how people can retain more control over those relationships while proving that a withdrawal belongs to an eligible set of deposits.

The project combines local proof generation, encrypted backup and recovery, and an explicit association-set policy. Its design makes the roles of the user, publisher, and relayer visible so developers can examine both the privacy model and its limits.

## What the application includes

| Capability            | Current implementation                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| ETH deposits          | Deposit native testnet ETH into the pool and track the resulting notes in My vault.                                                |
| Private withdrawals   | Generate a Groth16 proof locally and withdraw through a relayer or by paying your own gas.                                         |
| Partial withdrawals   | Withdraw part of a note and retain the remainder as a recoverable change note.                                                     |
| Encrypted vault       | Protect the vault seed with a password and export an encrypted backup for recovery.                                                |
| Screening             | Prove membership in an association set published under the operator's exclusion policy.                                            |
| Public exit           | Use ragequit for an unspent note with its ownership proof, the original depositor wallet, and gas, subject to the H-01 limitation. |
| Product documentation | Read the manifesto, walkthroughs, recovery guidance, and privacy limits at `/docs`.                                                |

The current scope is **native ETH on testnet**. Mainnet, ERC-20 pools, shielded transfers, payment links, and bridging are outside this implementation.

## Network and deployment

| Setting           | Value                                                                  |
| ----------------- | ---------------------------------------------------------------------- |
| Network           | Robinhood Chain Testnet                                                |
| Chain ID          | `46630`                                                                |
| Asset             | Native testnet ETH                                                     |
| Pool              | `0xbBc4362133e4d50157206Cc907909d0C0211913f`                           |
| Deployment record | [`contracts/deployments/46630.json`](contracts/deployments/46630.json) |

Deployment details come from the checked-in record. A deployed contract and readable pool state do not establish that the complete public deposit-to-withdrawal flow has been validated. Local end-to-end tests exercise the protocol on Anvil; public wallet, hosting, and operational validation remain release gates.

## How a withdrawal works

1. **Prepare the vault.** Create or restore a vault and verify the encrypted backup before depositing. Use one active browser profile per backup while H-01 remains open.
2. **Deposit testnet ETH.** The pool records a commitment. The vault derives the secrets needed to recognize and spend the note.
3. **Wait for inclusion.** A deposit becomes eligible after one hour from its block timestamp, then waits for a published association root that includes it. Eligibility alone does not make it withdrawable.
4. **Prove and withdraw.** The browser generates the proof locally. A relayer can submit it for a quoted fee, or a connected wallet can pay gas. A partial withdrawal creates a change note.

The withdrawal amount includes the relayer fee: the recipient receives `amount − fee`, and the remaining note value becomes change. Fees depend on the current quote and configuration.

Privacy depends on more than the proof. Amounts, timing, RPC requests, relayer metadata, and the wallet paying gas can reveal relationships. Association-set counts represent deposits rather than independent people. Ragequit publicly reveals the deposit label and can link a change note to an earlier partial withdrawal. See the [privacy guide](https://www.hylsiapools.tech/docs/privacy).

## Developer modules

[`shared/privacy/`](shared/privacy/) contains the TypeScript foundation for future SDK work. These modules are used directly by the web application and server. **SDK status: in-repository source modules.** Standalone packaging and a stable external API remain contribution areas; the root package is configured with `private: true`.

| Area                                     | Source                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Note derivation and domain separation    | [`notes.ts`](shared/privacy/notes.ts), [`context.ts`](shared/privacy/context.ts)                                                          |
| Poseidon hashing and Merkle trees        | [`poseidon.ts`](shared/privacy/poseidon.ts), [`merkleTree.ts`](shared/privacy/merkleTree.ts)                                              |
| Pool ABI, networks, and deployment types | [`abi.ts`](shared/privacy/abi.ts), [`networks.ts`](shared/privacy/networks.ts), [`deploymentTypes.ts`](shared/privacy/deploymentTypes.ts) |
| Encrypted backups and chain discovery    | [`vault.ts`](shared/privacy/vault.ts), [`indexer.ts`](shared/privacy/indexer.ts)                                                          |
| Association-set policy and API types     | [`screening.ts`](shared/privacy/screening.ts), [`api.ts`](shared/privacy/api.ts)                                                          |
| Local proof generation                   | [`prover.ts`](shared/privacy/prover.ts)                                                                                                   |

The main barrel is [`shared/privacy/index.ts`](shared/privacy/index.ts); the prover has a separate module entry point. This read-only example checks that the recorded pool scope matches its address and network. Run it with `tsx` from a TypeScript file at the repository root:

```ts
import { computeScope, DEPLOYMENTS } from "./shared/privacy/index";

const deployment = DEPLOYMENTS[46630];
const scope = computeScope(deployment.pool, deployment.chainId);

if (scope !== BigInt(deployment.scope)) {
  throw new Error("Deployment scope mismatch");
}

console.log("Recorded pool scope matches its network and address.");
```

This example uses no wallet, private key, or RPC. Integration work should also review note recovery, association-root freshness, fee validation, and the security findings before constructing transactions.

## Local development

Use **Node.js 20.19 or newer** and **npm 11**. Foundry (`forge` and `anvil`) is required for contract tests and the local end-to-end suite.

From a fresh checkout without service signer keys, install dependencies and start the application with automatic association-root publishing disabled:

```sh
npm ci
PRIVACY_ASP_AUTO_PUBLISH_SECONDS=0 npm run dev
```

Open `http://localhost:3000`; the server chooses another available port if necessary. Product documentation is at `/docs`, and My vault is at `/pools/vault`. UI inspection and public pool reads do not require service private keys. Transaction flows additionally depend on the configured network, wallet, publisher, and relayer availability.

See [`.env.example`](.env.example) for configuration names and the [developer documentation](docs/privacy-pools/README.md) for operational details. Never put an owner or deployer key into the application runtime.

### Validation commands

| Command                     | Purpose                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `npm run check`             | TypeScript checks.                                                       |
| `npm test`                  | Application and shared-module tests.                                     |
| `npm run build`             | Build the client and Node server.                                        |
| `npm run zk:contracts:test` | Solidity tests with Foundry.                                             |
| `npm run zk:e2e`            | End-to-end flows on two local Anvil instances restricted to `127.0.0.1`. |

**Keep the active proving artifacts intact.** `npm run zk:build` regenerates circuit/setup artifacts and is not a getting-started step for the recorded deployment. Contract, circuit, verifier, proving-key, manifest, and deployment changes require a coordinated protocol version and review. Deployment and publisher commands can broadcast transactions; they are separate from the local validation commands above.

## Repository layout

```text
client/src/           Web application, vault interface, and product docs
server/privacy/       Pool APIs, association-set publisher, and relayer
shared/privacy/       Shared TypeScript primitives and SDK foundation
contracts/            Solidity contracts, Foundry tests, and deployment records
circuits/             Circom sources for withdrawal and ownership proofs
client/public/zk/     Active proving artifacts and integrity manifest
scripts/privacy/      Local testing and operator tooling
docs/privacy-pools/   Developer documentation and release runbooks
docs/security/        Security findings and frozen-artifact inventory
```

## Contributing

Contributions are welcome across protocol research, developer tooling, testing, documentation, and accessibility. Useful starting points include resolving H-01, improving recovery and relayer resilience, and designing a stable SDK package around the existing modules.

1. **Describe the change.** Open an issue for a bug or proposal. Discuss protocol, cryptography, or SDK API changes before implementing them. Include a minimal reproduction for bugs.
2. **Keep the change focused.** Work in a branch on your fork and follow the surrounding TypeScript, React, Circom, or Solidity conventions.
3. **Validate the behavior.** Run the checks relevant to the change. Add tests for changed protocol or application behavior, and update documentation when user-visible behavior changes.
4. **Open a pull request.** Explain the problem, resulting behavior, validation performed, and any security or compatibility implications.

Never include vault seeds, note secrets, passwords, decrypted backups, private keys, `.env` contents, or private operator data in issues, pull requests, fixtures, or logs. Propose changes to the frozen protocol and proving artifacts explicitly; do not silently regenerate or replace them.

For collaboration, contact [hylsia101@gmail.com](mailto:hylsia101@gmail.com). Report a new vulnerability privately through this address before disclosing sensitive details in a public issue.

## Security status

**H-01 remains a release blocker.** Using the same backup concurrently across browser profiles or devices can reuse a note precommitment and its nullifier. After one such deposit is spent, another deposit sharing that nullifier cannot be withdrawn or ragequit. Coordination between tabs in the same browser origin/profile reduces local concurrency risk but does not resolve the cross-device issue.

The repository contains a local implementation review and regression tests. These do not constitute an independent audit. The current proving keys use a development trusted setup. Public release also requires source verification, production hosting validation, and real wallet and browser validation described in the [release checklist](docs/privacy-pools/release-checklist.md).

- [Security findings and review scope](docs/security/findings.md)
- [Release gates and operator runbook](docs/privacy-pools/release-checklist.md)
- [Association-root window and exclusion behavior](docs/privacy-pools/asp-window.md)
- [Frozen-artifact inventory](docs/security/frozen-artifacts.json)

## Documentation

- [Product documentation](https://www.hylsiapools.tech/docs) — deposit, withdrawal, recovery, screening, and privacy guidance.
- [Manifesto](https://www.hylsiapools.tech/docs/manifesto) — the principles behind Hylsia.
- [Developer reference](docs/privacy-pools/README.md) — architecture, configuration, deployment, and operations.
- [Engineering history](readme.txt) — the existing development log.

## Licensing and acknowledgments

The root package metadata declares MIT. A repository-level license file has not yet been added, and individual sources and dependencies carry their own notices; licensing documentation needs consolidation before a standalone SDK release.

Hylsia is an independent project. Robinhood Chain and its logo are trademarks of their owner; their use here names the network and does not imply endorsement.
