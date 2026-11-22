import { DUPLICATE_NOTE_RISK } from "@/privacy/safetyCopy";
import { IS_ETHEREUM_MAINNET } from "@/privacy/environmentCopy";
import { Link } from "wouter";
import { MULTI_NETWORK, PRIVACY_NETWORKS } from "@/privacy/config";
import { inclusionDelay } from "@/privacy/publicData";
import { namesList } from "@/components/pools/NetworkMenu";
import { formatDelay } from "@shared/privacy/screening";
import { useActivePool } from "./PrivacyCheck";
import { PolicyLink, useASPStatusOf } from "./Screening";

/** "Robinhood Chain Testnet" (or, in a build with several networks, every one of them). */
const BUILT_FOR = namesList(PRIVACY_NETWORKS.map(n => n.network.name));

/**
 * What the pool hides and what it does not. A build with one network (the normal build: Robinhood Chain Testnet)
 * names it; only a build with several networks has the rows about choosing between them.
 */
const VISIBILITY: [string, string][] = [
  ["Deposit address and amount", "Public, in the deposit transaction."],
  ["Withdrawal address and amount", "Public, in the withdrawal transaction."],
  ["Which deposit a withdrawal spends", "Not revealed by the proof. Statistical correlation (timing, amounts, quiet pools) remains possible."],
  ["The balance you keep (change notes)",
    "A partial withdrawal leaves a new commitment in the pool. A later ragequit reveals its original deposit and can link earlier partial withdrawals.",
  ],
  ["Commitments and nullifiers", "Public; their relation to each other is protected cryptographically."],
  ["Timing and transaction shape", "Observable on-chain."],
  ["Relayer fee and gas", "Visible in the transaction and its public parameters. If you pay your own gas, the gas payer is visible."],
  ...(MULTI_NETWORK
    ? ([
        [
          "Which network you use",
          "Each deposit, withdrawal and ragequit is public on its own network. The app loads every network's public pool data for every visitor alike; your wallet balance is read only on the network you selected, from that network's RPC node.",
        ],
        [
          "Moving funds between networks",
          "Not possible: each network has its own pool and there is no bridge. A deposit is withdrawn, or exited, on the network it was made on.",
        ],
      ] as [string, string][])
    : ([
        [
          "Your wallet balance",
          `Read only from the ${BUILT_FOR} RPC node, while a wallet is connected, to show what you can deposit. The pool's public data is loaded the same way for every visitor.`,
        ],
        [
          "Bridging",
          `Not part of Hylsia: deposits and withdrawals both happen on ${BUILT_FOR}. Moving ETH there from another chain, or away afterwards, is a separate public transaction.`,
        ],
      ] as [string, string][])),
  [
    "Your IP and access metadata",
    // every page loads its fonts from Google Fonts (client/index.html, index.css), which so sees the IP and this site too
    `Visible to ${MULTI_NETWORK ? "each network's RPC node" : `the ${BUILT_FOR} RPC node`}, to the relayer and association-set services you contact, and to Google Fonts, which serves this site's fonts.`,
  ],
  ["Note secrets and witnesses", "Stay on your device. Never sent to any service."],
  [
    "Your activity log",
    "Kept on this device, encrypted with a key from your vault: readable only while the vault is unlocked, and deleted when you forget the vault. Anyone using your unlocked vault can read it.",
  ],
  ["Payments between pool users", "Not part of this version."],
];

