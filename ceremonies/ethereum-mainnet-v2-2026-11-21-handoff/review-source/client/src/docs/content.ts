/** Static documentation. Search runs on this data locally and never sends a query to a service. */
import {
  DUPLICATE_NOTE_RISK,
  PUBLIC_VALIDATION_STATUS,
} from "../privacy/safetyCopy";
import { DEPLOYMENTS } from "../../../shared/privacy/deployments";
import { networkById } from "../../../shared/privacy/networks";

const ROBINHOOD_NETWORK = networkById(46630)!;

export type DocBlock =
  | { kind: "text"; text: string }
  | { kind: "callout"; tone: "note" | "warning"; title: string; text: string }
  | { kind: "list" | "steps"; items: { title: string; text: string }[] }
  | { kind: "table"; headings: string[]; rows: string[][] }
  | {
      kind: "cards";
      items: {
        title: string;
        text: string;
        href: string;
        icon: "book" | "shield" | "key" | "pool";
      }[];
    }
  | { kind: "flow" }
  | { kind: "quote"; text: string; caption: string };
export interface DocSection {
  id: string;
  title: string;
  blocks: DocBlock[];
}
export interface DocPage {
  slug: string;
  group: string;
  title: string;
  description: string;
  readTime: number;
  sections: DocSection[];
}
const text = (value: string): DocBlock => ({ kind: "text", text: value });
const note = (title: string, value: string, warning = false): DocBlock => ({
  kind: "callout",
  tone: warning ? "warning" : "note",
  title,
  text: value,
});
export const DOCS_REVIEW_DATE = "19 November 2026";
const deployment = DEPLOYMENTS[46630];

