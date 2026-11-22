import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { NoteDiamond } from "@/components/brand/NoteDiamond";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatEth, parseEthInput, shortHex } from "@/privacy/format";
import { MULTI_NETWORK, PRIVACY_POOLS } from "@/privacy/config";
import { usePrivacy, type QuestionContext, type SmallSetContext } from "@/privacy/PrivacyProvider";
import { useRelayerQuotes, useSelectedRelayer } from "@/privacy/useRelayer";
import { validRelayerQuote } from "@/privacy/relayers";
import { inclusionDelay, poolReadState, publishBlocked, statusRecord } from "@/privacy/publicData";
import type { PublisherBlock } from "@shared/privacy/api";
import { previewAssociationSet, SMALL_ASSOCIATION_SET } from "@shared/privacy/associationSet";
import { eth, type ReasonTopic } from "@shared/privacy/guidance";
import type { Note } from "@shared/privacy/notes";
import type { ShrinkAlarm } from "@shared/privacy/screening";
import { namesList } from "@/components/pools/NetworkMenu";
import OpStatus from "./OpStatus";
import { Caution, PrivacyCheckBlock, useActivePool, useOwnDeposits, usePoolServices, useWithdrawCheck, type FormCaution } from "./PrivacyCheck";
import { holdBlocker, PolicyLink, screeningLine, screeningPill, useASPStatuses, useScreeningReader } from "./Screening";
import { CTA, Checklist, DANGER_FILL, FIELD_BOX, FIELD_INPUT, FieldLabel, HINT, QUIET_HOVER, TOOL_BTN } from "./ui";

/** The self-submission route, named as on the website ("Paying your own gas → payer is visible"). */
const OWN_GAS = "Pay your own gas (from my wallet)";

