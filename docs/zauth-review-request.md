# Draft request for review of Hylsia's RepoScan provenance flags

This draft is for the maintainer to review and submit. It has not been sent to Zauth.

Repository: https://github.com/hylsia/hylsia_privacy_pools

Please review the provenance rationale in the 15/100 Hylsia Privacy Pools report. We acknowledge
that this is a young repository with limited contributor diversity, unsigned history, no independent
audit, and operational/security work remaining. We are not asking that these risks be hidden or that
a particular score be assigned.

The report states that commits predating the GitHub repository's creation are impossible without
deliberate timestamp manipulation. GitHub supports pushing existing local Git repositories into a
newly created GitHub repository. The creation date of that GitHub repository alone therefore does
not establish fabricated commit dates.

GitHub's public API reports this repository was created on 21 November 2026 at 16:57:06 UTC.
The retained source history starts with commit `5328dd02ae9511af0b782ae40cd6922824513de2`, dated
17 November. Author and committer dates match in the 22-commit local checkout inspected, but we
recognize that user-controlled Git metadata is not independent timestamp or identity attestation.

There is separate public chronology evidence: Robinhood Chain Testnet deployment transaction
`0x3ee049e43af2f4e13f6cbff628a81a8dc623a88badda1497febc47677cea92f0` successfully created pool
`0xbBc4362133e4d50157206Cc907909d0C0211913f` at block `154136462`, timestamp
16 November 2026, 16:06:17 UTC, before this public repository was created. This proves the contract
deployment existed earlier; it does not authenticate every later source file or constitute an audit.

The report also labels `nemesisd-d` a fake contributor because the repository was absent from the
account's public activity timeline. GitHub documents contribution-eligibility rules, email/account
linkage, visibility restrictions and update delays. The contributors API associates 20 commits with
that account. Neither this association nor a missing profile event is cryptographic identity proof.
Please distinguish an identity that has not been independently verified from a proven fabricated one.

Finally, the report refers to skipped Solana files and Helius RPC. This application's contracts are
Solidity, its supported pool networks are EVM chains, and the reviewed application/protocol source
contains no Helius reference. Please assess the actual contracts, Circom circuits and trust model
separately from unsupported technology or authorship inferences.

The public head at review time was `2a37ecb32cc5980ae3e95ccb35bbc8b13e813c5e`; the local checkout
was `b46edcbb82a36dfb7410e2b84032e00cf8ebd4b7`, with divergent changes on both sides. These must
be reconciled before a rescan can evaluate the newer mainnet record and API work.

Evidence and limitations:

- [Repository review](repository-health.md)
- [Observed chronology and Git metadata](security/repository-provenance-2026-11-22.json)
- [Testnet deployment transaction](https://explorer.testnet.chain.robinhood.com/tx/0x3ee049e43af2f4e13f6cbff628a81a8dc623a88badda1497febc47677cea92f0)
- [GitHub: importing an existing local repository](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)
- [GitHub: troubleshooting missing contributions](https://docs.github.com/en/account-and-profile/how-tos/contribution-settings/troubleshooting-missing-contributions)
- [GitHub: commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)

Please retain the valid risk findings, correct the unsupported provenance conclusions, and provide
an updated report with its scan identifier and the exact repository commit assessed.
