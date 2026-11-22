import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Clock, ExternalLink, Eye, FileCheck2 } from "@/components/icons";
import { useAccount, useBalance } from "wagmi";
import { Button } from "@/components/ui/button";
import { MULTI_NETWORK } from "@/privacy/config";
import { formatEth, parseEthInput } from "@/privacy/format";
import { usePrivacy } from "@/privacy/PrivacyProvider";
import { inclusionDelay } from "@/privacy/publicData";
import { depositAdvice, eth, poolDeposits, standardAmounts } from "@shared/privacy/guidance";
import { formatDelay } from "@shared/privacy/screening";
import OpStatus from "./OpStatus";
import { PolicyLink, publisherDownClause, useASPStatusOf } from "./Screening";
import {
  Caution,
  PoolSizeNote,
  SoftNote,
  StandardAmountChips,
  UseAmount,
  useActivePool,
  useOwnAndWallet,
  usePoolServices,
  usePoolSize,
} from "./PrivacyCheck";
import { CTA, Checklist, FIELD_BOX, FIELD_INPUT, FieldLabel, HINT, InfoNote, TOOL_BTN, faucetLinkLabel } from "./ui";

/** The Deposit form, always for the vault's active pool: its network is named in the first sentence and on the button. */
export default function DepositPanel() {
  const { vault, pool, deposit, op } = usePrivacy();
  const ref = useActivePool();
  const network = ref?.network ?? null;
  const name = network?.name ?? "this network";
  const { address, isConnected } = useAccount();
  // the wallet's balance on the active network only: the address goes to no other network's RPC
  const { data: bal } = useBalance({ address, chainId: ref?.chainId, query: { enabled: !!address && !!ref } });
  const [amount, setAmount] = useState("");
  const wei = parseEthInput(amount);
  const busy = op.kind === "deposit" && !["idle", "confirmed", "failed"].includes(op.stage);
  const deposited = op.kind === "deposit" && op.stage === "confirmed";
  // the website pairs "Deposit testnet ETH" with "Get testnet ETH": point at this network's faucet while the wallet cannot
  // cover a deposit (balance unknown, empty, or below the pool's minimum)
  const faucet = network?.faucet ?? null;
  const needsEth = !!faucet && (!bal || bal.value === 0n || bal.value < pool.minDeposit);

  // The guidance, from the public events on this device: this vault's deposits and the connected wallet's are no cover.
  // Its counts wait for the pool state, so a device still syncing never reads "no others yet".
  const ready = pool.status === "ready";
  const own = useOwnAndWallet();
  const deposits = useMemo(() => poolDeposits(pool.events, null, own), [pool.events, own]);
  const ladder = useMemo(() => standardAmounts(deposits, pool.minDeposit), [deposits, pool.minDeposit]);
  // the pool size from the public pool summary every dashboard visitor fetches (no tree is built here)
  const size = usePoolSize();
  // the server's publisher, from the same summary: while it cannot post roots, a new deposit cannot be withdrawn
  // privately yet (ragequit always works), which a depositor should know before sending
  const services = usePoolServices();
  const publisherDown = services.status === "ready" && !services.aspCanPublish ? (services.aspPublishBlock ?? "no_key") : null;
  // the screening policy's wait on this pool: the publisher's public status (the shell's copy), else the registry's
  const status = useASPStatusOf(ref);
  const delay = inclusionDelay(status.screening, ref?.chainId);
  const advice = ready && wei ? depositAdvice(wei, deposits, pool.minDeposit) : null;
  const use = (v: bigint) => setAmount(eth(v));

  const blockers: string[] = [];
  if (vault.status !== "unlocked") blockers.push("Unlock your vault");
  else if (!vault.backupVerified) blockers.push("Verify your backup (Backup & recovery)");
  // the shell's Connect Wallet button; the deposit itself asks the wallet to add and switch to the network
  if (!isConnected) blockers.push("Connect a wallet (top right)");
  // a failed read says so, never "still loading"
  if (pool.status === "error") blockers.push(`Pool data for ${name} could not be read right now (public RPC)`);
  else if (pool.status !== "ready") blockers.push("Pool state is still loading");
  if (pool.dead) blockers.push("Pool no longer accepts deposits");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!wei) return toast.error("Enter a valid amount");
    if (bal && wei > bal.value) return toast.error(`Insufficient balance on ${name}`);
    try {
      // into the pool this form shows, named explicitly (the network switcher is locked while it runs)
      await deposit(wei, ref?.key);
      setAmount("");
      toast.success(`Deposit confirmed on ${name}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-xs leading-relaxed text-muted-foreground">
          The {name} pool records a commitment to your note{MULTI_NETWORK ? `; it can only be withdrawn on ${name}` : ""}. Any amount is accepted; a
          standard amount that many deposits share makes a later withdrawal harder to link.
        </p>

        <div>
          <FieldLabel
            htmlFor="dep-amount"
            label={
              <>
                Amount<span className="sr-only"> (ETH)</span>
              </>
            }
            right={
              bal && (
                <button
                  type="button"
                  className={TOOL_BTN}
                  onClick={() => setAmount(formatEth(bal.value > 10n ** 15n ? bal.value - 10n ** 15n : 0n, 6))}
                >
                  Max
                </button>
              )
            }
          />
          <div className={`${FIELD_BOX} h-12`}>
            <input
              id="dep-amount"
              inputMode="decimal"
              placeholder="0.01"
              autoComplete="off"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              disabled={busy}
              aria-describedby="dep-amount-hint"
              className={`${FIELD_INPUT} font-mono text-[15px]`}
            />
            <span className="flex shrink-0 items-center gap-1.5 border-l border-border/60 pl-3 font-mono text-sm text-muted-foreground">
              <img src="/crypto-icons/eth.svg" alt="" className="h-4 w-4" />
              ETH
            </span>
          </div>
          <p id="dep-amount-hint" className={HINT}>
            {isConnected ? (
              <>Wallet balance on {name}: {" "}
                {bal ? `${formatEth(bal.value)} ETH` : "—"}</>
            ) : (
              // first-time path: the wallet is asked to add the network when the deposit is sent
              <>Connect a wallet to see its balance. Depositing asks it to add{" "}
                {name} and switch to it.</>
            )}
            {pool.minDeposit > 0n && ` · minimum deposit ${formatEth(pool.minDeposit)} ETH`}
            {needsEth && faucet && network && (
              <>
                {/* after a full sentence a space, after a figure the line's own separator */}
                {isConnected || pool.minDeposit > 0n ? " · " : " "}
                <a
                  href={faucet.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 whitespace-nowrap rounded font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {faucetLinkLabel(network)}
                  <ExternalLink className="h-2.5 w-2.5" aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </>
            )}
          </p>
        </div>

        <StandardAmountChips amounts={ladder} value={wei} onPick={use} disabled={busy} ready={ready} />

        <PoolSizeNote size={size} networkName={name} delaySeconds={delay} />

        {/* the screening policy, before anything is sent: when a new deposit can leave privately */}
        <InfoNote icon={FileCheck2} title="Screening">
          {delay > 0
            ? `A new deposit becomes eligible ${formatDelay(delay)} after its block time, then waits for a root that includes it, unless it is excluded. With an active, funded and healthy publisher, the usual wait here is about 1 hour to 1 hour 10 minutes; this is an estimate, not a guarantee.`
            : "A new deposit can be withdrawn privately once the next association-set root includes it, unless it is excluded."}{" "}
          Ragequit (public exit) requires an unspent note, its proof, the
          original depositor's wallet and gas.{" "}
          <PolicyLink>How screening works</PolicyLink>
        </InfoNote>

        {advice?.kind === "unusual" && advice.caution && (
          <Caution>
            {advice.caution}
            {advice.suggestion !== null && (
              <>
                {" "}
                <UseAmount wei={advice.suggestion} onUse={use} />
              </>
            )}
          </Caution>
        )}
        {advice?.kind === "few" && advice.caution && (
          <SoftNote>{advice.caution}</SoftNote>
        )}
        {publisherDown && (
          <SoftNote>
            {publisherDown === "publisher_unfunded"
              ? `The association-set publisher for ${name} is temporarily unable to post new roots, so a new deposit can be withdrawn privately only once it posts again.`
              : publisherDown === "policy_error"
                ? `Right now ${publisherDownClause(publisherDown, name)}, so a new deposit can be withdrawn privately only once it posts again.`
                : `This app's server cannot post association-set roots for ${name}, so a new deposit cannot be withdrawn privately for now.`}{" "}
            Ragequit (public exit) works at any time.
          </SoftNote>
        )}

        <Checklist title="Before you can deposit" items={blockers} />

        <Button
          type="submit"
          className={CTA}
          disabled={busy || blockers.length > 0 || !wei}
        >
          {busy
            ? "Depositing…"
            : network
              ? `Deposit on ${network.shortName}`
              : "Deposit"}
        </Button>
      </form>

      <OpStatus kind="deposit" />

      {/* the next step of the first-time path, right after a deposit lands */}
      {deposited && (
        <InfoNote icon={Clock} title="Next: wait, then withdraw">
          Your note is in the pool.{" "}
          {delay > 0
            ? `It joins the association set about ${formatDelay(delay)} after the deposit (screening). `
            : ""}Withdrawing as soon as it can is
          easy to link by timing: wait for more deposits, then withdraw to a fresh address. The Withdraw tab&apos;s privacy check suggests how long.
        </InfoNote>
      )}

      <InfoNote icon={Eye} title="What stays public">
        Your depositing address, the amount and the time are visible on-chain, exactly like a normal transfer. What the pool hides is the link between this
        deposit and the withdrawal that later spends it.
      </InfoNote>
    </div>
  );
}
