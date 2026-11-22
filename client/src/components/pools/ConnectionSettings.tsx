import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircle2, Server, XCircle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MULTI_NETWORK, PRIVACY_NETWORKS, rpcUrlFor } from "@/privacy/config";
import { probeRpc, rpcOverride, setRpcOverride, subscribeRpcOverrides, validateRpcUrl } from "@/privacy/rpcOverride";
import RelayerSettings from "./RelayerSettings";

/** Re-render on any change of this browser's RPC settings (this tab or another). */
function useRpcOverride(chainId: number): string | null {
  return useSyncExternalStore(subscribeRpcOverrides, () => rpcOverride(chainId), () => null);
}

/** The host of a URL only: a path may hold an API key, so it is never shown in full. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "custom";
  }
}

type Check = { state: "idle" } | { state: "checking" } | { state: "ok"; ms: number } | { state: "error"; error: string };

function RpcRow({ chainId, name }: { chainId: number; name: string }) {
  const own = useRpcOverride(chainId);
  const [text, setText] = useState(own ?? "");
  const [check, setCheck] = useState<Check>({ state: "idle" });
  useEffect(() => setText(own ?? ""), [own]);

  const save = async () => {
    const v = validateRpcUrl(text);
    if (!v.ok) return setCheck({ state: "error", error: v.error });
    setCheck({ state: "checking" });
    // the RPC must answer from this browser, for this network, before it is used for anything
    const r = await probeRpc(v.url, chainId);
    if (!r.ok) return setCheck({ state: "error", error: r.error });
    setRpcOverride(chainId, v.url);
    setCheck({ state: "ok", ms: r.ms });
  };

  return (
    <div className="space-y-2">
      {MULTI_NETWORK && <p className="text-sm font-medium text-foreground">{name}</p>}
      <p className="text-xs text-muted-foreground">
        Now: <span className="font-mono text-foreground">{own ? `your RPC (${hostOf(own)})` : `the default (${hostOf(rpcUrlFor(chainId))})`}</span>
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setCheck({ state: "idle" });
          }}
          placeholder="https://your-rpc.example/…"
          aria-label={`Your RPC for ${name}`}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
        />
        <div className="flex shrink-0 gap-2">
          <Button type="button" onClick={() => void save()} disabled={check.state === "checking" || !text.trim()} className="rounded-lg">
            {check.state === "checking" ? "Checking…" : "Check and use"}
          </Button>
          {own && (
            <Button
              type="button"
              variant="outline"
              className="rounded-lg"
              onClick={() => {
                setRpcOverride(chainId, null);
                setCheck({ state: "idle" });
              }}
            >
              Use default
            </Button>
          )}
        </div>
      </div>
      {check.state === "ok" && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> In use. It answered for {name} in {check.ms} ms.
        </p>
      )}
      {check.state === "error" && (
        <p className="flex items-start gap-1.5 text-xs text-red-700 dark:text-destructive" role="alert">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {check.error} Nothing was changed.
        </p>
      )}
    </div>
  );
}

/**
 * Connection settings (Phase 5): which RPC this browser reads the chain through, and which relayer sends private
 * withdrawals. Both are kept in this browser only and never sent to the Hylsia server.
 */
export default function ConnectionSettings({ className = "" }: { className?: string }) {
  const own = useSyncExternalStore(
    subscribeRpcOverrides,
    () => PRIVACY_NETWORKS.some(({ network }) => rpcOverride(network.chainId) !== null),
    () => false,
  );
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Connection settings"
          title="Connection settings: RPC and relayer"
          className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card/50 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
        >
          <Server className="h-3.5 w-3.5" aria-hidden />
          {own && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connection settings</DialogTitle>
          <DialogDescription>
            Kept in this browser only. The Hylsia server never receives them.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">RPC</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Your vault reads the pool straight from the chain. Use your own RPC if the default is slow or down, or if you would rather not use a
              public one. Your wallet keeps its own RPC for what it sends.
            </p>
          </div>
          {PRIVACY_NETWORKS.filter(({ pool }) => pool !== null).map(({ network }) => (
            <RpcRow key={network.chainId} chainId={network.chainId} name={network.name} />
          ))}
        </section>

        <RelayerSettings />
      </DialogContent>
    </Dialog>
  );
}
