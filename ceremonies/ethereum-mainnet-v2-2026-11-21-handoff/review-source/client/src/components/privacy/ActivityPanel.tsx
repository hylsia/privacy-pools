import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, DoorOpen, ExternalLink, History, Lock, Trash2 } from "@/components/icons";
import { NetworkLabel } from "@/components/brand/NetworkMark";
import { Button } from "@/components/ui/button";
import { explorerTxUrl, MULTI_NETWORK, PRIVACY_NETWORKS } from "@/privacy/config";
import { formatEth, shortHex } from "@/privacy/format";
import { usePrivacy, type Activity } from "@/privacy/PrivacyProvider";
import { networkById } from "@shared/privacy/networks";
import { ACTIVITY_LOG_TEXT } from "./VaultPanel";
import { EmptyState, InfoNote, Pill, QUIET_HOVER, type PillTone } from "./ui";

const STATUS: Record<string, PillTone> = {
  pending: "warning",
  confirmed: "profit",
  failed: "destructive",
};

const KIND = {
  deposit: { icon: ArrowDownToLine, tone: "text-profit", label: "Deposit" },
  withdraw: { icon: ArrowUpFromLine, tone: "text-primary", label: "Private withdrawal" },
  ragequit: { icon: DoorOpen, tone: "text-warning", label: "Ragequit (public exit)" },
} as const;

/** How it was sent, in the website's words. A ragequit always comes from the depositor's own wallet. */
function route(a: Activity): string | null {
  if (a.kind === "deposit" || !a.via) return null;
  if (a.kind === "ragequit") return "from my wallet";
  return a.via === "relayer" ? "via the relayer" : "paid my own gas (from my wallet)";
}

/** Why the log is gated (the provider decrypts it only once the vault is unlocked). */
const WHY = `Read together, its entries link your deposits to your withdrawal recipients, ${MULTI_NETWORK ? "the link the pools hide" : "the link the pool hides"}.`;

/** What unlocking found in the stored log: a log set aside because it did not decrypt, or an unreadable older one. */
function LogNotices() {
  const { activityNotice, discardSetAsideLog } = usePrivacy();
  if (!activityNotice.setAside && !activityNotice.unreadableRemoved) return null;
  return (
    <div className="flex flex-col gap-2" role="status">
      {activityNotice.setAside && (
        <InfoNote icon={AlertTriangle} title="An earlier activity log could not be decrypted">
          It was changed, damaged or written by another vault, so it was set aside unread and this log started empty. Forgetting the vault deletes it
          too.
          <Button size="sm" variant="ghost" className={`mt-1.5 -ml-2 flex h-7 rounded-full px-2 text-xs ${QUIET_HOVER}`} onClick={discardSetAsideLog}>
            <Trash2 className="h-3 w-3" aria-hidden /> Delete it now
          </Button>
        </InfoNote>
      )}
      {activityNotice.unreadableRemoved && (
        <InfoNote icon={AlertTriangle} title="An older activity log could not be read">
          This device still had an unencrypted log from an earlier version, but it was damaged, so it was deleted unread.
        </InfoNote>
      )}
    </div>
  );
}

/**
 * The vault's "Activity" tab: this device's log, newest first, each entry with its network's explorer link. With
 * several networks each entry names its network; with one, only an entry from another network (an older build's) does.
 */
export default function ActivityPanel() {
  const { activity, vault } = usePrivacy();
  const named = (chainId: number) => MULTI_NETWORK || !PRIVACY_NETWORKS.some((n) => n.network.chainId === chainId);

  if (vault.status === "none") {
    return (
      <EmptyState icon={History} title="Nothing yet">
        Deposits and withdrawals made from this browser appear here while your vault is unlocked.
      </EmptyState>
    );
  }
  if (vault.status !== "unlocked") {
    return (
      <EmptyState icon={Lock} title="Unlock your vault to see its activity">
        {WHY} {ACTIVITY_LOG_TEXT} Operations left pending are checked on the chain again once you unlock.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <p className="text-xs leading-relaxed text-muted-foreground">
        Your deposits, withdrawals and exits from this browser{MULTI_NETWORK ? ", on every network," : ","} kept so an interrupted operation can be
        checked after a reload. {ACTIVITY_LOG_TEXT} {WHY}
      </p>
      <LogNotices />
      {activity.length === 0 ? (
        <EmptyState icon={History} title="Nothing yet" />
      ) : (
        <ul className="divide-y divide-border/40 rounded-lg border border-border/50">
          {activity.map((a) => {
            // each entry names the network it ran on, and links that network's explorer
            const network = networkById(a.chainId);
            const link = a.txHash ? explorerTxUrl(a.chainId, a.txHash) : null;
            // Entries come from the decrypted log; an unknown kind (older or corrupted data) must not crash the page.
            const K = KIND[a.kind as keyof typeof KIND] ?? { icon: History, tone: "text-muted-foreground", label: String(a.kind) };
            const via = route(a);
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
                <span className="inline-flex min-w-24 items-center gap-2 font-medium">
                  <K.icon className={`h-3.5 w-3.5 shrink-0 ${K.tone}`} aria-hidden />
                  {K.label}
                </span>
                {network && named(a.chainId) && <NetworkLabel network={network} short className="text-xs font-medium text-muted-foreground" />}
                <span className="font-mono">{formatEth(a.amountWei)} ETH</span>
                {a.feeWei !== undefined && a.feeWei > 0n && <span className="text-xs text-muted-foreground">fee {formatEth(a.feeWei)}</span>}
                {a.recipient && <span className="font-mono text-xs text-muted-foreground">→ {shortHex(a.recipient)}</span>}
                {via && <span className="text-xs text-muted-foreground">{via}</span>}
                <Pill small tone={STATUS[a.status] ?? "muted"}>
                  {a.status}
                </Pill>
                <span className="text-xs text-muted-foreground">{new Date(a.createdAt).toLocaleString("en-US")}</span>
                {a.txHash &&
                  (link ? (
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
                      aria-label={`Transaction ${shortHex(a.txHash, 5)} on ${network?.explorer?.name ?? "the explorer"} (opens in a new tab)`}
                    >
                      {shortHex(a.txHash, 5)} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="font-mono text-xs">{shortHex(a.txHash, 5)}</span>
                  ))}
                {a.error && <span className="basis-full break-words text-xs text-destructive">{a.error}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