const TRUST: [string, string, string][] = [
  [
    "This app",
    "Wallet interaction, backup, proof generation (the association-set proof too, from public data), status",
    "Sees your secrets only in the unlocked session, in memory. Needs no sign-in or server session",
  ],
  ["Pool contract", "Holds ETH, verifies proofs, tracks nullifiers and roots", "Receives proofs and public inputs only"],
  [
    MULTI_NETWORK ? "Relayer (Hylsia server, one per network)" : "Relayer (Hylsia server)",
    "Submits your proof so the recipient pays no gas",
    MULTI_NETWORK
      ? "Sees the network, recipient, amount, fee and your IP; cannot change them"
      : "Sees the recipient, amount, fee and your IP; cannot change them",
  ],
  [
    MULTI_NETWORK ? "Association-set service (Hylsia server, one per network)" : "Association-set service (Hylsia server)",
    "Screens deposits and publishes the association-set root: which deposits may withdraw privately",
    `Is never told which deposit you spend: your app builds that proof itself, checks the published list against the chain, works out on your device whether your deposit is waiting or excluded, starts a private withdrawal only for a deposit the set on-chain already holds, and asks for a newer root only when the service's public status says one is due (without a fresh status: when the newest root does not hold every deposit your device sees), the same for every withdrawal, and only after its questions about the crowd, so nothing after that request depends on your deposit.${
      MULTI_NETWORK
        ? " When a withdrawal asks for a newer root, it asks for every network's pool at once, so that request does not say which network you withdraw on. A relayed withdrawal still tells the relayer its network, because the relayer sends it there."
        : ""
    } Its status answer could differ for each visitor: a deposit it announces for exclusion is held back and not counted in your crowd. Can delay deposits or exclude them (publicly, with a reason), which shrinks the crowd; the app asks before a withdrawal hides in a crowd that shrank sharply against one of the pool's last 16 different roots that check out on your device (it looks back over at most 64 different root values, so an operator that posts more of them first gets past this), or that holds fewer than 10 deposits. Cannot seize them: the public exit stays open to whoever controls the depositing address`,
  ],
  MULTI_NETWORK
    ? [
        "RPC nodes (one per network)",
        "Serve chain data; the app reads every network's public pool data for every visitor alike",
        "Each sees which addresses/events you query from it and your IP; your wallet balance is read only from the network you selected",
      ]
    : [
        "RPC node",
        `Serves ${BUILT_FOR} chain data; the app reads the pool's public data the same way for every visitor`,
        "Sees which addresses and events you query and your IP, including your wallet's address when the app reads its balance",
      ],
];

const TABLE_BOX = "mt-3 overflow-hidden rounded-lg border border-border/50";
const TH = "px-3 py-2.5 text-left text-[13px] font-medium text-muted-foreground first:pl-4 last:pr-4";
const TD = "px-3 py-2.5 align-top first:pl-4 last:pr-4";

