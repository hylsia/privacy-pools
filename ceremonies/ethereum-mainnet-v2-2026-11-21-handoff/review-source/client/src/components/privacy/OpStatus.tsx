import { CheckCircle2, ExternalLink, Loader2, XCircle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { usePrivacy, type OpStage } from "@/privacy/PrivacyProvider";
import { explorerTxUrl } from "@/privacy/config";
import { networkById } from "@shared/privacy/networks";
import { useActivePool } from "./PrivacyCheck";
import { INSET, QUIET_HOVER, TONE_TEXT } from "./ui";

const STAGES: { key: OpStage[]; label: string }[] = [
  { key: ["preparing"], label: "Prepare" },
  { key: ["downloading", "proving"], label: "Prove locally" },
  { key: ["awaiting_wallet", "submitting"], label: "Submit" },
  { key: ["pending"], label: "Confirm" },
];

const KIND_WORD = { deposit: "Deposit", withdraw: "Withdrawal", ragequit: "Ragequit (public exit)" } as const;

/**
 * Live status of the current deposit / withdraw / ragequit operation. It names the operation's own network (captured
 * when it started) and links that network's explorer, whatever the vault shows while it runs.
 */
export default function OpStatus({ kind }: { kind: "deposit" | "withdraw" | "ragequit" }) {
  const { op, resetOp } = usePrivacy();
  const active = useActivePool();
  if (op.kind !== kind || op.stage === "idle") return null;

  const done = op.stage === "confirmed";
  const failed = op.stage === "failed";
  const activeIdx = STAGES.findIndex((s) => s.key.includes(op.stage));
  // the operation's chain (set on every step); an operation that does not name one runs on the active pool
  const chainId = op.chainId ?? active?.chainId;
  const network = chainId !== undefined ? networkById(chainId) : null;
  const link = op.txHash && chainId !== undefined ? explorerTxUrl(chainId, op.txHash) : null;

  return (
    <div className={`${INSET} p-3 text-sm`} aria-live="polite">
      {network && (
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {KIND_WORD[kind]} on {network.name}
        </p>
      )}
      <ol className="mb-2.5 flex flex-wrap items-center gap-1.5 text-xs font-medium">
        {STAGES.map((s, i) => {
          const state = done || (activeIdx > i && !failed) ? "done" : activeIdx === i && !failed ? "active" : "todo";
          return (
            <li
              key={s.label}
              className={`rounded-md px-2 py-1 ${
                state === "done" ? `bg-profit/15 ${TONE_TEXT.profit}` : state === "active" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
              }`}
            >
              {i + 1}. {s.label}
            </li>
          );
        })}
      </ol>
      <div className="flex items-start gap-2">
        {done ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-profit" aria-hidden="true" />
        ) : failed ? (
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        ) : (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p className={`break-words ${failed ? TONE_TEXT.destructive : "text-foreground"}`}>{failed ? op.error : op.message}</p>
          {/* the crowd the association-set proof was made in, once it is built (the small-set question says it itself) */}
          {op.crowd !== undefined && !failed && op.stage !== "preparing" && (
            <p className="mt-1 text-xs text-muted-foreground">
              Association set: {op.crowd.toLocaleString("en-US")} {op.crowd === 1 ? "deposit" : "deposits"}
              {network ? ` in the ${network.name} pool` : ""}
              {op.announcedOut
                ? ` (not counting ${op.announcedOut.toLocaleString("en-US")} more that the root on-chain holds but the operator says it will exclude: this app would not withdraw them)`
                : ""}
              . The proof shows your deposit is one of them, not which one; amounts and timing can still narrow it.
            </p>
          )}
          {op.stage === "downloading" && op.progress && (
            <div className="mt-2">
              <Progress value={Math.min(100, (op.progress.loaded / Math.max(1, op.progress.total)) * 100)} />
              <p className="mt-1 text-xs text-muted-foreground">
                {op.progress.file} · {(op.progress.loaded / 1_048_576).toFixed(1)} / {(op.progress.total / 1_048_576).toFixed(1)} MB
              </p>
            </div>
          )}
          {op.stage === "proving" && (
            <p className="mt-1 text-xs text-muted-foreground">Your secrets never leave this device. Proving can take a few seconds depending on your hardware.</p>
          )}
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
              View transaction{network?.explorer ? ` on ${network.explorer.name}` : ""} <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </div>
        {(done || failed) && (
          <Button size="sm" variant="ghost" className={`rounded-full ${QUIET_HOVER}`} onClick={resetOp}>
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}
