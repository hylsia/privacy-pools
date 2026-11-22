import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";
import { AlertTriangle, ExternalLink, KeyRound, Lock, LogOut } from "@/components/icons";
import { useAccount } from "wagmi";
import { NoteDiamond, NoteDiamondIcon } from "@/components/brand/NoteDiamond";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { explorerTxUrl, MULTI_NETWORK } from "@/privacy/config";
import { fieldShort, formatEth, shortHex } from "@/privacy/format";
import { usePrivacy } from "@/privacy/PrivacyProvider";
import { DUPLICATE_NOTE_RISK } from "@/privacy/safetyCopy";
import { offersPublicExit, poolDataUnavailable, poolReadState } from "@/privacy/publicData";
import type { Note } from "@shared/privacy/notes";
import type { DepositedEvent } from "@shared/privacy/types";
import GetStarted from "./GetStarted";
import OpStatus from "./OpStatus";
import { useActivePool } from "./PrivacyCheck";
import { AnnouncedNote, ExcludedCallout, noteBrief, NoteStatusPill, useScreeningReader } from "./Screening";
import { DANGER_FILL, EmptyState, QUIET_HOVER, TONE_TEXT } from "./ui";

const TH = "whitespace-nowrap px-3 py-2.5 text-left text-[13px] font-medium text-muted-foreground first:pl-4 last:pr-4";
const TD = "px-3 py-2.5 first:pl-4 last:pr-4";

/**
 * The vault's "Notes" tab: the active pool's notes (with several networks, every network's are in My notes). Before
 * the first note it shows the first-time path instead of an empty table (GetStarted). Each unspent note shows where its
 * deposit stands under the screening policy, worked out on this device (Screening.tsx); a deposit the chain shows
 * excluded gets "Excluded: use the public exit" with its Ragequit button first.
 */