/** The "Privacy & trust" tab: what the pool hides, who sees what, and the limits of the admin roles. */
export default function PrivacyNotice() {
  // the screening wait on the vault's network: the publisher's public status (the shell's copy), else the registry's
  const ref = useActivePool();
  const status = useASPStatusOf(ref);
  const delay = inclusionDelay(status.screening, ref?.chainId);
  if (IS_ETHEREUM_MAINNET) return (
    <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
      <h3 className="font-semibold text-foreground">Ethereum Mainnet privacy and trust</h3>
      <p>This native ETH pool uses separately finalized v2 proving keys from a single operator. It has not been independently audited. Source verification checks deployed bytecode; it is not an audit.</p>
      <p>The browser generates proofs locally. Your vault, backup and note derivation are separate from testnet; importing a testnet backup cannot move funds or notes here.</p>
      <p>The ASP publisher signs eligibility roots with its wallet. A deposit waits for confirmation, the inclusion delay and a published root before a private withdrawal. You can pay withdrawal gas yourself; that paying wallet is visible onchain.</p>
      <p>Deposits, amounts, timing and withdrawals remain public. Privacy depends on other eligible deposits and your usage. The original depositor can use the public exit without ASP approval, revealing the deposit label and any related change history.</p>
    </div>
  );
  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-sm font-semibold text-foreground">{MULTI_NETWORK ? "What each pool does and does not hide" : "What the pool does and does not hide"}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Built for {BUILT_FOR}. Testnet ETH only, not audited. Expectations the implementation is held to.
        </p>
        {/* a table on wide cards, stacked rows on narrow ones */}
        <dl className={`${TABLE_BOX} divide-y divide-border/40 @lg:hidden`}>
          {VISIBILITY.map(([k, v]) => (
            <div key={k} className="px-3 py-2.5">
              <dt className="text-sm font-medium text-foreground">{k}</dt>
              <dd className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
        <div className={`${TABLE_BOX} hidden @lg:block`}>
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-border/50 bg-muted/25">
              <tr>
                <th scope="col" className={TH}>Information</th>
                <th scope="col" className={TH}>Visibility</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {VISIBILITY.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row" className={`${TD} text-left font-medium text-foreground`}>
                    {k}
                  </th>
                  <td className={`${TD} text-muted-foreground`}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground">Who sees what</h3>
        {/* three columns need more room */}
        <div className={`${TABLE_BOX} hidden @2xl:block`}>
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-border/50 bg-muted/25">
              <tr>
                <th scope="col" className={TH}>Component</th>
                <th scope="col" className={TH}>Responsibility</th>
                <th scope="col" className={TH}>Access boundary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {TRUST.map(([a, b, c]) => (
                <tr key={a}>
                  <th scope="row" className={`${TD} whitespace-nowrap text-left font-medium text-foreground`}>
                    {a}
                  </th>
                  <td className={`${TD} text-muted-foreground`}>{b}</td>
                  <td className={`${TD} text-muted-foreground`}>{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className={`${TABLE_BOX} divide-y divide-border/40 @2xl:hidden`}>
          {TRUST.map(([a, b, c]) => (
            <li key={a} className="px-3 py-2.5 text-sm">
              <p className="font-medium text-foreground">{a}</p>
              <dl className="mt-1 grid gap-0.5 text-xs leading-relaxed">
                <div>
                  <dt className="inline text-foreground/70">Responsibility:{" "}
                  </dt>
                  <dd className="inline text-muted-foreground">{b}</dd>
                </div>
                <div>
                  <dt className="inline text-foreground/70">Access boundary:{" "}
                  </dt>
                  <dd className="inline text-muted-foreground">{c}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground">Administrative powers and limits</h3>
        <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
          <p>
            <strong className="text-foreground">{MULTI_NETWORK ? "Each pool's owner" : "The pool's owner"}</strong>{" "}
            can stop new deposits (wind-down), set the minimum deposit, choose who
            publishes the association-set root and transfer ownership. The owner cannot move funds, cannot pause withdrawals or ragequits and cannot
            upgrade the contracts.
          </p>
          <p>
            <strong className="text-foreground">Association-set publisher</strong>{" "}
            publishes the association-set root under the screening policy: a
            deposit becomes eligible{" "}
            {delay > 0 ? `${formatDelay(delay)} after it is made` : "once it is confirmed"}
            {MULTI_NETWORK && ref ? ` (on ${ref.network.name})` : ""} and joins with the next root, in order, unless it is on the operator&apos;s exclusion list; an excluded deposit
            leaves only by the public exit. The exclusions are public, with a reason for each. This is a technical rule, not a legal clearance. <PolicyLink />
          </p>
          <p>
            <strong className="text-foreground">Ragequit (public exit)</strong>{" "}
            does not require ASP approval or a relayer. It requires an unspent note, a matching proof,
            the original depositor wallet and gas. Exiting a change note reveals its original deposit label.
          </p>
          <p>
            <strong className="text-foreground">Open release blocker.</strong>{" "}
            {DUPLICATE_NOTE_RISK}{" "}<Link href="/docs/security" className="text-primary underline">Security &amp; status</Link>.
          </p>
          <p>
            <strong className="text-foreground">Not audited.</strong> The Groth16 setup used here is a single local development contribution. Use testnet ETH
            only.
          </p>
        </div>
      </section>
    </div>
  );
}
