# Hylsia Whitepaper

Nov 15, 2026 · @ray

## Draft status

This is a first draft built on assumptions; it does not describe a deployed or audited system.

- **Assumed:** Hylsia is a non-custodial shielded pool on Ethereum mainnet, in the Privacy Pools design family, focused on private ETH and stablecoin payments.
- **Placeholders:** bracketed items such as [TEAM], [AUDITOR] and [TOKEN DECISION] are facts only the team can supply.
- **Not claimed:** no token, yield rate, launch date, audit or partnership is asserted anywhere in this draft.

## Abstract

Hylsia is a non-custodial privacy protocol for Ethereum that lets people pay, receive, swap and earn without publishing their financial history, while proving their funds are not tied to known illicit activity.

Users deposit publicly into a shared pool. They then act privately, using zero-knowledge proofs that their funds belong to a screened set of deposits. There is no user KYC and no master viewing key, and every depositor can always exit publicly to their original address.

Hylsia's goal is to make private payments an ordinary wallet feature, not a destination people visit.

## 1. The problem

Ethereum users today choose between being exposed and being suspect.

**Public by default.** Every address shows its balance, counterparties and full history to anyone. Paying a friend reveals your net worth to them. Salaries, donations, supplier payments and medical bills become permanent public records.

**Mixers solved privacy and created stigma.** First-generation mixers pooled everyone into one anonymity set. Honest users could not separate themselves from stolen funds, and the 2022 sanctions on Tornado Cash made using such tools a legal and reputational risk.

**Custodial privacy is not privacy.** Services that hide activity from the public while holding user funds and identity documents rebuild the bank model, with one more party to trust and to breach.

What is missing is privacy that an honest user can defend: private to the public, provably clean to whoever they choose to show.

## 2. Why now

Three shifts in 2025 and 2026 turned compliant on-chain privacy from a research idea into a market.

- **Privacy is on Ethereum's core roadmap.** Vitalik Buterin's August 2026 roadmap comparison put privacy and quantum resistance at the center of protocol planning (The Block). The Lean Ethereum plan treats privacy as a protocol goal instead of an application add-on (CoinGape).
- **Shielded pools became usable products.** Privacy Pools v2 launched in October 2026 with private payments, swaps and yield inside one pool (Bankless). The category moved from "mixer" to "private account".
- **Institutions ask for it.** Ethereum Foundation leadership named institutional privacy a 2026 priority ahead of expected tokenization growth (AMBCrypto).

Native protocol privacy is still years of work away. The application layer is where users can get privacy today, and where Hylsia operates.

## 3. Design principles

Six commitments shape every Hylsia design decision.

- **Non-custodial.** Only the depositor's secret can move funds. No operator, relayer or screener can spend or freeze them.
- **Dissociation, not identification.** Users prove what their funds are not linked to. They never prove who they are.
- **Always an exit.** Any deposit can be withdrawn publicly to its original address at any time, approved or not.
- **Disclosure is opt-in.** There is no master viewing key. A user can produce a proof of their own history for a counterparty they choose.
- **Open and verifiable.** Contracts, circuits and screening policy are public, so claims can be checked instead of trusted.
- **Honest about trust.** Where Hylsia relies on a trusted party, this paper names it (see section 7).

## 4. How Hylsia works

A deposit is public, everything after it is proven in zero knowledge, and a public exit is always available.

1. **Deposit (public).** The user sends ETH or a supported ERC-20 to the pool contract. The contract stores a commitment, a hash of the user's secret, the value and a deposit label, in a Merkle tree.
2. **Screening.** An Association Set Provider (ASP) checks the deposit's source against public risk data such as sanctions lists and known hack or phishing addresses. It publishes the Merkle root of approved deposit labels on-chain.
3. **Proof.** In the user's own browser or wallet, a zero-knowledge proof shows three things: the user owns an unspent commitment, its label is in the approved set, and its nullifier has not been used. The proof does not reveal which deposit it is.
4. **Relay.** A relayer submits the transaction and pays gas, so the receiving address needs no prior funding that could link it.
5. **Private action or exit.** The user pays, swaps, earns or withdraws to any address. A deposit that is not approved, or any user who prefers, can exit publicly to the original deposit address.

### Building blocks

| Component | Role |
|---|---|
| Commitments | Hide the owner and link of each note in the pool |
| Nullifiers | Prevent double-spending without revealing which note was spent |
| Merkle trees | Let a proof reference the whole pool and the approved set with one root each |
| zk-SNARK circuit | Proves ownership and set membership; proof system [PROOF SYSTEM, to be confirmed by the team] |
| Deposit labels | Carry a deposit's screening status through transfers so approval stays meaningful |

### Limits users should know

Privacy is statistical, not absolute. It depends on how many approved deposits share the pool, and it weakens if a user deposits and withdraws the same unusual amount minutes apart. Hylsia's interface will recommend standard amounts and waiting periods.

## 5. Product

Hylsia is designed as a private account, not a one-time mixer: funds stay shielded while the user does ordinary things with them.

