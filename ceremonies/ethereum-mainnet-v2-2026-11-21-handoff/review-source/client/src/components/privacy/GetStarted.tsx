/**
 * The first-time path on the testnet, in four short steps, where a new visitor's vault has nothing to show yet (the
 * Notes tab before the first note; without a vault, on narrow screens, above the setup forms instead, which come
 * first there):
 *   1. get testnet ETH from the network's faucet;
 *   2. connect a wallet (a deposit asks it to add the network and switch to it);
 *   3. create a vault and verify its backup;
 *   4. deposit a standard amount, wait, then withdraw to a fresh address.
 * A step is ticked from what this tab already knows (a connected wallet, the vault, a note, and the wallet's balance
 * once the Deposit form has read it). It never starts a request itself: the balance comes from the Deposit form's own
 * query (same key), so a visitor without a vault sends no address anywhere because of this list.
 */
import { useId, type ReactNode } from "react";
import { useAccount, useBalance } from "wagmi";
import { Check, ExternalLink } from "@/components/icons";
import { usePrivacy } from "@/privacy/PrivacyProvider";
import type { NetworkInfo } from "@shared/privacy/networks";
import { INSET, TONE_TEXT } from "./ui";

const LINK =
  "inline-flex items-center gap-1 whitespace-nowrap rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

interface Step {
  title: string;
  body: ReactNode;
  done: boolean;
}

export default function GetStarted({
  network,
  chainId,
  className = "",
}: {
  network: NetworkInfo;
  /** the active pool's chain */
  chainId: number;
  /** placement only (Vault.tsx shows the list before the setup forms on narrow screens, NotesPanel on wide ones) */
  className?: string;
}) {
  const titleId = useId();
  const { vault, notes } = usePrivacy();
  const { address, isConnected } = useAccount();
  // the Deposit form's own balance query (same key), read from the cache only: this list never fetches it
  const { data: bal } = useBalance({ address, chainId, query: { enabled: false } });
  const name = network.name;
  const faucet = network.faucet;

  const steps: Step[] = [
    {
      title: "Get testnet ETH",
      body: faucet ? (
        <>
          Free, from the{" "}
          <a href={faucet.url} target="_blank" rel="noopener noreferrer" className={LINK}>
            {name} faucet
            <ExternalLink className="h-2.5 w-2.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          . Testnet ETH only: never send real funds.
        </>
      ) : (
        "Testnet ETH only: never send real funds."
      ),
      done: !!bal && bal.value > 0n,
    },
    {
      title: "Connect your wallet",
      body: `Connect Wallet, at the top right (MetaMask works; on a phone, open this page in the MetaMask app's browser). Your first deposit asks the wallet to add ${name} and switch to it.`,
      done: isConnected,
    },
    {
      title: "Create your vault and verify its backup",
      body: "With the vault form on this page. The backup file and your vault password are the only way back to your notes.",
      done: vault.status !== "none" && vault.backupVerified,
    },
    {
      title: "Deposit, wait, then withdraw",
      body: "Pick one of the standard amounts (the form shows how many others used each). Wait for more deposits, then withdraw to a fresh address: the privacy check says how long.",
      done: notes.list.length > 0,
    },
  ];

  return (
    <section aria-labelledby={titleId} className={`${INSET} p-4 ${className}`}>
      <h3 id={titleId} className="text-sm font-semibold text-foreground">
        Get started on {name}
      </h3>
      <ol className="mt-3 space-y-3">
        {steps.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3">
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold ${
                s.done ? `bg-profit/15 ${TONE_TEXT.profit}` : "bg-primary/15 text-primary"
              }`}
            >
              {s.done ? <Check className="h-3 w-3" aria-hidden /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-medium leading-6 text-foreground">
                {s.title}
                {s.done && <span className="sr-only"> (done)</span>}
              </span>
              <span className="block text-xs leading-relaxed text-muted-foreground">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
