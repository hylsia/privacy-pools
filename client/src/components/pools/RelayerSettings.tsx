import { useState } from "react";
import { Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRIVACY_POOLS } from "@/privacy/config";
import { addCustomRelayer, removeCustomRelayer, selectRelayer, validRelayerQuote, type RelayerEntry } from "@/privacy/relayers";
import { useQuotesOf, useRelayerList, useSelectedRelayer } from "@/privacy/useRelayer";

/** What one relayer offers for this build's pools: asked only while the settings are open (input-less). */
function RelayerStatus({ relayer }: { relayer: RelayerEntry }) {
  const q = useQuotesOf(relayer);
  if (q.isLoading) return <span className="text-muted-foreground">checking…</span>;
  if (q.isError || !q.data || !Array.isArray(q.data.quotes)) return <span className="text-red-700 dark:text-destructive">unreachable</span>;
  const mine = q.data.quotes.filter((x) => x && PRIVACY_POOLS.some((p) => p.chainId === x.chainId && p.pool.toLowerCase() === String(x.pool).toLowerCase()));
  const up = mine.filter(validRelayerQuote);
  if (mine.length === 0) return <span className="text-muted-foreground">serves none of these pools</span>;
  if (up.length === 0) return <span className="text-amber-700 dark:text-amber-400">unavailable now</span>;
  const fees = [...new Set(up.map((x) => `${x.feeBps / 100}%`))].join(" / ");
  return <span className="text-emerald-700 dark:text-emerald-400">online · fee {fees}</span>;
}

/**
 * Which relayer sends this browser's private withdrawals (relayers.ts). The list's statuses are asked only while this
 * section is open; a withdrawal talks to the chosen relayer alone.
 */
export default function RelayerSettings() {
  const list = useRelayerList();
  const chosen = useSelectedRelayer();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    try {
      addCustomRelayer(text);
      setText("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="space-y-3 border-t border-border/50 pt-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Relayer</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          A relayer sends your private withdrawal and pays its gas, so your wallet never appears. If one is down, pick another. Its fee is fixed in
          your proof before anything is sent, so it cannot take more.
        </p>
      </div>
      <div role="radiogroup" aria-label="Relayer" className="space-y-1.5">
        {list.map((r) => (
          <div
            key={r.id}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${r.id === chosen.id ? "border-primary/50 bg-primary/5" : "border-border/60"}`}
          >
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="hylsia-relayer"
                checked={r.id === chosen.id}
                onChange={() => selectRelayer(r.id)}
                className="h-4 w-4 accent-[var(--primary)]"
              />
              <span className="min-w-0">
                <span className="block truncate font-medium text-foreground">{r.label}</span>
                <span className="block text-xs">
                  <RelayerStatus relayer={r} />
                  {r.source === "custom" && <span className="text-muted-foreground"> · added by you</span>}
                </span>
              </span>
            </label>
            {r.source === "custom" && (
              <button
                type="button"
                onClick={() => removeCustomRelayer(r.origin!)}
                aria-label={`Remove ${r.label}`}
                className="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder="https://another-relayer.example"
          aria-label="Add a relayer"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
        />
        <Button type="button" variant="outline" className="shrink-0 rounded-lg" onClick={add} disabled={!text.trim()}>
          Add relayer
        </Button>
      </div>
      {error && (
        <p className="text-xs text-red-700 dark:text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
