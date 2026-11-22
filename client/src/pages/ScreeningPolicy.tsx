import { useMemo, type ReactNode } from "react";
import type { Address } from "viem";
import { Link } from "wouter";
import { ArrowLeft, ExternalLink, FileCheck2, Layers } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { namesList } from "@/components/pools/NetworkMenu";
import PoolsShell from "@/components/pools/PoolsShell";
import { short } from "@/components/pools/format";
import { poolHref, vaultHref } from "@/components/pools/types";
import { publisherDownClause, publisherStateWords, useASPStatuses } from "@/components/privacy/Screening";
import { CARD, INSET, QUIET_HOVER } from "@/components/privacy/ui";
import { trpc } from "@/lib/trpc";
import { explorerAddressUrl, PRIVACY_NETWORKS } from "@/privacy/config";
import { ETH_ASSET_LABEL, IS_ETHEREUM_MAINNET } from "@/privacy/environmentCopy";
import { fieldShort } from "@/privacy/format";
import { usePrivacy, type PoolState } from "@/privacy/PrivacyProvider";
import { inclusionDelay, type ASPStatusState } from "@/privacy/publicData";
import { pickPoolEntry, type NetworkSlug } from "@shared/privacy/networks";
import { ASP_POLICY_VERSION, checkCurrentRoot, EXCLUSION_REASON_CODES, EXCLUSION_REASONS, formatDelay } from "@shared/privacy/screening";

/**
 * Where to ask about an exclusion, once the owner names one (null: the page names none). Asking about an exclusion tells
 * the operator that the deposit is yours, and the page says so either way.
 */
const DISPUTE_CONTACT: { label: string; href: string } | null = null;

/** The confirmations a server applies by default (server/privacy/config.ts), when no status answer says otherwise. */
const DEFAULT_CONFIRMATIONS = 1;

/** "Robinhood Chain Testnet" (or, in a build with several networks, every one of them). */
const BUILT_FOR = namesList(PRIVACY_NETWORKS.map(n => n.network.name));

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

/** A live figure in running text; "(current value unavailable)" when it comes from the defaults. */
function Live({ value, known }: { value: string; known: boolean }) {
  return (
    <>
      <strong className="font-semibold text-foreground">{value}</strong>
      {!known && <span> (current value unavailable)</span>}
    </>
  );
}

/**
 * One pool's facts for the page, as plain values (no pool state or tree is passed between components: React's
 * development build logs changed props, and a tree's bigint arrays cannot be logged).
 */
interface PoolFacts {
  key: string;
  chainId: number;
  pool: Address;
  name: string;
  slug: NetworkSlug;
  status: ASPStatusState;
  delay: number;
  confirmations: number;
  /** the status answer gave these values */
  known: boolean;
  /** the current root as this device checks it from its own copy of the pool's events */
  current:
    | { kind: "checking" | "none" | "unknown" | "rejected" } | { kind: "verified"; members: number };
}

/** The pool's current root, checked on this device (no request): its member count when it verifies. */
function currentRootFact(state: PoolState): PoolFacts["current"] {
  if (state.scope === null) return { kind: "checking" };
  const c = checkCurrentRoot({ events: state.events, currentRoot: state.aspRoot });
  if (!c) return { kind: "none" };
  if (c.check.status === "verified") return { kind: "verified", members: c.check.set.memberCount };
  return { kind: c.check.status === "unknown" ? "unknown" : "rejected" };
}

/** How fast a new root follows, from what actually runs on the operator's server (never a promise it cannot keep). */
function publishSpeed(f: PoolFacts | null, name: string): string {
  const entry = f?.status.entry ?? null;
  const screening = f?.status.screening ?? null;
  if (!entry) return "The publisher then posts a new root: on a schedule while the operator's server runs it, and whenever a private withdrawal asks for one.";
  if (entry.canPublish === false) return `Right now ${publisherDownClause(entry.publishBlock, name)}, so deposits wait until it can post again.`;
  if (screening?.autoPublish.running) {
    return `The publisher then posts a new root within about ${formatDelay(screening.autoPublish.seconds)}, or sooner when a private withdrawal asks for one.`;
  }
  return "The publisher then posts a new root when a private withdrawal asks for one, or when the operator posts one.";
}