| Feature | What the user does | What the public sees |
|---|---|---|
| Private send | Pays any Ethereum address from a shielded balance | The recipient and amount received, not the payer |
| Shielded transfer | Pays another Hylsia user inside the pool | A pool transaction with no sender, recipient or amount |
| Payment link | Shares a link to request funds without giving an address | Nothing that ties requester to payer |
| Private swap | Trades one shielded asset for another through [DEX INTEGRATION] | A swap by the pool, not by a user |
| Private yield | Routes shielded funds to [LENDING PROTOCOL]; no rate is promised | A pool-level position |
| Disclosure receipt | Exports a proof of source of funds for an exchange, auditor or tax filing | Nothing; shared only with the chosen party |
| SDK | Lets wallets and payment apps embed all of the above | Not applicable |

The SDK is the growth strategy. Privacy becomes normal when it is a "send privately" button in wallets people already use.

## 6. Compliance model

Hylsia screens deposits, not people, and leaves disclosure in the user's hands.

- **Association sets.** An ASP maintains the list of approved deposits. At launch the ASP is operated by [ASP OPERATOR] under a published screening policy. The target is several independent ASPs that users and counterparties can choose between.
- **What screening covers.** On-chain source-of-funds checks against sanctions lists and known exploit, theft and phishing addresses. It collects no names, documents or IP-based identity.
- **Later removal.** If new evidence links a deposit to illicit activity, the ASP removes it from the approved set. The holder keeps the public exit to the original address.
- **Selective disclosure.** A user can prove their own deposit and withdrawal history to a party they choose. Nobody else can.

This model does not guarantee legal treatment in any jurisdiction. Relayers and ASP operators may carry regulatory obligations, and the team should obtain an opinion from [LEGAL COUNSEL] before launch.

## 7. Trust assumptions and risks

Hylsia is less private and less decentralized than a pool with no screening layer; that is the trade it makes for usability and legitimacy.

| Risk | What it means | Mitigation |
|---|---|---|
| ASP gatekeeping | One screener can delay or deny approval, and critics call this guilty until approved | Published policy, public exit always open, multiple ASPs on the roadmap |
| Small anonymity set | Few approved deposits means weak privacy | Standard amounts, interface warnings, pool-size shown before each action |
| Contract or circuit bug | Funds could be lost or privacy broken | Audit by [AUDITOR], deposit caps at launch, bug bounty |
| Upgradeable contracts | Whoever controls upgrades could change the rules | [MULTISIG CONFIG] with timelock, moving to on-chain governance |
| Relayer dependence | A single relayer can censor or log metadata | Self-relay option, open relayer set |
| Trusted setup | Some proof systems need a ceremony that must not be compromised | Public multi-party ceremony, or a transparent proof system |
| Metadata leaks | IP address, timing and amounts can link actions | Client-side proving, guidance on delays, optional private RPC |
| Lost secrets | A lost recovery phrase means lost funds | Single seed-phrase recovery, clear backup flow |
| Regulation | Rules for privacy tools differ by country and can change | Legal review per market, no operation where prohibited |

Privacy purists will prefer systems with no screening. Hylsia is for users who need privacy they can explain to a bank, an employer or a regulator.

## 8. Governance and economics

The protocol works without a token, and this draft does not assume one.

- **Fees.** A relayer fee covers gas, plus a protocol fee of [FEE %] on private withdrawals. Deposits and public exits carry no protocol fee.
- **Token.** [TOKEN DECISION]. If the team issues a token, this section must state supply, allocation, vesting, utility and legal classification. Nothing in this paper is an offer to sell any asset.
- **Governance.** Launch control sits with [MULTISIG CONFIG] behind a timelock. Governed parameters are the ASP list, fee level, deposit caps and contract upgrades.
- **Team and funding.** [TEAM], [BACKERS].

## 9. Roadmap

Each phase opens only when the gate before it is met; dates are for the team to set.

1. **Specification.** Public protocol spec and open-source circuits. Gate: repository and spec published.
2. **Testnet.** Deposit, private withdrawal and public exit on Sepolia. Gate: independent audit completed and findings published.
3. **Guarded mainnet.** ETH and one stablecoin on Ethereum, with deposit caps. Gate: [N] weeks live with no critical incident.
4. **Payments.** Shielded transfers, payment links and the SDK. Gate: first wallet integration shipped.
5. **Swaps and yield.** Private swaps and lending integrations, plus a second independent ASP.
6. **Decentralization.** Timelocked on-chain governance and a permissionless relayer set.

## Disclaimer

This paper is for information only. It is not an offer of securities, investment advice or a promise of returns. The protocol described is unbuilt and unaudited until this paper says otherwise. Users are responsible for complying with the laws of their own jurisdiction.

## References

- Buterin, Illum, Nadler, Schär, Soleimani, "Blockchain Privacy and Regulatory Compliance: Towards a Practical Equilibrium" (2023), the paper behind the Privacy Pools design
- Privacy Pools v2 Goes Live With Bigger Feature Suite, Bankless, Oct 21, 2026
- Privacy Pools Go Live on Ethereum, The Defiant, Apr 1, 2025
- Vitalik Buterin puts privacy and quantum resistance front and center, The Block, Aug 10, 2026
- Lean Ethereum roadmap, CoinGape, Jul 2026
- Ethereum Foundation end-to-end privacy roadmap, The Block, Sep 13, 2025
- Ethereum's 2026 roadmap puts institutional privacy front and center, AMBCrypto, Jan 2026