export default function NotesPanel() {
  const { vault, notes, balance, spendable, ragequit, op, pool } = usePrivacy();
  const ref = useActivePool();
  const name = ref?.network.name ?? "this network";
  const { address } = useAccount();
  const [target, setTarget] = useState<Note | null>(null);
  const busy = op.kind === "ragequit" && !["idle", "confirmed", "failed"].includes(op.stage);
  const unlocked = vault.status === "unlocked";
  const read = poolReadState(pool);

  const depositorOf = (n: Note) => pool.events.find((e): e is DepositedEvent => e.kind === "deposit" && e.label === n.label);

  // where each note's deposit stands under the screening policy, from public data on this device (nothing is sent)
  const reader = useScreeningReader();
  const screeningOf = useCallback((n: Note) => (ref ? reader(ref, pool, n.label) : null), [reader, ref, pool]);
  const states = useMemo(() => new Map(notes.list.map((n) => [n.commitment, screeningOf(n)])), [notes.list, screeningOf]);
  // what the screening pieces show of each note (never its secrets: they are not passed to components)
  const briefs = useMemo(() => new Map(notes.list.map((n) => [n.commitment, noteBrief(n)])), [notes.list]);
  const excluded = unlocked ? notes.list.filter((n) => offersPublicExit(n, states.get(n.commitment) ?? null)) : [];

  return (
    <div className="flex flex-1 flex-col gap-3">
      {unlocked && read === "ready" && notes.list.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {MULTI_NETWORK
            ? `${spendable.length} spendable note(s) on ${name} · ${formatEth(balance)} ETH private balance on this network. Notes on every network are in `
            : `${spendable.length} spendable note(s) · ${formatEth(balance)} ETH private balance. Your history and balance over time are in `}
          <Link href="/pools/portfolio" className="rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            My notes
          </Link>
          .
        </p>
      )}

      {unlocked && notes.conflicts.length > 0 && (
        <div role="alert" className="flex gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 text-xs leading-relaxed">
            <p className={`text-[13px] font-medium ${TONE_TEXT.destructive}`}>Duplicate deposits detected</p>
            <p className={`mt-0.5 ${TONE_TEXT.destructive}`}>
              Deposit index {notes.conflicts.join(", ")} was used more than once. {DUPLICATE_NOTE_RISK}{" "}
              <Link href="/docs/security" className="font-medium underline">Read the open release blocker</Link>.
            </p>
          </div>
        </div>
      )}

      {/* the chain shows these deposits excluded: the public exit first, with what it reveals */}
      {excluded.map((n) => (
        <ExcludedCallout
          key={`x:${n.commitment}`}
          note={briefs.get(n.commitment)!}
          s={states.get(n.commitment) ?? null}
          connected={address ?? null}
          busy={busy}
          onRagequit={() => setTarget(n)}
        />
      ))}
      {/* an exclusion the operator only announces: this app holds the private withdrawal back, and suggests no exit */}
      {unlocked &&
        notes.list.map((n) => <AnnouncedNote key={`a:${n.commitment}`} note={briefs.get(n.commitment)!} s={states.get(n.commitment) ?? null} name={name} />)}

      {notes.list.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border/50">
          <table className="w-full min-w-[680px] border-collapse text-sm">
            <thead className="border-b border-border/50 bg-muted/25">
              <tr>
                <th scope="col" className={TH}>Note</th>
                <th scope="col" className={TH}>Value</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Leaf</th>
                <th scope="col" className={TH}>Commitment</th>
                <th scope="col" className={TH}>Tx</th>
                <th scope="col" className={`${TH} text-right`}>Exit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {notes.list.map((n) => {
                const link = ref ? explorerTxUrl(ref.chainId, n.txHash) : null;
                return (
                  <tr key={`${n.depositIndex}.${n.hop}.${n.commitment}`} className="transition-colors hover:bg-muted/20">
                    <td className={`${TD} font-mono text-xs`}>
                      {/* your note: the landing's gold diamond */}
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <NoteDiamond />#{n.depositIndex}.{n.hop}
                      </span>
                    </td>
                    <td className={`${TD} whitespace-nowrap font-mono text-xs`}>{formatEth(n.value)} ETH</td>
                    <td className={TD}>
                      <NoteStatusPill note={briefs.get(n.commitment)!} s={states.get(n.commitment) ?? null} name={name} />
                    </td>
                    <td className={`${TD} font-mono text-xs`}>{n.leafIndex}</td>
                    <td className={`${TD} font-mono text-xs`} title={n.commitment.toString()}>
                      {fieldShort(n.commitment)}
                    </td>
                    <td className={`${TD} whitespace-nowrap font-mono text-xs`}>
                      {link ? (
                        <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          {shortHex(n.txHash, 4)} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                        </a>
                      ) : (
                        shortHex(n.txHash, 4)
                      )}
                    </td>
                    <td className={`${TD} text-right`}>
                      {!n.spent && n.value > 0n && (
                        <Button
                          size="sm"
                          variant={offersPublicExit(n, states.get(n.commitment) ?? null) ? "outline" : "ghost"}
                          className={`h-7 rounded-full px-2.5 text-xs ${QUIET_HOVER}`}
                          disabled={busy}
                          onClick={() => setTarget(n)}
                        >
                          <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Ragequit
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : unlocked && read === "unavailable" ? (
        // the pool was never read: its notes are unknown, not absent
        <EmptyState icon={AlertTriangle} title="Notes unavailable">
          {poolDataUnavailable(name)} Your notes are rebuilt from its public data, so they appear once it can be read. Try Sync again.
        </EmptyState>
      ) : unlocked && read === "loading" ? (
        <EmptyState icon={NoteDiamondIcon} title="Reading the pool">
          Your notes on {name} appear here once its public data is read.
        </EmptyState>
      ) : (unlocked || vault.status === "none") && ref ? (
        // no note yet (or no vault yet): the first-time path instead of an empty table
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {unlocked
              ? "No notes yet. Your notes appear here after your first deposit (sync if you expect some)."
              : "Your notes are rebuilt here from your vault seed and public chain data. Create a vault, or restore one from a backup file."}
          </p>
          {/* Setup guidance already appears above the forms while the vault is closed. */}
          {unlocked && <GetStarted network={ref.network} chainId={ref.chainId} />}
        </>
      ) : unlocked ? (
        <EmptyState icon={NoteDiamondIcon} title="No notes yet">
          Make a deposit, or sync if you expect some.
        </EmptyState>
      ) : vault.status === "none" ? (
        <EmptyState icon={KeyRound} title="No vault on this device">
          Your notes are rebuilt from your vault seed and public chain data. Create a vault, or restore one from a backup file, to see them.
        </EmptyState>
      ) : (
        <EmptyState icon={Lock} title="Vault locked">
          Unlock the vault to see your notes.
        </EmptyState>
      )}

      <OpStatus kind="ragequit" />

      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        {/* app-root: the dialog is portaled outside the shell, so it carries the heading roll-back itself */}
        <DialogContent className="app-root">
          <DialogHeader>
            <DialogTitle>Exit without the association set</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Ragequit (the public exit) returns {target ? formatEth(target.value) : ""} ETH to the <strong>original depositor</strong> of this note
                  {target && depositorOf(target) ? ` (${shortHex(depositorOf(target)!.depositor)})` : ""}, on {name}. It does not need an association-set
                  root, so it also works if the association-set service stops.
                </p>
                <p className={TONE_TEXT.destructive}>
                  This path is public: the note's label and value are revealed, linking the deposit to this exit. Use it only when a private withdrawal is
                  impossible.
                </p>
                {target && target.hop > 0 && (
                  <p className={TONE_TEXT.destructive}>
                    This is a change note, left over from an earlier private withdrawal. It keeps its original deposit's label, so ragequitting it also
                    reveals which deposit that earlier private withdrawal spent.
                  </p>
                )}
                {target && address && depositorOf(target)?.depositor.toLowerCase() !== address.toLowerCase() && (
                  <p className={TONE_TEXT.destructive}>Your connected wallet is not the depositor; the transaction would be rejected.</p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className={QUIET_HOVER} onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className={DANGER_FILL}
              disabled={busy}
              onClick={async () => {
                const n = target!;
                setTarget(null);
                try {
                  // the note's own pool: the active one this tab lists
                  await ragequit(n, ref?.key);
                  toast.success(`Exit confirmed on ${name}`);
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              Ragequit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