/** One pool's current values: from the operator's public status and this device's own check of the current root. */
function PoolValues({ f, multi }: { f: PoolFacts; multi: boolean }) {
  const entry = f.status.entry;
  const screening = f.status.screening;
  // the publisher's address, from the shell's public pool summary (every visitor's request; nothing new is sent)
  const pools = trpc.privacy.pools.useQuery({ interval: "24h" }, { enabled: false });
  const row = pickPoolEntry(pools.data?.pools, { chainId: f.chainId, pool: f.pool });
  const postman = row?.aspPostman ?? null;
  const postmanLink = postman ? explorerAddressUrl(f.chainId, postman) : null;
  const current = f.current;
  const rows: [string, ReactNode][] = [
    ["Waiting time", f.delay > 0 ? formatDelay(f.delay) : "none (a deposit joins once it is confirmed)"],
    ["Confirmations", f.confirmations.toLocaleString("en-US")],
    [
      "Publisher",
      postman ? (
        <span className="inline-flex flex-wrap items-center gap-x-2">
          {postmanLink ? (
            <a href={postmanLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-primary hover:underline">
              {short(postman)} <ExternalLink className="h-3 w-3" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          ) : (
            <span className="font-mono">{short(postman)}</span>
          )}
          {entry && (
            <span>{publisherStateWords(entry.canPublish, entry.publishBlock)}</span>
          )}
        </span>
      ) : (
        "—"
      ),
    ],
    ["Periodic publisher", !screening ? "—" : screening.autoPublish.running ? `every ${formatDelay(screening.autoPublish.seconds)}` : "not running on this server"],
    [
      "Current root",
      current.kind === "checking"
        ? "checking…"
        : current.kind === "none"
          ? "none posted yet"
          : current.kind === "verified"
            ? `${current.members.toLocaleString("en-US")} deposits, checked on this device`
            : current.kind === "unknown"
              ? "being checked on this device"
              : "does not follow these rules (this app does not prove against it)",
    ],
    ["Waiting for screening", screening ? screening.snapshot.waiting.toLocaleString("en-US") : "—"],
  ];
  const excluded = screening?.excluded ?? [];
  return (
    <section className={`${CARD} p-4`} aria-label={`Current values on ${f.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Layers className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold">{multi ? `Now on ${f.name}` : "Current values"}</h2>
        <Link
          href={poolHref(f.chainId, f.pool)}
          className="ml-auto rounded font-mono text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          pool {short(f.pool)}
        </Link>
      </div>
      <dl className="mt-4 flex flex-col divide-y divide-border/40 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
            <dt className="text-sm text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-words text-foreground sm:max-w-[60%] sm:text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4">
        <h3 className="text-xs font-medium text-muted-foreground">Excluded deposits{screening ? ` (${excluded.length.toLocaleString("en-US")})` : ""}</h3>
        {!screening ? (
          <p className="mt-1 text-sm text-muted-foreground">{f.status.status === "loading" ? "Loading…" : "The operator's list is unavailable right now."}</p>
        ) : excluded.length === 0 ? (
          <p className="mt-1 text-sm text-foreground">None</p>
        ) : (
          <ul className={`${INSET} mt-1.5 divide-y divide-border/40`}>
            {excluded.map(x => (
              <li key={`${x.leafIndex}:${x.label}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-xs">
                <span className="font-mono text-foreground">
                  leaf {x.leafIndex.toLocaleString("en-US")} ·{" "}
                  {/^[0-9]{1,80}$/.test(x.label) ? fieldShort(BigInt(x.label)) : "?"}
                </span>
                <span className="text-muted-foreground">
                  {EXCLUSION_REASONS[x.reason]?.title ?? "Unknown reason"}
                  {x.considered ? "" : " · never admitted"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        From the operator&apos;s public status (the operator says every visitor gets the same answer; your device cannot check that) and this
        device&apos;s own copy of the pool&apos;s events.
      </p>
    </section>
  );
}

/**
 * /pools/screening: the association set's screening policy in plain language, with each pool's current values. Public
 * data only: the shell's privacy.asp.status and privacy.pools copies (fetched for every visitor alike) and the pool
 * events this device already reads for every visitor. The page sends nothing of its own.
 */
export default function ScreeningPolicy() {
  const { pools, activePool } = usePrivacy();
  // the vault's network first (with one network: that one)
  const ordered = useMemo(() => {
    const active = pools.find(v => v.ref.key === activePool?.key);
    return active ? [active, ...pools.filter(v => v !== active)] : pools;
  }, [pools, activePool]);
  const refs = useMemo(() => ordered.map(v => v.ref), [ordered]);
  // each pool's status entry (the same chain and address, fresh), from the shell's copy
  const statuses = useASPStatuses(refs);
  const facts = useMemo<PoolFacts[]>(
    () =>
      ordered.map((v, i) => {
        const status = statuses[i];
        const screening = status.screening;
        return {
          key: v.ref.key,
          chainId: v.ref.chainId,
          pool: v.ref.pool,
          name: v.ref.network.name,
          slug: v.ref.network.slug,
          status,
          delay: inclusionDelay(screening, v.ref.chainId),
          confirmations: screening?.confirmations ?? status.entry?.confirmations ?? DEFAULT_CONFIRMATIONS,
          known: !!screening,
          current: currentRootFact(v.state),
        };
      }),
    [ordered, statuses],
  );
  const first = facts[0] ?? null;
  return (
    <PoolsShell>
      <div className="mx-auto w-full max-w-3xl space-y-6 pb-4">
        <header>
          <h1 className="flex items-center gap-2.5 font-display text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">
            <FileCheck2 className="h-6 w-6 text-primary" aria-hidden />{" "}
            Screening policy
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Version {ASP_POLICY_VERSION} · {BUILT_FOR} · {ETH_ASSET_LABEL}, not independently audited
          </p>
        </header>
        <PolicyText facts={facts} />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className={`rounded-full ${QUIET_HOVER}`}>
            <Link href={vaultHref(first?.slug ?? null)}>
              <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> Back to the vault
            </Link>
          </Button>
          {first && (
            <Button asChild variant="outline" className={`rounded-full ${QUIET_HOVER}`}>
              <Link href={poolHref(first.chainId, first.pool)}>See the pool&apos;s published roots</Link>
            </Button>
          )}
        </div>
      </div>
    </PoolsShell>
  );
}

/** The policy in plain language, with the live values of the pools (the vault's network first). */
function PolicyText({ facts }: { facts: readonly PoolFacts[] }) {
  const f = facts[0] ?? null;
  const name = f?.name ?? BUILT_FOR;
  const multi = facts.length > 1;
  const sameRules = facts.every(
    x => x.delay === f?.delay && x.confirmations === f?.confirmations);
  const delay = f?.delay ?? 0;
  const confirmations = f?.confirmations ?? DEFAULT_CONFIRMATIONS;
  const known = !!f?.known;
  const removalSpeed = f?.status.screening?.autoPublish.running && f.status.entry?.canPublish !== false ? "soon after the list changes" : "with the next root it posts";
  const confirmationWords = `${confirmations} confirmation${confirmations === 1 ? "" : "s"}`;

  return (
    <>
      <p className="text-sm leading-relaxed text-foreground">
        Hylsia lets you withdraw privately only from deposits in the pool&apos;s association set: a public list of deposits the operator has screened.
        This page explains how a deposit gets into that list, how it can be taken out, and the requirements and privacy tradeoffs of the public exit.
      </p>

      <Section title="Who screens">
        <p>
          Hylsia&apos;s operator runs the association-set publisher. It posts the root of the list to the pool contract. The contract accepts a
          private withdrawal only if it proves membership in one of the last 16 roots it was given. The publisher&apos;s address is under the current
          values below.
        </p>
      </Section>

      <Section title="How a deposit joins">
        <p>
          {delay > 0 ? (
            <>
              A deposit becomes eligible once it is{" "}
              <Live value={formatDelay(delay)} known={known} /> old, counted from the time of the block it was mined
              in, and has{" "}
              <Live value={confirmationWords} known={known} />.
            </>
          ) : (
            <>
              A deposit joins the set once it has{" "}
              <Live value={confirmationWords} known={known} />; on {name} there is no extra wait.
            </>
          )}{" "}
          {multi && !sameRules ? `These values are for ${name}; each network's are below. ` : ""}
          {publishSpeed(f, name)} Until then your vault shows the deposit as &quot;Waiting for screening&quot; (&quot;Joins next root&quot; once it is
          eligible), and your app withdraws it privately only once the association set on-chain includes it. Deposits join in the order they were made.
          You do not need to ask, and your app never tells the server which deposit is yours.
          {delay > 0 && " The wait exists so that a deposit can be checked against the exclusion list before it can leave privately."}
        </p>
      </Section>

      <Section title="What keeps a deposit out, or takes it out later">
        <p>
          The operator keeps an exclusion list. A deposit is left out of the set, or removed from it, if the deposit itself or the address that made it is
          on that list, for one of these reasons:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          {EXCLUSION_REASON_CODES.map(code => (
            <li key={code}>
              <span className="font-medium text-foreground">{EXCLUSION_REASONS[code].title}:</span>{" "}
              {EXCLUSION_REASONS[code].text}
            </li>
          ))}
        </ul>
        <p>
          If a deposit already in the set is excluded, the publisher posts a new root without it, {removalSpeed}. If an exclusion is lifted, the deposit is
          back in the set with the next root, with no new wait.
        </p>
      </Section>

      <Section title="What exclusion means for you">
        <p>
          An excluded deposit cannot be withdrawn privately with this app. Your money is not frozen: the public exit (ragequit) returns the deposit to the
          address that made it, without ASP approval. It requires the
          unspent note and its proof, access to the original depositor's wallet,
          and ETH there for gas. It
          is public: anyone can see which deposit the exit belongs to. If you already withdrew part of the deposit privately, the rest (your change note)
          is excluded too, and its exit also shows which deposit that earlier withdrawal came from. Once a root&apos;s on-chain record lists the deposit
          as excluded, your vault marks it &quot;Excluded: use the public exit&quot; and shows the reason the operator gives.
        </p>
      </Section>

      <Section title="What is public">
        <p>
          These rules, the waiting time and the confirmations. For every root, which deposits it counts and which it leaves out, written into the
          root&apos;s own on-chain record, so anyone can check the list against the deposits on the chain. The list of excluded deposits in this pool,
          with the reason for each (below). Not public: the operator&apos;s notes about an exclusion, and listed addresses that never deposited into this
          pool.
        </p>
      </Section>

      <Section title="What the operator does not learn">
        <p>
          Screening uses public chain data only. Whether your deposit is waiting, in the set or excluded is worked out on your device, from the
          pool&apos;s on-chain records (the same for everyone) and the operator&apos;s published exclusion list. Your app builds its own proof, no
          request it sends names the deposit it spends, and it starts a private withdrawal only for a deposit the association set on-chain already
          holds. The operator&apos;s status could differ for each visitor, so an exclusion it announces but no root on the chain shows yet only holds
          your app back for that deposit, and never makes it suggest the public exit. Your app also leaves such deposits out of the crowd it counts,
          and asks before you withdraw when that leaves a small crowd, or one much smaller than a recent root&apos;s. Access metadata,
          targeted exclusions and whether you retry can still support inference
          about your deposit; omitting an explicit note identifier does not
          prevent that.
        </p>
      </Section>

      <Section title="If you think an exclusion is wrong">
        <p>
          Only the operator can lift an exclusion, and a lifted exclusion takes effect with the next root. Asking the operator about an exclusion tells
          it that the deposit is yours.
          {DISPUTE_CONTACT && (
            <>
              {" "}
              Contact:{" "}
              <a href={DISPUTE_CONTACT.href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
                {DISPUTE_CONTACT.label}
              </a>
              .
            </>
          )}
        </p>
      </Section>

      <Section title="Limits">
        <p>
          The contract also accepts proofs against older roots, up to 15 roots back. After a removal, someone using a modified app could still withdraw
          that deposit privately against an older root until 15 newer roots are posted; when few deposits arrive, that can take days, or stay open
          indefinitely if no new deposits arrive. This app always uses the newest root. Screening is only as good as the exclusion list: a deposit nobody
          reported is admitted. This is {IS_ETHEREUM_MAINNET ? "a technical screening policy" : "a testnet policy"}, not a legal clearance: it does not certify any deposit, and nobody outside Hylsia reviews it. A
          change to these rules gets a new version number on this page.
        </p>
      </Section>

      {facts.map(x => (
        <PoolValues key={x.key} f={x} multi={multi} />
      ))}
    </>
  );
}
