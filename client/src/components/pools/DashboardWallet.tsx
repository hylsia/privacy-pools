import { useEffect, useRef, useState } from "react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Info,
  Loader2,
  LogOut,
  Wallet,
} from "@/components/icons";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { PRIVACY_NETWORKS } from "@/privacy/config";
import { MAINNET_APPLICATION_ENABLED } from "@/privacy/applicationProfile";
import { usePrivacy } from "@/privacy/PrivacyProvider";
import {
  networkSwitchMessage,
  walletConnectionState,
} from "@/privacy/walletConnection";
import { walletNetworkName } from "@/privacy/walletChain";
import { cn } from "@/lib/utils";

const CONTROL =
  "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-wait disabled:opacity-60";

/**
 * A network control and an independent wallet menu, including on unsupported wallet chains. Only the Switch button
 * talks to the wallet about a network change. Browsing, reconnecting, opening either menu and relayed withdrawals do
 * not switch it. No balance, ENS lookup, RPC probe or server request is made by this header.
 */
export default function DashboardWallet() {
  const account = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect, isPending: disconnecting } = useDisconnect();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const { activePool, busy } = usePrivacy();
  const target = activePool?.network ?? PRIVACY_NETWORKS[0].network;
  const applicationMenu = MAINNET_APPLICATION_ENABLED && [1, 46630].includes(target.chainId);
  const state = walletConnectionState({
    ...account,
    targetChainId: target.chainId,
  });
  const [networkOpen, setNetworkOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const request = useRef(0);
  const inFlight = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  useEffect(() => {
    request.current++;
    setNotice(null);
    setCopied(false);
    clearTimeout(copyTimer.current);
    if (!account.address || account.status !== "connected") {
      setNetworkOpen(false);
      setAccountOpen(false);
    }
  }, [
    account.address,
    account.connector?.uid,
    account.status,
    account.chainId,
    target.chainId,
  ]);
  useEffect(
    () => () => {
      request.current++;
      clearTimeout(copyTimer.current);
    },
    []
  );

  const changeNetwork = async () => {
    if (state !== "switch" || busy || inFlight.current || !account.connector)
      return;
    inFlight.current = true;
    const attempt = ++request.current;
    setNotice(null);
    try {
      await switchChainAsync({
        chainId: target.chainId,
        connector: account.connector,
      });
      // Ready is derived from the wallet's reported chain, never optimistically from the mutation's result.
    } catch (error) {
      if (attempt === request.current)
        setNotice(networkSwitchMessage(error, target));
    } finally {
      inFlight.current = false;
    }
  };

  if (state === "restoring" || state === "checking") {
    return (
      <button
        type="button"
        disabled
        aria-label="Checking wallet connection"
        className={cn(
          CONTROL,
          "w-9 border-border/60 bg-card/50 text-muted-foreground sm:w-auto"
        )}
      >
        <Loader2
          className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
        <span className="hidden sm:inline">Connecting…</span>
      </button>
    );
  }

  if (state === "disconnected") {
    return (
      <button
        type="button"
        onClick={openConnectModal}
        disabled={!openConnectModal}
        aria-label="Connect wallet"
        className={cn(
          CONTROL,
          "w-9 border-primary/30 bg-primary text-primary-foreground min-[420px]:w-auto"
        )}
      >
        <Wallet className="h-3.5 w-3.5" aria-hidden />
        <span className="hidden min-[420px]:inline">Connect wallet</span>
      </button>
    );
  }

  const mismatch = state === "switch";
  const address = account.address!;
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const currentNetwork =
    walletNetworkName(account.chainId) ?? "Unknown network";
  const networkLabel = switching
    ? "Check wallet"
    : mismatch
      ? "Switch network"
      : applicationMenu
        ? "Wallet ready"
        : target.chainId === 46630
        ? "Testnet · 46630"
        : target.name;

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Popover
        open={networkOpen}
        onOpenChange={open => {
          setNetworkOpen(open);
          if (open) setAccountOpen(false);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={
              mismatch
                ? `Wallet is on ${currentNetwork}. Switch to ${target.name}`
                : `Wallet network: ${target.name}`
            }
            title={
              mismatch
                ? `Switch ${account.connector?.name ?? "your wallet"} to ${target.name}`
                : target.name
            }
            className={cn(
              CONTROL,
              applicationMenu ? "hidden sm:inline-flex sm:w-9 xl:w-auto" : "w-9 xl:w-auto",
              mismatch
                ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                : "border-border/60 bg-card/50 text-muted-foreground hover:text-foreground"
            )}
          >
            {switching ? (
              <Loader2
                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : mismatch ? (
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <CheckCircle2
                className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
            )}
            <span className="hidden max-w-36 truncate xl:inline">
              {networkLabel}
            </span>
            <ChevronDown className="hidden h-2.5 w-2.5 xl:block" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={10}
          className="w-80 max-w-[calc(100vw-1.5rem)] rounded-xl p-4"
          aria-label="Wallet network"
        >
          <p className="text-sm font-semibold">
            {mismatch ? "Switch your wallet network" : "Wallet network ready"}
          </p>
          <dl className="mt-3 space-y-2 text-xs">
            <div className="flex items-start justify-between gap-4">
              <dt className="text-muted-foreground">Wallet</dt>
              <dd className="text-right">
                {account.connector?.name ?? "Connected wallet"}
                <span className="mt-0.5 block text-muted-foreground">
                  {currentNetwork}
                </span>
              </dd>
            </div>
            <div className="flex items-start justify-between gap-4">
              <dt className="text-muted-foreground">Pool</dt>
              <dd className="text-right">
                {target.name}
                <span className="mt-0.5 block font-mono text-muted-foreground">
                  Chain {target.chainId}
                </span>
              </dd>
            </div>
          </dl>
          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              {mismatch
                ? "You can keep browsing. Switch before depositing, using the public exit, or paying your own withdrawal gas."
                : "Deposits and wallet-paid exits use this network. Relayed withdrawals do not need a wallet transaction."}
            </span>
          </p>
          {mismatch && (
            <Button
              type="button"
              className="mt-4 h-auto min-h-9 w-full whitespace-normal rounded-lg py-2 text-center"
              disabled={switching || busy}
              onClick={() => void changeNetwork()}
            >
              {switching
                ? "Confirm the network change in your wallet…"
                : `Switch to ${target.name}`}
            </Button>
          )}
          {busy && mismatch && (
            <p className="mt-2 text-xs text-muted-foreground">
              Wait for the current operation to finish before changing networks.
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="mt-3 text-xs leading-relaxed text-amber-800 dark:text-amber-300"
            >
              {notice}
            </p>
          )}
        </PopoverContent>
      </Popover>

      <Popover
        open={accountOpen}
        onOpenChange={open => {
          setAccountOpen(open);
          if (open) setNetworkOpen(false);
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Wallet ${short}`}
            className={cn(
              CONTROL,
              "w-9 border-border/60 bg-card/50 text-foreground hover:bg-muted/50 sm:w-auto"
            )}
          >
            <Wallet className="h-3.5 w-3.5 text-primary" aria-hidden />
            <span className="hidden font-mono sm:inline">{short}</span>
            <ChevronDown className="hidden h-2.5 w-2.5 sm:block" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={10}
          className="w-80 max-w-[calc(100vw-1.5rem)] rounded-xl p-4"
          aria-label="Connected wallet"
        >
          <p className="text-sm font-semibold">
            {account.connector?.name ?? "Connected wallet"}
          </p>
          <p className="mt-2 break-all font-mono text-xs leading-relaxed text-muted-foreground">
            {address}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{currentNetwork}</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(address);
                  setCopied(true);
                  clearTimeout(copyTimer.current);
                  copyTimer.current = setTimeout(() => setCopied(false), 1800);
                } catch {
                  /* The address above remains selectable. */
                }
              }}
            >
              {copied ? (
                <Check className="h-3 w-3" aria-hidden />
              ) : (
                <Copy className="h-3 w-3" aria-hidden />
              )}
              {copied ? "Copied" : "Copy address"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg"
              disabled={busy || disconnecting || switching}
              onClick={() => disconnect({ connector: account.connector })}
            >
              <LogOut className="h-3 w-3" aria-hidden />
              Disconnect
            </Button>
          </div>
          <span className="sr-only" role="status">
            {copied ? "Wallet address copied" : ""}
          </span>
        </PopoverContent>
      </Popover>
    </div>
  );
}