const deposits = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "deposit" : "deposits"}`;

const ROUTE = "flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors";

/**
 * Why the relayer cannot send a withdrawal right now (the server's own relayer, never anything about the visitor):
 * "unfunded" (temporarily: its gas balance is below one withdrawal), "none" (no relayer for this network), "other".
 */
type RelayerDown = "unfunded" | "none" | "other";

/** The Withdraw form, always for the vault's active pool: its notes, its relayer quote, its network on the button. */
export default function WithdrawPanel() {
  const { vault, pool, pools, spendable, withdraw, op, notes } = usePrivacy();
  const ref = useActivePool();
  const network = ref?.network ?? null;
  const name = network?.name ?? "this network";
  const { address } = useAccount();
  // the chosen relayer's input-less quote for every network (this site's server unless the person picked another in
  // Connection settings); the form uses its own pool's
  const chosenRelayer = useSelectedRelayer();
  const quotes = useRelayerQuotes();
  const quote = useMemo(() => {
    if (!quotes.data || !Array.isArray(quotes.data.quotes) || !ref) return { data: undefined, isLoading: quotes.isLoading };
    // fail closed: only a quote that names this chain and this pool
    const entry = quotes.data.quotes.find(
      (q) => q && q.chainId === ref.chainId && typeof q.pool === "string" && q.pool.toLowerCase() === ref.pool.toLowerCase(),
    );
    return {
      data: entry && validRelayerQuote(entry) ? entry : { available: false as const, reason: entry?.reason ?? null, relayer: null, feeBps: 0, minFeeWei: "0", expiresAt: 0 },
      isLoading: false,
    };
  }, [quotes.data, quotes.isLoading, ref]);
  // The relayer and the publisher as the shell's public pool summary reports them now (every visitor's request, every
  // 30 s); before it answers, or from an older server, the quote fetched when this form opened.
  const services = usePoolServices();
  // the shell's summary describes this site's relayer only; another relayer is judged by its own quote
  const relayerDown: RelayerDown | null =
    chosenRelayer.origin !== null && quotes.isError
      ? "other"
      : chosenRelayer.origin === null && services.status === "ready"
      ? services.relayerAvailable
        ? null
        : services.relayerBlock === "relayer_unfunded"
          ? "unfunded"
          : services.relayerBlock === "no_relayer_key"
            ? "none"
            : "other"
      : quote.data && !quote.data.available
        ? quote.data.reason === "relayer_unfunded"
          ? "unfunded"
          : quote.data.reason === "no_relayer_key"
            ? "none"
            : "other"
        : null;
  // the relayer's terms (filled in even while it is temporarily unavailable)
  const terms = quote.data?.relayer ? quote.data : null;
  // the vault's spendable notes on the other networks: withdrawn only there, after switching the network above
  const elsewhere = useMemo(() => pools.filter((v) => v.ref.key !== ref?.key && v.spendable.length > 0), [pools, ref]);
  const routeLabel = useId();

  const [noteKey, setNoteKey] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [via, setVia] = useState<"relayer" | "self">("relayer");

  const note = useMemo(() => spendable.find((n) => n.commitment.toString() === noteKey) ?? null, [spendable, noteKey]);
  const wei = parseEthInput(amount);
  const busy = op.kind === "withdraw" && !["idle", "confirmed", "failed"].includes(op.stage);

  // Where each note's deposit stands under the screening policy, on this device from public data every visitor gets
  // (the pool's events, the shell's privacy.asp.status copy, the page's public activity list): nothing is sent for it.
  const read = useScreeningReader();
  const screeningOf = useCallback((n: Note) => (ref ? read(ref, pool, n.label) : null), [read, ref, pool]);
  const states = useMemo(() => new Map(spendable.map((n) => [n.commitment, screeningOf(n)])), [spendable, screeningOf]);
  const info = note ? (states.get(note.commitment) ?? null) : null;
  const screening = info?.screening ?? null;
  const delaySeconds = inclusionDelay(screening, ref?.chainId);
  // the publisher cannot post a newer root right now: a withdrawal is proved against the root already published
  const publisherDown: PublisherBlock | null =
    services.status === "ready"
      ? services.aspCanPublish
        ? null
        : (services.aspPublishBlock ?? "no_key")
      : info?.canPublish === false
        ? (info.publishBlock ?? "no_key")
        : null;

  // No withdrawal on any network asks for a newer root while some pool's fresh answer has announcements that alone
  // shrink that pool's root sharply (one answer covers every network: publicData.ts publishBlocked, as withdraw()
  // decides with publishNeeded): the form then shows the current root's crowd.
  const statuses = useASPStatuses(PRIVACY_POOLS);
  const blocked = useMemo(
    () =>
      publishBlocked(
        PRIVACY_POOLS.map((r) => pools.find((v) => v.ref.key === r.key)?.state ?? null),
        statuses.map((s) => s.screening),
      ),
    [pools, statuses],
  );
  // The association set this note would be proved in, from this device's public events only (nothing is sent): the
  // current root, and the next one when a withdrawal asks for it (publishDue: the operator's rootDue, no label).
  const preview = useMemo(
    () =>
      note
        ? previewAssociationSet({
            label: note.label,
            events: pool.events,
            currentRoot: pool.aspRoot,
            screening,
            canPublish: info?.canPublish ?? null,
            depositTime: info?.depositTime ?? null,
            now: info?.now ?? null,
            delaySeconds,
            record: statusRecord(screening),
            publishBlocked: blocked,
          })
        : null,
    [note, pool.events, pool.aspRoot, screening, info?.canPublish, info?.depositTime, info?.now, delaySeconds, blocked],
  );
  // The next root's crowd (the operator's snapshot recipe, rebuilt on this device) once the root a withdrawal asks for
  // is posted; otherwise, while the publisher cannot post, or when that recipe does not rebuild here or does not fit the
  // answer, the current root's. Decided the same way for every note (never by whether this note is in the snapshot), so
  // every note the form lets start is compared with the same number after the withdrawal's request is answered. Never
  // the deposit count, and never a member count the answer only claims: under the screening policy a deposit inside the
  // delay, or an excluded one, is no member, and a member the operator announces for exclusion is no cover.
  const useNext = !!preview && preview.behind && !publisherDown && preview.next !== null;
  const members = preview ? (useNext ? preview.nextMembers : preview.members) : null;
  const expected = preview && members ? (useNext ? preview.next : preview.covered) : null;
  // the crowd of the root on-chain now: only its members can start a withdrawal from this app, so it is the crowd the
  // operator sees any request of it come from, whatever the next root holds
  const crowdNow = preview?.covered ?? null;
  // a note the screening policy holds back (anything but a member of the verified current root that the operator does
  // not announce for exclusion): nothing is sent
  const hold = note ? holdBlocker(note, info, name) : null;

  // The small-set question, asked by withdraw() before any request about the withdrawal (or, when the crowd only turns
  // out small once its request for a newer root is answered, then).
  const [smallSet, setSmallSet] = useState<({ size: number } & SmallSetContext) | null>(null);
  const answer = useRef<((go: boolean) => void) | null>(null);
  const confirmSmallSet = (size: number, o: SmallSetContext) =>
    new Promise<boolean>((resolve) => {
      answer.current = resolve;
      setSmallSet({ size, ...o });
    });
  const decide = (go: boolean) => {
    answer.current?.(go);
    answer.current = null;
    setSmallSet(null);
  };
  // The shrink question: the crowd this withdrawal would hide in is far smaller than one of the pool's recent roots, than
  // the newest root itself (deposits the operator announces for exclusion), or than this form showed (a publisher could
  // shrink the set around a withdrawal). Asked by withdraw() before any request about the withdrawal (the form's number:
  // once its request for a newer root is answered).
  const [shrinkQ, setShrink] = useState<({ alarm: ShrinkAlarm } & QuestionContext) | null>(null);
  const shrink = shrinkQ?.alarm ?? null;
  const shrinkAnswer = useRef<((go: boolean) => void) | null>(null);
  const confirmShrink = (alarm: ShrinkAlarm, o: QuestionContext) =>
    new Promise<boolean>((resolve) => {
      shrinkAnswer.current = resolve;
      setShrink({ alarm, ...o });
    });
  const decideShrink = (go: boolean) => {
    shrinkAnswer.current?.(go);
    shrinkAnswer.current = null;
    setShrink(null);
  };
  // leaving the page counts as "do not send"
  useEffect(
    () => () => {
      answer.current?.(false);
      shrinkAnswer.current?.(false);
    },
    [],
  );

  const fee = useMemo(() => {
    if (via !== "relayer" || !wei || !terms) return 0n;
    const pct = (wei * BigInt(terms.feeBps)) / 10_000n;
    const min = BigInt(terms.minFeeWei);
    return pct > min ? pct : min;
  }, [via, wei, terms]);

  // Every network's depositors, from each pool's public events on this device: an address is the same on every chain,
  // so a deposit on any network ties a recipient to it. Each set names its network for the warnings.
  const depositors = useMemo(
    () =>
      pools.map((v) => {
        const all = new Set<string>();
        const mine = new Set<string>();
        const labels = new Set(v.notes.list.map((n) => n.label));
        for (const e of v.state.events) {
          if (e.kind !== "deposit") continue;
          const who = e.depositor.toLowerCase();
          all.add(who);
          if (labels.has(e.label)) mine.add(who);
        }
        return { name: v.ref.network.name, all, mine };
      }),
    [pools],
  );
  // addresses that made this vault's deposits, on every network: a withdrawal tied to one of them links straight back
  const own = useOwnDeposits();
  const wallet = address?.toLowerCase();
  const to = recipient.toLowerCase();
  // the connected wallet is never a fresh address (the Deposit form counts its deposits as yours too)
  const toWallet = !!recipient && !!wallet && to === wallet;
  const linkedRecipient = !!recipient && (toWallet || own.addresses.has(to));
  const linkedRoute = via === "self" && !!wallet && own.addresses.has(wallet);
  // where the recipient made this vault's deposits, and where it deposited at all (named only with several networks)
  const ownOn = MULTI_NETWORK ? namesList(depositors.filter((d) => d.mine.has(to)).map((d) => d.name)) : "";
  const depositedOn = namesList(depositors.filter((d) => d.all.has(to)).map((d) => d.name));

  // The form's cautions (the website's two ways to undo the privacy, and a small set), each shown once, inside the
  // privacy check; what links the withdrawal is shown right under the verdict.
  const warnings: FormCaution[] = [];
  if (toWallet) {
    warnings.push({
      links: true,
      text: own.addresses.has(to)
        ? "The recipient is your connected wallet, which made deposits from this vault, so the withdrawal links straight back to them."
        : "The recipient is your connected wallet, so anyone can tie this withdrawal to that wallet.",
    });
  } else if (linkedRecipient) {
    warnings.push({
      links: true,
      text: `This address made deposits from this vault${ownOn ? ` (on ${ownOn})` : ""}, so withdrawing to it links the withdrawal straight back to them.`,
    });
  } else if (recipient && depositedOn && notes.list.some((n) => n.spent === false)) {
    warnings.push({
      links: false,
      text: `This address has deposited into ${MULTI_NETWORK ? `a Hylsia pool before (on ${depositedOn})` : "the pool before"}; withdrawing to it weakens your privacy.`,
    });
  }
  if (via === "self") {
    warnings.push({
      links: linkedRoute,
      text: `Paying your own gas sends the withdrawal from your connected wallet: the gas payer is visible and publicly linked to the recipient.${
        linkedRoute ? " This wallet made deposits from this vault, so the withdrawal links straight back to them." : ""
      }`,
    });
  }
  // Members of the current root the operator's status announces for exclusion are not counted (this app holds them
  // back): with any, the current root's crowd is what this app counts, not the set on-chain, and only the operator
  // could narrow a withdrawal that far, so the cautions give both numbers.
  const announcedOut = preview?.announcedOut ?? 0;
  // the same for the root the form shows: the next one (its recipe's members the answer announces) or the current one
  const shownOut = useNext && preview && preview.nextSize !== null && preview.next !== null ? preview.nextSize - preview.next : announcedOut;
  const byStatus = (crowd: number, out: number, root: string) =>
    `${root} ${deposits(crowd + out)}, but the operator's status (which can differ for each visitor and is not on-chain) announces ${out.toLocaleString("en-US")} of them for exclusion, so this app counts only ${crowd === 1 ? "your deposit" : deposits(crowd)}`;
  const asked = "You will be asked before the withdrawal, or any request for a newer root, is sent.";
  if (!hold && expected !== null && expected < SMALL_ASSOCIATION_SET) {
    warnings.push({
      links: false,
      text:
        shownOut > 0
          ? `Small association set by the operator's status: ${byStatus(expected, shownOut, useNext ? "the next root would hold" : "the root on-chain holds")}, and the operator ${expected === 1 ? "could tell this withdrawal is yours" : "could narrow this withdrawal to one of them"}. ${asked}`
          : expected === 1
            ? `The association set holds only your deposit, so this withdrawal would name it. ${asked} Waiting for more deposits keeps the link better hidden.`
            : `Small association set: an observer can narrow this withdrawal to one of ${deposits(expected)}, or fewer with amounts and timing. ${asked}`,
    });
  } else if (!hold && crowdNow !== null && crowdNow < SMALL_ASSOCIATION_SET) {
    // the next root would be larger, but only the current root's members can start a withdrawal from this app
    const operator = `so the operator, which receives this withdrawal's request for the next root, ${crowdNow === 1 ? "could tell it is yours" : "can narrow it to one of them"}`;
    warnings.push({
      links: false,
      text:
        announcedOut > 0
          ? `Right now ${byStatus(crowdNow, announcedOut, "the root on-chain holds")}, and only ${crowdNow === 1 ? "it" : "they"} can start a private withdrawal from this app, ${operator}. ${asked}`
          : crowdNow === 1
            ? `Right now the association set on-chain holds only your deposit, and only it can start a private withdrawal from this app, ${operator}. ${asked}`
            : `Right now the association set on-chain holds only ${deposits(crowdNow)}, and only they can start a private withdrawal from this app, ${operator}. ${asked}`,
    });
  }

  // The privacy check, on this device from public data only (no request depends on the note, amount or recipient).
  const valid = note && wei && wei > 0n && wei <= note.value ? wei : null;
  // more than the note holds: said in the check, and the form cannot be sent
  const over = note && wei && wei > note.value ? note.value : null;
  const checkState = useWithdrawCheck({
    note,
    amount: valid,
    members,
    delaySeconds,
    eligibleAt: info?.eligibleAt ?? null,
    viaRelayer: !linkedRoute,
    freshRecipient: !linkedRecipient,
  });
  // what the cautions already say is not repeated among the check's reasons
  const said = useMemo(() => {
    const topics = new Set<ReasonTopic>(["recipient", "route"]);
    if (expected !== null && expected < SMALL_ASSOCIATION_SET) topics.add("set");
    return topics;
  }, [expected]);

  const blockers: string[] = [];
  if (vault.status !== "unlocked") blockers.push("Unlock your vault");
  // a failed read says so (never "still loading"), and "no spendable notes" waits until the pool was read. A pool with
  // no association-set root yet holds every note back (below): no withdrawal asks for the first root, which comes from
  // the publisher's schedule or the operator.
  if (pool.status === "error") blockers.push(`Pool data for ${name} could not be read right now (public RPC)`);
  else if (pool.status !== "ready") blockers.push("Pool state is still loading");
  // this device started from the site's snapshot: private withdrawals wait for the full history (read in the background)
  else if (pool.historyVerified === false) blockers.push(`Reading the ${name} pool's full history. This takes a moment the first time.`);
  if (spendable.length === 0 && vault.status === "unlocked" && poolReadState(pool) === "ready") blockers.push("You have no spendable notes");
  // the screening policy holds this note back: anything the verified current root does not hold (inside the delay,
  // eligible for the next root, excluded on-chain, a root still being checked), or an exclusion the operator announces
  // (this app then fails closed and suggests no public exit). Only a member starts an attempt, so no answer of the
  // operator's can make one note start an attempt that then fails.
  if (hold) blockers.push(hold);
  if (via === "relayer" && relayerDown) {
    blockers.push(
      relayerDown === "unfunded"
        ? `The relayer for ${name} is temporarily unavailable. "${OWN_GAS}" still works but makes the gas payer visible; waiting for the relayer avoids that.`
        : relayerDown === "none"
          ? `This app has no relayer for ${name}. "${OWN_GAS}" works but makes the gas payer visible.`
          : `Relayer for ${name} unavailable. "${OWN_GAS}" makes the gas payer visible; waiting for the relayer avoids that.`,
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!note) return toast.error("Choose a note");
    if (!wei || wei <= 0n || wei > note.value) return toast.error("Enter an amount up to the note value");
    if (!isAddress(recipient)) return toast.error("Enter a valid recipient address");
    try {
      // the note's own pool, named explicitly: the form never spends a note on another network
      await withdraw({ note, amountWei: wei, recipient: recipient as Address, via, confirmSmallSet, confirmShrink, expectedCrowd: expected, maxRelayerFeeWei: fee, poolKey: ref?.key });
      toast.success(`Withdrawal confirmed on ${name}`);
      setAmount("");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          A zero-knowledge proof for the {name} pool is generated on this device, together with the association-set proof, built from public data. The
          pool learns the amount, the recipient and the fee — not which deposit is being spent. Any remainder stays in the pool as a change note.
        </p>

        <div>
          <FieldLabel htmlFor="wd-note" label="Note to spend" />
          <Select value={noteKey} onValueChange={setNoteKey} disabled={busy || spendable.length === 0}>
            <SelectTrigger
              id="wd-note"
              className="w-full rounded-lg border-border/60 bg-background/50 px-3 font-mono text-[13px] data-[size=default]:h-11 dark:bg-background/50 dark:hover:bg-background/70"
            >
              <SelectValue placeholder={spendable.length ? "Select a note" : "No spendable notes"} />
            </SelectTrigger>
            <SelectContent>
              {spendable.map((n) => {
                // the note's screening state, when it is not simply in the set (worked out on this device)
                const pill = screeningPill(states.get(n.commitment) ?? null, name);
                return (
                  <SelectItem key={n.commitment.toString()} value={n.commitment.toString()}>
                    <NoteDiamond />
                    Note #{n.depositIndex}.{n.hop} · {formatEth(n.value)} ETH · leaf {n.leafIndex}
                    {pill && (
                      <>
                        {" "}
                        <span className="font-sans text-xs text-muted-foreground">· {pill.short}</span>
                      </>
                    )}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {note && info && !hold && screeningLine(info, name) && (
            <p className={HINT}>
              {screeningLine(info, name)} <PolicyLink />
            </p>
          )}
          {elsewhere.map((v) => (
            <p key={v.ref.key} className={HINT}>
              {v.spendable.length} spendable note(s) on {v.ref.network.name}. Switch network above to withdraw them.
            </p>
          ))}
        </div>

        <div>
          <FieldLabel
            htmlFor="wd-amount"
            label={
              <>
                Amount<span className="sr-only"> (ETH)</span>
              </>
            }
            right={
              <button type="button" className={TOOL_BTN} disabled={!note} onClick={() => note && setAmount(formatEth(note.value, 18))}>
                Full
              </button>
            }
          />
          <div className={`${FIELD_BOX} h-12`}>
            <input
              id="wd-amount"
              inputMode="decimal"
              placeholder="0.01"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy || !note}
              className={`${FIELD_INPUT} font-mono text-[15px]`}
            />
            <span className="flex shrink-0 items-center gap-1.5 border-l border-border/60 pl-3 font-mono text-sm text-muted-foreground">
              <img src="/crypto-icons/eth.svg" alt="" className="h-4 w-4" />
              ETH
            </span>
          </div>
          {note && <p className={HINT}>Note value {formatEth(note.value)} ETH. Partial withdrawals create a change note.</p>}
        </div>

        <div>
          <FieldLabel htmlFor="wd-recipient" label="Recipient address" />
          <div className={FIELD_BOX}>
            <input
              id="wd-recipient"
              placeholder="0x…"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.trim())}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="wd-recipient-hint"
              className={`${FIELD_INPUT} font-mono text-[13px]`}
            />
          </div>
          <p id="wd-recipient-hint" className={HINT}>
            Use a fresh address that has never interacted with your deposits. The recipient receives testnet ETH on {name}.
          </p>
        </div>

        <div>
          <p id={routeLabel} className="mb-1.5 text-[13px] font-medium text-muted-foreground">
            Submission
          </p>
          <RadioGroup aria-labelledby={routeLabel} value={via} onValueChange={(v) => setVia(v as "relayer" | "self")} className="grid gap-2">
            <label className={`${ROUTE} ${via === "relayer" ? "border-primary/50 bg-primary/5" : "border-border/60 hover:bg-muted/30"}`}>
              <RadioGroupItem value="relayer" className="mt-0.5" />
              <span className="min-w-0">
                <span className="font-medium">Via relayer (recommended)</span>
                <span className="block text-xs text-muted-foreground">
                  {/* which relayer: this site's unless the person picked another (Connection settings, in the header) */}
                  {chosenRelayer.origin ? `Relayer: ${chosenRelayer.label} (change it in Connection settings). ` : ""}
                  The relayer pays gas and takes a fee from the withdrawn amount.
                  {relayerDown === "unfunded"
                    ? " Temporarily unavailable."
                    : relayerDown
                      ? " Not available."
                      : terms
                        ? ` Fee ${terms.feeBps / 100}%${BigInt(terms.minFeeWei) > 0n ? `, min ${formatEth(BigInt(terms.minFeeWei))} ETH` : ""} · ${shortHex(terms.relayer ?? "")}`
                        : quote.isLoading
                          ? " Loading quote…"
                          : " Not available."}
                </span>
              </span>
            </label>
            <label className={`${ROUTE} ${via === "self" ? "border-primary/50 bg-primary/5" : "border-border/60 hover:bg-muted/30"}`}>
              <RadioGroupItem value="self" className="mt-0.5" />
              <span className="min-w-0">
                <span className="font-medium">{OWN_GAS}</span>
                <span className="block text-xs text-muted-foreground">No relayer fee, but the gas payer is visible on-chain.</span>
              </span>
            </label>
          </RadioGroup>
        </div>

        {wei && wei > 0n && (
          <div className="space-y-1 rounded-lg border border-border/50 bg-background/40 p-3 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Withdrawn from note</span>
              <span className="font-mono">{formatEth(wei)} ETH</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Relayer fee</span>
              <span className="font-mono">{formatEth(fee)} ETH</span>
            </div>
            <div className="flex justify-between gap-3 font-medium">
              <span>Recipient receives</span>
              <span className="font-mono">{formatEth(wei - fee)} ETH</span>
            </div>
            {note && over === null && (
              <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                <span>Change note</span>
                <span className="font-mono">{formatEth(note.value - wei)} ETH</span>
              </div>
            )}
            {quote.data?.available && !relayerDown && via === "relayer" && (
              <p className="pt-1 text-xs text-muted-foreground">
                Quote valid until {new Date(quote.data.expiresAt * 1000).toLocaleTimeString("en-US")}; the proof is bound to it.
              </p>
            )}
          </div>
        )}

        {/* the privacy check right before the submit button; without a note, the cautions alone */}
        {note && preview ? (
          <PrivacyCheckBlock
            state={checkState}
            amount={valid}
            over={over}
            preview={preview}
            setSize={expected}
            noNewRoot={!!publisherDown}
            held={!!hold}
            screeningText={info ? screeningLine(info, name) : null}
            cautions={warnings}
            hide={said}
            onUseAmount={(v) => setAmount(eth(v))}
          />
        ) : (
          warnings.map((w) => <Caution key={w.text}>{w.text}</Caution>)
        )}
        <Checklist title="Before you can withdraw" items={blockers} />

        <Button type="submit" className={CTA} disabled={busy || blockers.length > 0 || !note || !wei || over !== null}>
          {busy ? "Working…" : network ? `Withdraw on ${network.shortName}` : "Withdraw"}
        </Button>
      </form>

      <OpStatus kind="withdraw" />

      <Dialog open={smallSet !== null} onOpenChange={(open) => !open && decide(false)}>
        {/* app-root: the dialog is portaled outside the shell, so it carries the heading roll-back itself */}
        <DialogContent className="app-root">
          <DialogHeader>
            <DialogTitle>
              {smallSet && smallSet.announced > 0
                ? // the crowd leaves out members the operator's status announces for exclusion: small to the operator only
                  smallSet.size === 1
                  ? "To the operator, this withdrawal can only be yours"
                  : `To the operator, this withdrawal can only be one of ${deposits(smallSet.size)}`
                : smallSet?.size === 1
                  ? `Only your deposit is in ${smallSet.beforeRequest && smallSet.publishes ? "the association set right now" : "this association set"}`
                  : `Only ${deposits(smallSet?.size ?? 0)} in ${smallSet?.beforeRequest && smallSet.publishes ? "the association set right now" : "this association set"}`}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                {smallSet && smallSet.announced > 0 && (
                  <p>
                    {smallSet.beforeRequest && smallSet.publishes ? "The newest association-set root on-chain" : "This withdrawal would be proved against the newest association-set root, which"}{" "}
                    holds {deposits(smallSet.onChain)}, but the operator&apos;s status announces that {smallSet.announced.toLocaleString("en-US")} of them will be excluded.
                    This app holds those back, so only {smallSet.size === 1 ? "your deposit" : `the other ${deposits(smallSet.size)}`} can start a private
                    withdrawal from this app. Its status answer can differ for each visitor, and nothing on-chain shows these announcements yet.
                  </p>
                )}
                {smallSet && smallSet.beforeRequest && smallSet.publishes ? (
                  // asked before the request for a newer root: only the current root's members can start a withdrawal here
                  <p>
                    {smallSet.announced > 0 ? (
                      "This"
                    ) : (
                      <>
                        Right now the association set on-chain holds {deposits(smallSet.size)}, and only {smallSet.size === 1 ? "it" : "they"} can start a
                        private withdrawal from this app. This
                      </>
                    )}{" "}
                    withdrawal first asks the publisher for a newer root
                    {smallSet.expected !== null && smallSet.expected > smallSet.size
                      ? ` (by the operator's status it would hold ${deposits(smallSet.expected)})`
                      : ""}
                    , and the operator, which receives that request, can tell it came from{" "}
                    {smallSet.size === 1 ? "your deposit" : `one of these ${deposits(smallSet.size)}`}, even once a larger root is posted.
                  </p>
                ) : smallSet && smallSet.announced > 0 ? null : (
                  <p>
                    This withdrawal would be proved against an association set of {deposits(smallSet?.size ?? 0)} (the membership proof was built on this
                    device).{" "}
                    {smallSet?.size === 1
                      ? "It would name your deposit: anyone could link this withdrawal to it."
                      : "An observer can narrow the withdrawal to one of them, or fewer with amounts and timing."}
                  </p>
                )}
                <p>
                  {smallSet?.beforeRequest && smallSet.publishes ? "No withdrawal and no request for a newer root have been sent yet." : "No withdrawal has been sent yet."}{" "}
                  Every new deposit makes the set bigger, so waiting keeps the link better hidden.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className={QUIET_HOVER} onClick={() => decide(false)}>
              Don't send
            </Button>
            <Button variant="destructive" className={DANGER_FILL} onClick={() => decide(true)}>
              Withdraw anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={shrink !== null} onOpenChange={(open) => !open && decideShrink(false)}>
        <DialogContent className="app-root">
          <DialogHeader>
            <DialogTitle>{shrink?.basis === "form" ? "The association set is smaller than the form showed" : "The association set shrank sharply"}</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                {shrink && (
                  <>
                    {shrink.basis === "form" ? (
                      <p>
                        This form showed an association set of {deposits(shrink.from)}, but the root this withdrawal would be proved against gives{" "}
                        {deposits(shrink.to)}: the newest root on-chain is not the one the operator&apos;s status described
                        {shrink.announced > 0 ? `, and the operator announces ${shrink.announced.toLocaleString("en-US")} of its members for exclusion` : ""}.
                      </p>
                    ) : shrink.basis === "current" ? (
                      <p>
                        The newest association-set root holds {deposits(shrink.from)}, but the operator&apos;s status announces that{" "}
                        {shrink.announced.toLocaleString("en-US")} of them will be excluded. This app holds those back, so to the operator a withdrawal from this
                        app can only be {shrink.to <= 1 ? "your own deposit" : `one of the other ${deposits(shrink.to)}`}. Its status answer can differ for
                        each visitor, and nothing on-chain shows these announcements yet.
                      </p>
                    ) : (
                      <p>
                        This withdrawal would be proved against the newest association-set root, which leaves {deposits(shrink.to)} to hide among. One of
                        the pool&apos;s recent roots held {deposits(shrink.from)}: {deposits(shrink.removed)} {shrink.removed === 1 ? "was" : "were"} taken out
                        {shrink.announced > 0 ? ` (${shrink.announced.toLocaleString("en-US")} of them only announced by the operator, not on-chain yet)` : ""}
                        {shrink.unexplained > 0
                          ? `, ${shrink.unexplained.toLocaleString("en-US")} of them with no reason in the operator's status`
                          : ", each with a reason in the operator's status"}
                        .
                      </p>
                    )}
                    <p>
                      A publisher that shrinks the set right before a withdrawal can narrow down who is withdrawing. Your withdrawal would hide among{" "}
                      {deposits(shrink.to)}
                      {shrink.to < SMALL_ASSOCIATION_SET
                        ? shrink.to <= 1
                          ? ", which names your deposit."
                          : ", a small crowd: an observer can narrow it to one of them, or fewer with amounts and timing."
                        : "."}
                    </p>
                    <p>
                      {shrinkQ?.beforeRequest && shrinkQ.publishes ? "No withdrawal and no request for a newer root have been sent yet." : "No withdrawal has been sent yet."}{" "}
                      Waiting until the set grows again keeps the link better hidden.
                    </p>
                  </>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className={QUIET_HOVER} onClick={() => decideShrink(false)}>
              Don't send
            </Button>
            <Button variant="destructive" className={DANGER_FILL} onClick={() => decideShrink(true)}>
              Withdraw anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
