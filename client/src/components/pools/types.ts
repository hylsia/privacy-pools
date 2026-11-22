import { MULTI_NETWORK } from "@/privacy/config";
import type { PoolDetailAnswer, PoolsAnswer, PoolSummaryEntry, PublisherBlock } from "@shared/privacy/api";
import { networkById } from "@shared/privacy/networks";

/** privacy.pools: every served network's pool (shared/privacy/api.ts). */
export type PoolsResponse = PoolsAnswer;
/** One pool's row; `now` is that chain's head time, so ages are worked out per row. */
export type PoolRow = PoolSummaryEntry;
export type PoolActivityRow = PoolRow["recent"][number];
export type PoolDetailResponse = PoolDetailAnswer;
export type PoolHealth = PoolDetailResponse["health"];

/**
 * The relayer can send a withdrawal now: the pool has one, and the server does not report it unavailable (its own
 * key's gas balance below one withdrawal). A server that does not report it counts as available, as before.
 */
export function relayerUp(p: { relayer: string | null; relayerAvailable?: boolean }): boolean {
  return p.relayer !== null && p.relayerAvailable !== false;
}

/**
 * The server's association-set publisher can post a root now. While it cannot (its own key's gas balance below one
 * publish, or no key for the pool), a deposit that no published root covers waits for it; ragequit always works. A
 * server that does not report it counts as able, as before.
 */
export function publisherUp(p: { aspCanPublish?: boolean }): boolean {
  return p.aspCanPublish !== false;
}

/** The publisher's governance note (pool page, quick view): its role, or why it cannot post a root right now. */
export function publisherNote(p: { aspCanPublish?: boolean; aspPublishBlock?: PublisherBlock | null }): string {
  if (publisherUp(p)) return "publishes the association-set root";
  return p.aspPublishBlock === "publisher_unfunded"
    ? "temporarily unable to post roots (too little testnet ETH for gas)"
    : p.aspPublishBlock === "policy_error"
      ? "publishing paused until the operator fixes a problem with its screening list"
      : "this app's server cannot post roots for it right now";
}

/**
 * The relayer's note while it cannot send a withdrawal. Paying your own gas is offered as the way round only while the
 * publisher can post roots: otherwise a deposit no root covers waits whatever the route.
 */
export function relayerDownNote(p: { aspCanPublish?: boolean }): string {
  return publisherUp(p) ? "temporarily unavailable; paying your own gas still works" : "temporarily unavailable";
}

/** The pool's newest deposits wait for the publisher before a private withdrawal: said next to every pointer at a deposit. */
export const PUBLISHER_WAIT_NOTE =
  "Right now the association-set publisher cannot post roots, so a new deposit waits for it before a private withdrawal; ragequit works at any time.";

// ─── links ────────────────────────────────────────────────────────────────────

/** A pool page: /pools/<network slug>/<address> (a chain the registry does not know keeps its number). */
export function poolHref(chainId: number, pool: string): string {
  return `/pools/${networkById(chainId)?.slug ?? chainId}/${pool}`;
}

/**
 * A vault link that opens on one network. The network rides in the hash only: the app reads it once and strips it,
 * and a browser never sends a hash to a server. A build with one network has nothing to choose, so its links carry
 * no hash.
 */
export function vaultHref(slug: string | null, action?: "withdraw"): string {
  return `/pools/vault${action ? `?action=${action}` : ""}${slug && MULTI_NETWORK ? `#network=${slug}` : ""}`;
}

export const INTERVALS = ["1h", "4h", "12h", "24h", "7d"] as const;
export type Interval = (typeof INTERVALS)[number];

/**
 * The dashboard's privacy-pool vocabulary: one label and one plain explanation per figure, shared by the
 * top bar, the pools table, the quick view and the pool page. (Data fields keep their names, e.g. `tvl`.)
 */
export const TERMS = {
  anonymity: {
    label: "Anonymity set",
    hint: "Deposits under the published association-set root, the set a private withdrawal proves its deposit belongs to. It could have come from any of them that holds enough. Amounts and timing can narrow it; the withdraw form checks this before you send.",
  },
  trend: {
    label: "Trend",
    hint: "Pool balance over the selected interval. Each tick underneath shows whether more was deposited or withdrawn (ragequits included) in that slice of time.",
  },
  balance: {
    label: "Pool balance",
    hint: "ETH currently held by the pool contract. Amounts are public; who owns each note is not.",
  },
  activity: {
    label: "Activity",
    hint: "Deposits, withdrawals and ragequits in the selected interval: transactions first, ETH moved second. Steady activity gives withdrawals more cover.",
  },
  net: {
    label: "Net deposits",
    hint: "Deposits minus withdrawals and ragequits in the selected interval.",
  },
  withdrawals: {
    label: "Withdrawals",
    hint: "Private withdrawals since deployment. Public ragequits are counted separately.",
  },
  fee: {
    label: "Relayer fee",
    hint: "The relayer's share of each withdrawal, sealed into the proof. The relayer pays the gas, so the recipient never needs a funded wallet. Without a relayer you can pay your own gas (from your wallet), but the gas payer is visible.",
  },
  feesPaid: {
    label: "Relayer fees paid",
    hint: "Paid to the relayer out of withdrawn amounts. The relayer pays the gas, so the recipient never needs a funded wallet.",
  },
} as const;

export type ColumnKey = "anonymity" | "trend" | "balance" | "activity" | "net" | "withdrawals" | "fee" | "age" | "status";
/** Table columns, in display order. */
export const COLUMNS: { key: ColumnKey; label: string; hint: string }[] = [
  { key: "anonymity", ...TERMS.anonymity },
  { key: "trend", ...TERMS.trend },
  { key: "balance", ...TERMS.balance },
  { key: "activity", ...TERMS.activity },
  { key: "net", ...TERMS.net },
  { key: "withdrawals", ...TERMS.withdrawals },
  { key: "fee", ...TERMS.fee },
  { key: "age", label: "Age", hint: "Time since the pool contract was deployed." },
  {
    key: "status",
    label: "Status",
    hint: "Open: takes deposits and private withdrawals (the publisher posts the first association-set root once a deposit has passed screening). Awaiting association set: the publisher cannot post a root right now, so private withdrawals of deposits no root covers wait; ragequit works. Publisher unavailable, under the status: the same wait for deposits made after the last root. Deposits closed: no new deposits; withdrawals and ragequit still work.",
  },
];

export type SortKey = "anonymity" | "balance" | "activity" | "net" | "withdrawals" | "fee" | "age";
export const SORTS: { key: SortKey; label: string }[] = [
  { key: "anonymity", label: TERMS.anonymity.label },
  { key: "balance", label: TERMS.balance.label },
  { key: "activity", label: TERMS.activity.label },
  { key: "net", label: TERMS.net.label },
  { key: "withdrawals", label: TERMS.withdrawals.label },
  { key: "fee", label: TERMS.fee.label },
  { key: "age", label: "Age" },
];
export type SortDir = "desc" | "asc";
/** Columns whose header sorts the table, and the sort each one applies. */
export const COLUMN_SORT: Partial<Record<ColumnKey, SortKey>> = {
  anonymity: "anonymity",
  balance: "balance",
  activity: "activity",
  net: "net",
  withdrawals: "withdrawals",
  fee: "fee",
  age: "age",
};