export const DOC_PAGES: DocPage[] = [
  {
    slug: "introduction",
    group: "Start here",
    title: "Welcome to Hylsia",
    readTime: 4,
    description:
      "A shared pool. A private connection. A clear account of what you can trust.",
    sections: [
      {
        id: "what-is-hylsia",
        title: "Privacy, with the details in the open",
        blocks: [
          text(
            "Hylsia is a native ETH privacy pool built for Robinhood Chain Testnet. You deposit testnet ETH into a shared pool and later withdraw to another address, using a proof made on your device. The proof demonstrates that the withdrawal spends an eligible, unspent note without identifying its original deposit."
          ),
          text(
            "The transactions themselves are public. Hylsia aims to make the connection between a deposit and a private withdrawal harder to determine. Amounts, timing, access metadata and a quiet pool can still reveal that connection."
          ),
          { kind: "flow" },
        ],
      },
      {
        id: "read-before-using",
        title: "Start with the current status",
        blocks: [
          note(
            "Experimental testnet · public validation remains open",
            "The pool contract is deployed on Robinhood Chain Testnet. Deposit, screening, withdrawal and recovery have passed local Anvil tests. An end-to-end run with real wallet signatures on the public testnet has not been validated. There is an open High severity issue with concurrent deposits from the same backup across browser profiles or devices. Read Security & status before testing.",
            true
          ),
          {
            kind: "cards",
            items: [
              {
                title: "Read the manifesto",
                text: "The principles behind the pool, and the limits we choose to make visible.",
                href: "/docs/manifesto",
                icon: "book",
              },
              {
                title: "Understand the safety limits",
                text: "What is verified locally, what remains open, and why the release is blocked.",
                href: "/docs/security",
                icon: "shield",
              },
              {
                title: "Learn the deposit flow",
                text: "A vault, a verified backup, and the wait for root inclusion.",
                href: "/docs/deposit",
                icon: "pool",
              },
              {
                title: "Protect your recovery",
                text: "What your backup restores and how to find a change note.",
                href: "/docs/recovery",
                icon: "key",
              },
            ],
          },
        ],
      },
      {
        id: "problems-hylsia-addresses",
        title: "Problems Hylsia addresses",
        blocks: [
          text(
            "A public ledger lets anyone verify a payment. It also lets observers connect addresses, follow payment trails and infer financial relationships. Hylsia explores how to preserve verification while revealing less about which deposit funded a withdrawal."
          ),
          {
            kind: "list",
            items: [
              {
                title: "Direct transfers expose payment relationships",
                text: "An ordinary ETH transfer directly connects the sending and receiving addresses. Hylsia routes deposits through a shared pool and verifies withdrawals with a zero-knowledge proof that does not identify the deposit being spent.",
              },
              {
                title: "Gas funding can reconnect separate wallets",
                text: "Funding a fresh address from an existing wallet creates a public connection. A Hylsia relayer can submit the withdrawal and pay gas for a quoted fee, so the recipient does not need a separate gas-funding transfer. Paying your own gas makes the gas payer visible.",
              },
              {
                title: "Private withdrawals still need verifiable rules",
                text: "The pool must verify ownership, prevent double spending and check eligibility without receiving the user's note secrets. Hylsia generates proofs on the user's device and checks membership in a published association set. Its screening policy is managed by the operator; inclusion is not a certification of funds or legal clearance.",
              },
              {
                title: "Browser data loss can put private notes out of reach",
                text: "Reconnecting a wallet does not restore note secrets. Hylsia provides an encrypted seed backup and requires backup verification before depositing. With the backup and its password, the owner can reconstruct notes and change from public chain data; the backup does not preserve the complete local activity log.",
              },
            ],
          },
          text(
            "The privacy benefit depends on the pool's use. Deposit and withdrawal amounts, addresses and timestamps remain public. A pool with only one deposit offers little cover, and distinctive amounts or close timing can still suggest a connection."
          ),
        ],
      },
      {
        id: "one-chain-one-asset",
        title: "One chain. One asset. A focused scope.",
        blocks: [
          {
            kind: "table",
            headings: ["The current scope", "What it means"],
            rows: [
              [
                "Native ETH",
                "Testnet ETH deposits and withdrawals. No token pools.",
              ],
              [
                "Robinhood Chain Testnet",
                "Chain ID 46630. Deposit and withdrawal happen on the same chain.",
              ],
              [
                "Private and partial withdrawals",
                "Withdraw a full note or keep the remainder as a change note.",
              ],
              [
                "Recovery and public exit",
                "Restore notes from a seed backup, or publicly exit an unspent note with its proof and original depositor wallet.",
              ],
            ],
          },
          text(
            "This release does not include mainnet, ERC-20 pools, shielded transfers, payment links or bridging. It is not independently audited. The trusted setup is a local development setup."
          ),
        ],
      },
    ],
  },
  {
    slug: "manifesto",
    group: "Start here",
    title: "The Hylsia manifesto",
    readTime: 3,
    description:
      "Privacy should be understandable, recoverable, and honest about its limits.",
    sections: [
      {
        id: "a-private-connection",
        title: "A public ledger should leave room for privacy",
        blocks: [
          {
            kind: "quote",
            text: "You should be able to prove that a withdrawal is valid without publishing which deposit it came from.",
            caption: "The principle behind Hylsia",
          },
          text(
            "A transparent ledger makes it possible to verify transactions together. It also makes financial relationships unusually easy to trace. Hylsia explores a narrower disclosure: prove ownership, value conservation and membership in an association set, while keeping the deposit-to-withdrawal connection out of the proof."
          ),
        ],
      },
      {
        id: "our-principles",
        title: "The principles we build around",
        blocks: [
          {
            kind: "list",
            items: [
              {
                title: "Keep secrets with their owner",
                text: "Create proofs on the device. Keep the seed, note secrets and witness out of service requests. Encrypt the vault, activity log and reservations at rest.",
              },
              {
                title: "Make trust visible",
                text: "Explain who controls screening and publishing, what a relayer can observe, and how metadata can support inference. A proof does not make the surrounding system invisible.",
              },
              {
                title: "Keep an independent exit",
                text: "The public exit does not require ASP approval or a relayer. It still requires an unspent note, its proof, the original depositor wallet and gas. Known implementation issues must be disclosed when they break these assumptions.",
              },
              {
                title: "Treat recovery as part of ownership",
                text: "A verified backup should let the owner reconstruct notes and change from public chain data. Wallet access alone is not a backup for note secrets.",
              },
              {
                title: "Earn claims with evidence",
                text: "A deployed contract is not a completed user journey. Local tests are not an audit. A privacy estimate is not a guarantee or a count of independent people.",
              },
            ],
          },
        ],
      },
      {
        id: "an-experiment-with-boundaries",
        title: "An experiment with boundaries",
        blocks: [
          text(
            "Today, Hylsia is a testnet experiment. The development trusted setup, open release blocker and unfinished public validation are part of its documentation, not details to hide behind a polished interface."
          ),
          text(
            "Screening v1 is an operator-managed policy and exclusion list. It is not a certification of funds, universal detection system or legal clearance. We document both its intended behavior and the old-root window that limits removal at the contract level."
          ),
          note(
            "A principle is not a security guarantee",
            "These are design commitments. The actual implementation and its known limits are described in Security & status. Use testnet ETH only; do not use real funds."
          ),
        ],
      },
    ],
  },
  {
    slug: "deposit",
    group: "Using the pool",
    title: "Make a deposit",
    readTime: 4,
    description:
      "Create a vault, verify its backup, and understand when a deposit can leave privately.",
    sections: [
      {
        id: "before-you-begin",
        title: "Before you begin",
        blocks: [
          note(
            "For controlled testnet testing",
            "Public deposit-to-withdrawal validation remains open. Use one depositing browser profile per backup, close old-build tabs, and never make concurrent deposits from the same backup on separate devices. The cross-profile reuse issue is a release blocker.",
            true
          ),
          text(
            "You need testnet ETH and gas on Robinhood Chain Testnet, plus an EVM wallet. The app currently lists MetaMask and Rabby; actual wallet flows still require live validation. There is no mainnet pool in this release."
          ),
        ],
      },
      {
        id: "deposit-steps",
        title: "The deposit flow",
        blocks: [
          {
            kind: "cards",
            items: [
              {
                title: "Open My vault",
                text: "The website's Deposit and Withdraw tabs, followed by Notes, Activity and Backup & recovery in the same column.",
                href: "/pools/vault",
                icon: "key",
              },
            ],
          },
          {
            kind: "steps",
            items: [
              {
                title: "Create or unlock your vault",
                text: "Open My vault, choose Create vault or Unlock, and use a vault password separate from your wallet password. The vault stores an encrypted seed that derives your note secrets.",
              },
              {
                title: "Export and verify the backup",
                text: "In the Deposit tab, choose Export backup and re-import the file to verify it before depositing. Backup & recovery (Backup on compact screens) holds the recovery controls. Your wallet cannot recreate a lost seed.",
              },
              {
                title: "Choose an amount and the correct network",
                text: "Enter an amount in Deposit. The normal build offers Robinhood Chain Testnet only, so there is no network selector; your wallet still needs chain 46630. Standard amounts can improve the app's estimate, but do not guarantee privacy.",
              },
              {
                title: "Confirm in your wallet",
                text: "The wallet sends the deposit and pays gas. Keep the tab available until the result is known, and check the receipt if the response is interrupted.",
              },
              {
                title: "Wait for eligibility and inclusion",
                text: "A confirmed deposit becomes eligible after the policy delay. Private withdrawal becomes available only after a published root includes its deposit label and the app verifies that root.",
              },
            ],
          },
        ],
      },
      {
        id: "eligibility-is-not-inclusion",
        title: "One hour is eligibility, not a guarantee",
        blocks: [
          text(
            "Screening v1 uses a default delay of one hour from the deposit's block time, with the required confirmation count. Eligibility is followed by a wait for the next root that actually includes the deposit."
          ),
          text(
            "With an active, funded and healthy publisher on the default ten-minute schedule, the usual estimate is about one hour to one hour ten minutes. An outage, exclusion, missing funds or RPC problem can make it longer. Check the note's actual inclusion state rather than relying on a timer."
          ),
        ],
      },
      {
        id: "interrupted-deposits",
        title: "If the wallet or tab is interrupted",
        blocks: [
          text(
            "A missing wallet response does not prove that a transaction was never sent. Do not immediately repeat the deposit from another profile. Inspect the wallet's pending transactions and receipts, then sync the original vault."
          ),
          text(
            "The app keeps encrypted index reservations so an unresolved request does not hand its note index to another tab. Deposits require persistent storage and browser Web Locks over HTTPS, or a secure localhost context. Too many unresolved indexes can pause further deposits until chain discovery catches up."
          ),
        ],
      },
    ],
  },
  {
    slug: "withdraw",
    group: "Using the pool",
    title: "Withdraw privately",
    readTime: 4,
    description:
      "Spend an included note, choose how to pay gas, and keep track of the change.",
    sections: [
      {
        id: "what-the-proof-does",
        title: "What the proof does",
        blocks: [
          text(
            "A private withdrawal proves knowledge of an unspent note in the state tree and membership of the same original deposit label in the association set. The app builds the proof locally. Recipient, relayer, fee, deadline and pool scope are bound to the request."
          ),
          text(
            "Use a fresh receiving address. Reusing a depositing address, a connected wallet or a visible gas payer can link the withdrawal even when the proof itself does not identify the deposit."
          ),
        ],
      },
      {
        id: "withdrawal-steps",
        title: "The withdrawal flow",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Select an unspent, included note",
                text: "Open My vault and choose Withdraw, then select an unspent note. The app checks the newest published root and holds back notes that are waiting, excluded or announced for removal.",
              },
              {
                title: "Review amount, recipient and the privacy estimate",
                text: "The amount is the total leaving the pool, including the relayer fee. The Strong label is an estimate from the app's model, not a guarantee.",
              },
              {
                title: "Choose the relayer or pay your own gas",
                text: "Choose Via relayer (recommended) or Pay your own gas (from my wallet). Select another relayer in Connection settings, not in the network menu. The choice stays fixed for the operation; self-paid gas reveals the submitting wallet.",
              },
              {
                title: "Generate the proof on this device",
                text: "Proving files are downloaded and checked against the deployment's manifest. If a quote expires while proving, review a fresh quote and try again; the app does not silently raise your fee.",
              },
              {
                title: "Check the receipt and resync",
                text: "Verify the recipient payout, spent status and remaining note balance. A timeout is an unknown outcome until the chain confirms what happened.",
              },
            ],
          },
        ],
      },
      {
        id: "partial-withdrawals",
        title: "Partial withdrawals and change",
        blocks: [
          {
            kind: "table",
            headings: ["Example", "Value"],
            rows: [
              ["Input note", "1.000 ETH"],
              ["Amount withdrawn from the pool", "0.400 ETH"],
              ["Illustrative relayer fee", "0.002 ETH (0.5% of the amount)"],
              ["Recipient receives", "0.398 ETH"],
              ["Change note remains", "0.600 ETH"],
            ],
          },
          text(
            "The 0.5% fee above is illustrative, not a promise about the selected relayer. The website calculates the current fee as the greater of its percentage fee and minimum fee, and refuses an increase beyond the amount you approved."
          ),
          text(
            "The old note is spent. The remaining value becomes a new commitment with fresh derived secrets and the same original deposit label. Its screening status and original depositor rights follow that label. Your seed backup can reconstruct the change note from the chain."
          ),
        ],
      },
      {
        id: "pending-or-refused",
        title: "Pending, expired or refused",
        blocks: [
          text(
            "If a root leaves the accepted history while a proof is being prepared, make a new proof against a current verified root. Do not assume the proof you already made is still usable."
          ),
          note(
            "Do not resend blindly",
            "A relayer response can be lost after broadcast. Check the receipt, note nullifier and chain events first. The relayer serializes sends and remembers duplicate submissions within one process, but that memory is not a durable restart journal."
          ),
        ],
      },
    ],
  },
  {
    slug: "recovery",
    group: "Using the pool",
    title: "Backup & recovery",
    readTime: 4,
    description:
      "Your seed restores the notes. Your wallet and your local activity history are separate things.",
    sections: [
      {
        id: "what-you-are-backing-up",
        title: "What the backup contains",
        blocks: [
          text(
            "The backup file contains an encrypted 32-byte seed. With the vault password, that seed derives the note secrets used by the vault. It does not contain your wallet private key."
          ),
          {
            kind: "table",
            headings: [
              "Recovered from the backup and chain",
              "Not automatically included",
            ],
            rows: [
              [
                "Notes derived from the seed",
                "The original depositing wallet's keys",
              ],
              [
                "Spent status and recoverable balance",
                "The complete local activity log",
              ],
              [
                "Change notes after partial withdrawals",
                "A wallet request whose chain outcome is still unknown",
              ],
            ],
          },
          note(
            "Both the file and its password matter",
            "Wallet access does not replace the vault seed. Keep the verified backup and its password accessible to you, without placing decrypted secrets in screenshots, browser logs or support requests.",
            true
          ),
        ],
      },
      {
        id: "restore-a-vault",
        title: "Restore on another profile",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Settle outstanding wallet requests first",
                text: "Check pending deposits and transaction receipts in the original profile. A closed tab or timeout does not cancel an already submitted transaction.",
              },
              {
                title: "Import the verified backup",
                text: "Open My vault in a fresh profile, use Restore from a backup, select the file and enter its vault password, then choose Restore. On a device with an existing locked vault the form says Restore a different backup and replaces that vault. Avoid concurrent same-backup deposits.",
              },
              {
                title: "Allow a complete chain sync",
                text: "The app reconstructs deposits, spends and change notes. A checkpoint snapshot is verified against the chain; a failed or unavailable checkpoint falls back to full history.",
              },
              {
                title: "Check the recovered value",
                text: "After a partial withdrawal, the original note should be spent and a change note should hold the remainder. Compare the balance and transactions before taking another action.",
              },
            ],
          },
        ],
      },
      {
        id: "lock-and-forget",
        title: "Lock, Forget and local history",
        blocks: [
          text(
            "Lock removes the unlocked vault's keys and decrypted activity from the app's active session. If an operation is running, the app defers the lock until its required final writes finish. Forget removes this device's vault, activity log and reservations; it does not cancel a wallet transaction or erase chain history."
          ),
          text(
            "Activity and reservations are encrypted at rest with a key derived from the seed. That does not protect them from someone using an already unlocked vault. An unreadable activity envelope is handled separately rather than converted into plaintext; another vault's unreadable reservations are not overwritten."
          ),
        ],
      },
    ],
  },
  {
    slug: "ragequit",
    group: "Using the pool",
    title: "Ragequit: the public exit",
    readTime: 3,
    description:
      "An exit independent of screening approval, with an explicit privacy tradeoff.",
    sections: [
      {
        id: "requirements",
        title: "What you need",
        blocks: [
          text(
            "Ragequit returns an unspent note's value to the original depositor address without an association-set proof or relayer. It remains available after windDown, which stops new deposits. A stopped publisher or an excluded label does not, by itself, block this path."
          ),
          {
            kind: "list",
            items: [
              {
                title: "An unspent note and matching proof",
                text: "You need the note secrets recovered from the vault seed. A note already consumed by a full or partial withdrawal cannot be exited again.",
              },
              {
                title: "The original depositor wallet",
                text: "The caller must control the wallet that deposited under the note's original label. A new receiving wallet cannot claim that right.",
              },
              {
                title: "Testnet ETH for gas",
                text: "The depositor submits the public-exit transaction and pays gas. A relayer is not used for this path.",
              },
            ],
          },
        ],
      },
      {
        id: "exit-the-change",
        title: "After a partial withdrawal, exit the change",
        blocks: [
          text(
            "Open My vault, select the Notes tab, and choose Ragequit on the unspent note. Review the Exit without the association set dialog before confirming. My notes is the portfolio/history view; the exit action is in the vault Notes tab."
          ),
          text(
            "If you withdrew part of a deposit, its original note is already spent. Recover and select the unspent change note to exit the remaining value. If you withdrew the full value, there is no remaining balance to ragequit."
          ),
          note(
            "Public exit reveals the connection",
            "Ragequit exposes the note's original deposit label. When the note is change from a partial withdrawal, this disclosure can connect that earlier private withdrawal with its original deposit.",
            true
          ),
        ],
      },
      {
        id: "known-exception",
        title: "The known reuse exception",
        blocks: [
          text(
            `${DUPLICATE_NOTE_RISK} A valid ownership proof for a duplicate cannot bypass the spent-nullifier check. This is why concurrent same-backup deposits across profiles or devices are a release blocker.`
          ),
        ],
      },
    ],
  },
  {
    slug: "screening",
    group: "Understanding privacy",
    title: "Screening & root inclusion",
    readTime: 4,
    description:
      "Eligibility, inclusion and exclusion are different states. The contract's history matters too.",
    sections: [
      {
        id: "policy-v1",
        title: "An operator-managed association set",
        blocks: [
          text(
            "The association set is the list of deposit labels accepted for private withdrawals. Screening v1 uses public chain data, a waiting period and the operator's exclusion list. It does not certify a deposit or guarantee that unwanted activity will be detected."
          ),
          text(
            "The publisher posts the set's root with a public recipe. The app reconstructs and checks that recipe using public events. Private-flow requests do not explicitly identify the note being screened, but visitor metadata, exclusions and retry behavior can still support inference."
          ),
        ],
      },
      {
        id: "the-inclusion-timeline",
        title: "The inclusion timeline",
        blocks: [
          {
            kind: "steps",
            items: [
              {
                title: "Confirmed deposit",
                text: "The deposit is visible on-chain, with its block time and label.",
              },
              {
                title: "Eligible after the delay",
                text: "The default testnet delay is one hour from block time, with the configured confirmations. An excluded deposit is not admitted merely because time passed.",
              },
              {
                title: "Included in a published root",
                text: "The publisher must be active, funded and healthy. On the default ten-minute schedule, the usual one-hour-to-one-hour-ten-minute estimate is conditional, not a deadline guarantee.",
              },
              {
                title: "Verified by the app",
                text: "The app checks the root and note membership before starting private withdrawal. Eligibility alone is not enough.",
              },
            ],
          },
        ],
      },
      {
        id: "three-removal-states",
        title: "Three different meanings of removal",
        blocks: [
          {
            kind: "table",
            headings: ["State", "What it establishes"],
            rows: [
              [
                "Removed from the newest root",
                "The newest association set does not contain the deposit label.",
              ],
              [
                "Refused by the app or relayer",
                "Hylsia's app holds the note back; its relayer refuses older offending roots. Announced removal can hold the app even before the new root is mined.",
              ],
              [
                "Evicted from every accepted root",
                "The contract no longer accepts any old root that still contains the label.",
              ],
            ],
          },
          text(
            "The contract accepts its last 16 ASP roots. After a removal root, the most recent old root containing that label can remain accepted through 14 additional posts and is evicted after the 15th. Duplicate root copies occupy history slots too. Natural turnover can be slow or absent in a quiet pool."
          ),
          note(
            "Eviction is an operator action",
            "A manual eviction burst exists, but it is opt-in. Heartbeats and automatic bursts are not enabled. Removing a label from the latest root is not a claim that every old proof is already rejected by the contract."
          ),
          {
            kind: "cards",
            items: [
              {
                title: "Read the screening policy",
                text: "Open the app's policy page and its current public screening information.",
                href: "/pools/screening",
                icon: "book",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "privacy",
    group: "Understanding privacy",
    title: "Privacy & trust",
    readTime: 4,
    description:
      "What is hidden by the proof, what stays public, and which parties you rely on.",
    sections: [
      {
        id: "visible-and-private",
        title: "What an observer can see",
        blocks: [
          {
            kind: "table",
            headings: ["Information", "Visibility"],
            rows: [
              ["Deposit address, amount and time", "Public on the chain."],
              [
                "Withdrawal recipient, amount and relayer fee",
                "Public on the chain.",
              ],
              [
                "The original note spent by a private withdrawal",
                "Not explicitly identified by the proof. Correlation and inference remain possible.",
              ],
              [
                "Seed, note secrets and witness",
                "Used locally for proof generation; not sent explicitly to services by the app.",
              ],
              [
                "A ragequit's original deposit label",
                "Public; can also connect earlier partial withdrawals.",
              ],
              [
                "IP, RPC access and retry behavior",
                "Visible to the services involved; can narrow the plausible set.",
              ],
            ],
          },
        ],
      },
      {
        id: "estimates-not-guarantees",
        title: "A model, not a guarantee",
        blocks: [
          text(
            "The app's privacy check combines public amounts, timing and plausible deposits. Labels such as Strong describe that model's estimate. A count of deposits is not a count of independent people: several deposits can belong to one participant."
          ),
          text(
            "A fresh address does not undo a distinctive amount or immediate withdrawal. Paying your own gas exposes the gas payer. Exclusions, targeted status answers, off-chain data and a user's response to them can also reduce privacy."
          ),
        ],
      },
      {
        id: "trust-boundaries",
        title: "The trust boundaries",
        blocks: [
          {
            kind: "list",
            items: [
              {
                title: "Owner and publisher",
                text: "The owner controls administrative parameters and can stop new deposits. The publisher controls association roots. Neither role is designed to redirect a proof-authorized payout. Screening still affects private-path access.",
              },
              {
                title: "Relayer",
                text: "It sees the submitted proof and public withdrawal parameters, along with request metadata. It can delay or refuse a request; payout terms are bound to the proof.",
              },
              {
                title: "RPC and website",
                text: "The RPC supplies public events and chain state. The website serves the application and proving files. Manifest integrity checks do not replace trusting the application code you load.",
              },
              {
                title: "Trusted setup",
                text: "The active setup is local development, not a public multi-party ceremony. The filename of a powers-of-tau file is not proof of public provenance.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "security",
    group: "Project",
    title: "Security & status",
    readTime: 4,
    description:
      "A dated record of evidence. Local verification is distinct from a public testnet release.",
    sections: [
      {
        id: "release-status",
        title: "The release is blocked",
        blocks: [
          note(
            "High severity · duplicate note derivation",
            `Concurrent deposits from the same backup across browser profiles or devices can reuse note derivation. ${DUPLICATE_NOTE_RISK} This behavior was reproduced with real proofs. Same-origin tab coordination is fixed; cross-profile coordination is not.`,
            true
          ),
          text(
            "Close older-build tabs and use one depositing profile per backup for controlled testing. That is a mitigation, not a complete fix or approval for public use. Testnet status does not make the issue irrelevant."
          ),
        ],
      },
      {
        id: "what-live-means",
        title: "What the website means by “live”",
        blocks: [
          text(
            `The landing's Live label identifies a configured pool. The Pool status row separately shows whether its public state can currently be read. ${PUBLIC_VALIDATION_STATUS} It does not establish publisher or relayer funding, an independent audit, or a completed public release. Check the service availability shown in My vault and the dated release evidence separately.`
          ),
        ],
      },
      {
        id: "verified-locally",
        title: "What was verified locally",
        blocks: [
          text(
            `The following results describe the review recorded on ${DOCS_REVIEW_DATE}. They are the Phase 6 security-review baseline; later documentation and UI checks may add tests. These figures are historical evidence, not a live health check or an independent audit.`
          ),
          {
            kind: "table",
            headings: ["Check", "Recorded result"],
            rows: [
              ["Application unit tests", "516 passing tests in 24 files."],
              [
                "Contract regression",
                "40 passing tests with real proof fixtures.",
              ],
              [
                "Stateful invariant stress",
                "256 runs, 128,000 calls; a valid partial spend succeeds in every run.",
              ],
              [
                "Two-network end-to-end",
                "Passed in 78 seconds on two loopback Anvil chains.",
              ],
              [
                "Circuit checks",
                "11 invalid witnesses and 6 public-input mutations rejected; valid boundary proof accepted.",
              ],
              [
                "Static analysis",
                "Slither and circomspect run; findings triaged. Not an independent audit.",
              ],
              [
                "Deployment freeze",
                "37 file hashes unchanged, including active proving keys, circuits, verifiers and records.",
              ],
            ],
          },
        ],
      },
      {
        id: "not-yet-validated",
        title: "What remains open",
        blocks: [
          {
            kind: "list",
            items: [
              {
                title: "Fix the High severity issue",
                text: "A design that prevents same-backup index reuse across profiles/devices needs implementation and new regression evidence before the release blocker can close.",
              },
              {
                title: "Verify public deployment and hosting",
                text: "Explorer verification commands and Docker configuration are prepared. Source publication, hosted deployment and container runtime validation remain open.",
              },
              {
                title: "Run the real wallet journeys",
                text: "Prove deposit → inclusion → full relayed withdrawal, and a separate deposit → partial withdrawal → restore → ragequit of the unspent change. Record actual receipts and balances.",
              },
              {
                title: "Validate browser, mobile and service interruptions",
                text: "Measure proof performance on targeted devices and test actual wallet signatures, CSP/WASM, RPC faults, pending transactions and publisher/relayer recovery.",
              },
            ],
          },
        ],
      },
      {
        id: "known-design-limits",
        title: "Other design limits",
        blocks: [
          text(
            "A depth-20 state tree has 1,048,576 leaf positions shared by deposits and withdrawals. The current contract inserts a change commitment even for a full withdrawal. At capacity, private withdrawals stop; ragequit does not need another tree slot, subject to its normal note, proof and depositor requirements."
          ),
          text(
            "The last 16 ASP roots remain accepted by the contract until overwritten. A relayer queue coordinates within one process and does not survive a restart as a durable transaction journal. No claim of production readiness follows from the local tests."
          ),
        ],
      },
    ],
  },
  {
    slug: "deployment",
    group: "Project",
    title: "Network & deployment",
    readTime: 3,
    description:
      "The existing testnet pool and its deployed proof verifiers, read from the repository records.",
    sections: [
      {
        id: "network",
        title: "Built for Robinhood Chain Testnet",
        blocks: [
          {
            kind: "table",
            headings: ["Network detail", "Value"],
            rows: [
              ["Network", ROBINHOOD_NETWORK.name],
              ["Chain ID", String(ROBINHOOD_NETWORK.chainId)],
              ["Asset", "Native testnet ETH"],
              ["Default RPC", ROBINHOOD_NETWORK.defaultRpcUrl],
              ["Deployment record", "contracts/deployments/46630.json"],
            ],
          },
          text(
            "These are the existing deployment records, not a new deployment or a live report of service funding. A deployed pool alone does not establish that the publisher, relayer or complete public user flow is working."
          ),
        ],
      },
      {
        id: "mainnet-preparation",
        title: "Robinhood Chain mainnet migration",
        blocks: [
          {
            kind: "table",
            headings: ["Mainnet detail", "Value"],
            rows: [
              ["Network", networkById(4663)!.name],
              ["Chain ID", "4663"],
              ["Asset", "Native ETH"],
              ["Default RPC", networkById(4663)!.defaultRpcUrl],
              ["Pool", "Not deployed"],
              ["Status", "Preparation only; mainnet operations are blocked"],
            ],
          },
          note(
            "Mainnet is not live",
            "The registry and wallet configuration support chain 4663, but the current protocol is not approved for real funds. H-01 remains reproducible, the proving keys use a development trusted setup, and production validation is incomplete. A token contract displayed on the landing page is not the privacy-pool address. Testnet notes cannot be spent on mainnet.",
            true
          ),
        ],
      },
      {
        id: "contracts",
        title: "Deployed contracts",
        blocks: [
          {
            kind: "table",
            headings: ["Contract", "Address"],
            rows: [
              ["PrivacyPool", deployment.pool],
              ["WithdrawVerifier", deployment.withdrawVerifier],
              ["CommitmentVerifier", deployment.commitmentVerifier],
              ...deployment.libraries!.map(library => [
                library.name,
                library.address,
              ]),
            ],
          },
          {
            kind: "cards",
            items: [
              {
                title: "View the pool on the explorer",
                text: "Inspect public transactions and bytecode on Robinhood Chain Testnet.",
                href: `${ROBINHOOD_NETWORK.explorer!.url}/address/${deployment.pool}`,
                icon: "pool",
              },
            ],
          },
        ],
      },
      {
        id: "deployment-provenance",
        title: "Deployment and setup provenance",
        blocks: [
          text(
            "The deployed source was recorded at commit 5328dd0. The security review compared the pool runtime after linked-library and immutable substitution, both verifier runtimes, and the deployed Poseidon libraries. Explorer source publication was prepared but not run."
          ),
          text(
            "The proving artifacts remain frozen to match the deployed verifiers. The powers-of-tau verification identifies a local contribution named hylsia-local, and the build used a local development phase-2 contribution. This is not a public ceremony or an audit."
          ),
          note(
            "Deployment does not mean public validation is complete",
            "Service funding, hosting, real wallet signatures, mobile performance and both live validation journeys still require evidence. Read Security & status for the release gate."
          ),
        ],
      },
    ],
  },
];

export const DOC_GROUPS = [...new Set(DOC_PAGES.map(page => page.group))];
export const docHref = (slug: string) =>
  slug === "introduction" ? "/docs" : `/docs/${slug}`;
export function docForPath(path: string): DocPage | undefined {
  const clean = path.replace(/\/+$/, "");
  if (clean === "/docs") return DOC_PAGES[0];
  return DOC_PAGES.find(page => clean === `/docs/${page.slug}`);
}
function blockText(block: DocBlock): string {
  if (block.kind === "flow")
    return "Deposit Prove Withdraw zero knowledge proof";
  if (block.kind === "table")
    return [...block.headings, ...block.rows.flat()].join(" ");
  if ("items" in block)
    return block.items.map(item => `${item.title} ${item.text}`).join(" ");
  return `${"title" in block ? block.title : ""} ${block.text}`;
}
export function searchDocs(
  query: string
): { page: DocPage; section?: DocSection; href: string; excerpt: string }[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length)
    return DOC_PAGES.slice(0, 6).map(page => ({
      page,
      href: docHref(page.slug),
      excerpt: page.description,
    }));
  return DOC_PAGES.flatMap(page => {
    const header = `${page.title} ${page.description}`.toLowerCase();
    if (words.every(word => header.includes(word)))
      return [{ page, href: docHref(page.slug), excerpt: page.description }];
    const section = page.sections.find(section =>
      words.every(word =>
        `${page.title} ${section.title} ${section.blocks.map(blockText).join(" ")}`
          .toLowerCase()
          .includes(word)
      )
    );
    return section
      ? [
          {
            page,
            section,
            href: `${docHref(page.slug)}#${section.id}`,
            excerpt: section.title,
          },
        ]
      : [];
  });
}
