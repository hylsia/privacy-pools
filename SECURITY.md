# Security policy

## Current security status

Hylsia has not been independently audited. Ethereum mainnet uses a separately finalized,
single-operator trusted setup. The Robinhood Chain Testnet v1 deployment has the documented
H-01 duplicate-precommitment/nullifier issue. Mainnet v2 uses a different protocol and artifact
package; its existence does not establish that all browser, hosting, or operational checks pass.

See [known findings](docs/security/findings.md), the
[Ethereum trust model](docs/privacy-pools/single-operator-mainnet.md), and
[application operation](docs/privacy-pools/application-mainnet.md).
The dependency findings in [the repository review](docs/repository-health.md) remain open.

## Report a vulnerability privately

Email **hylsia101@gmail.com** with the affected commit, protocol/network, impact, and a minimal
reproduction using synthetic data. Public contract addresses and transaction hashes are useful.
Do not open a public issue for an exploitable vulnerability before coordinated disclosure.

Never send wallet private keys, seeds, note secrets, passwords, decrypted backups, `.env` contents,
or RPC credentials. Do not test against other users' assets or submit mainnet transactions to
demonstrate a vulnerability. A local reproduction is preferred.

No response deadline or paid bug bounty is promised. A fix in source does not update an immutable
deployed contract; affected deployments and required migration steps must be disclosed separately.

## Public evidence

- [Ethereum deployment record](contracts/deployments/1.json)
- [Deployment and source-verification evidence](docs/security/ethereum-mainnet-deployment-verification.json)
- [Frozen v1 artifact inventory](docs/security/frozen-artifacts.json)

Source verification, automated tests, and repository scores are distinct from an independent audit.
