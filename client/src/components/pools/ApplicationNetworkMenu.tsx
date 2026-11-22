import { useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { networkById } from "@shared/privacy/networks";
import { networkSwitchMessage } from "@/privacy/walletConnection";
import { Check, ChevronDown, Ethereum } from "@/components/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePrivacy } from "@/privacy/PrivacyProvider";
import { MAINNET_APPLICATION_ENABLED } from "@/privacy/applicationProfile";
import {
  applicationProfileHref,
  type ApplicationProfile,
} from "@shared/privacy/applicationProfiles";

const OPTIONS = [
  {
    profile: "robinhood-testnet",
    label: "Robinhood Chain Testnet",
    short: "Testnet",
    detail: "Testnet ETH · Chain 46630",
  },
  {
    profile: "ethereum-mainnet",
    label: "Ethereum Mainnet",
    short: "Mainnet",
    detail: "Native ETH · Chain 1",
  },
] as const;

/** A full navigation locks the current vault and initializes the other protocol's separate encrypted storage. */
export default function ApplicationNetworkMenu() {
  const { activePool, busy, lock } = usePrivacy();
  const account = useAccount();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!MAINNET_APPLICATION_ENABLED || (activePool && ![1, 46630].includes(activePool.chainId))) return null;
  const active =
    activePool?.chainId === 1 ? "ethereum-mainnet" : "robinhood-testnet";
  const selected = OPTIONS.find(option => option.profile === active)!;
  const target = networkById(active === "ethereum-mainnet" ? 1 : 46630)!;
  const select = (profile: ApplicationProfile) => {
    if (busy || switching || profile === active || !lock()) return;
    window.location.assign(applicationProfileHref("/pools", profile));
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={busy || switching}
          aria-label={`Application network: ${selected.label}`}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border/60 bg-card/50 px-2.5 text-xs font-medium text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait"
        >
          <Ethereum
            className="hidden h-3.5 w-3.5 text-primary min-[420px]:block"
            aria-hidden
          />
          <span>{selected.short}</span>
          <ChevronDown
            className="hidden h-2.5 w-2.5 min-[420px]:block"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 max-w-[calc(100vw-1.5rem)] rounded-xl p-2"
        aria-label="Choose application network"
      >
        <p className="px-2 py-2 text-xs font-semibold text-muted-foreground">
          Network
        </p>
        {OPTIONS.map(option => (
          <button
            key={option.profile}
            type="button"
            aria-pressed={active === option.profile}
            disabled={busy || switching}
            onClick={() => select(option.profile)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="block text-xs text-muted-foreground">
                {option.detail}
              </span>
            </span>
            {active === option.profile && (
              <Check className="h-4 w-4 text-primary" aria-hidden />
            )}
          </button>
        ))}
        {account.status === "connected" &&
          account.chainId !== target.chainId && (
            <Button
              type="button"
              className="mb-2 mt-3 w-full"
              disabled={busy || switching}
              onClick={async () => {
                if (!account.connector) return;
                setNotice(null);
                try {
                  await switchChainAsync({
                    chainId: target.chainId,
                    connector: account.connector,
                  });
                } catch (error) {
                  setNotice(networkSwitchMessage(error, target));
                }
              }}
            >
              {switching
                ? "Confirm the change in your wallet…"
                : `Switch wallet to ${target.name}`}
            </Button>
          )}
        {notice && (
          <p role="status" className="px-2 pb-2 text-xs text-muted-foreground">
            {notice}
          </p>
        )}
        <p className="border-t border-border/60 px-2 pb-1 pt-3 text-xs leading-relaxed text-muted-foreground">
          Switching locks your vault. Mainnet and testnet use separate vaults
          and backups. Wallet network changes need your confirmation.
        </p>
      </PopoverContent>
    </Popover>
  );
}
