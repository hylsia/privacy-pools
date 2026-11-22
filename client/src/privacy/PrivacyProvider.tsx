/**
 * PrivacyProvider — client-side state machine for the Privacy Pools on every network this build offers (Robinhood
 * Chain Testnet; local builds may add local chains, and Robinhood Chain mainnet comes later). One vault (one seed)
 * covers the networks of the selected protocol profile; each pool has its own notes and anonymity set. Testnet v1
 * and native ETH v2 profiles reload separately and keep different vaults and backups. There is no bridge between them.
 *
 * Secrets (seed, master keys, note secrets, witnesses) live only in React state for the unlocked session. Storage
 * holds the *encrypted* vault, each pool's public event cache, each pool's deposit-index reservations and one device
 * activity log (client/src/privacy/migrate.ts lists the keys). The log pairs your deposits with your withdrawal
 * recipients, so it and the reservations are encrypted with a key derived from the seed (activityStore.ts: HKDF to a
 * non-extractable AES-GCM key, held in memory only while the vault is unlocked). Nothing of the log is read before
 * unlock; it is deleted when the vault is forgotten, a new one is created or another one is restored.
 *
 * What leaves the device (final design §1 "Never leak"):
 *   - Public pool data is read for every pool of the build on one schedule (on mount, then every 45 s), for every
 *     visitor, whatever the vault holds or which network is active. A network without a pool is never contacted.
 *   - The active pool lives in memory only. A public application environment may be selected in the URL; that
 *     reloads a separate protocol profile and does not contain note data. `#network=<slug>` picks a pool once and is stripped.
 *   - Nothing secret is ever sent to the Hylsia server, and neither is the label of the note being spent: the
 *     association-set Merkle proof is built on this device from public events (shared/privacy/associationSet.ts)
 *     and checked against the pool's current root, whose member list (its recipe, under the screening policy) the
 *     device rebuilds and verifies itself. Whether a withdrawal asks for a newer root depends on every pool's public
 *     data only (publishNeeded: the operator's rootDue from the privacy.asp.status copy every visitor fetches, else
 *     the open policy's rule), so that request is the same for every withdrawal on every network and names none. It is
 *     sent only after the note was found in the checked current root and the questions about its crowd were answered,
 *     so nothing after it depends on the note (resolveAssociationProof). The record request (privacy.asp.set) is
 *     input-less too, and is sent only when the device lacks the current root's event and the status answer's record
 *     does not rebuild to it. A relayed withdrawal does name its network to the relayer, which sends it there.
 *   - Every transaction is signed for its own operation's chain: writes pass that chain to viem, which checks the
 *     wallet's network right before sending, and receipts are read from that chain's RPC.
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { getAccount, getWalletClient, switchChain } from "wagmi/actions";
import { zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { trpc } from "@/lib/trpc";
import { protocolRuntime } from "@shared/privacy/runtime";
import { isV2Protocol } from "@shared/privacy/protocols";
import type {
  ASPStatusAnswer,
  AssociationSetsAnswer,
  PublishAnswer,
  PublishResult,
  RelayerQuote,
  RelayerQuotesAnswer,
  RelaySubmitAnswer,
} from "@shared/privacy/api";
import { AssociationProofError, resolveAssociationProof, type WithdrawalQuestion } from "@shared/privacy/associationSet";
import { announcedExclusions, formatDelay, type ShrinkAlarm } from "@shared/privacy/screening";
import { computeContext } from "@shared/privacy/context";
import {
  buildStateTree,
  fetchPoolEvents,
  headRegression,
  mergePoolEvents,
  nextScanRange,
  privateBalance,
  SCAN_CONCURRENCY,
  spendableNotes,
} from "@shared/privacy/indexer";
import { parseSnapshot, snapshotPath, verifySnapshotAgainstChain, type PoolSnapshot } from "@shared/privacy/snapshot";
import { MerkleTree } from "@shared/privacy/merkleTree";
import { samePool, type NetworkInfo, type NetworkProblem, type PoolKey } from "@shared/privacy/networks";
import type { MasterKeys, Note } from "@shared/privacy/notes";
import { proveCommitment, proveWithdraw } from "@shared/privacy/prover";
import {
  COMMITMENT_PUBLIC_SIGNALS,
  WITHDRAW_PUBLIC_SIGNALS,
  type BackupFile,
  type Groth16ProofCalldata,
  type PoolEvent,
} from "@shared/privacy/types";
import { VaultError } from "@shared/privacy/vault";
import {
  createReservations,
  createSerialWriter,
  deriveActivityKey,
  loadActivityLog,
  allocateDepositIndex,
  retireReservations,
  writeActivityLog,
  type LogEntry,
  type LogSession,
  type Reservation,
  type ReservationUpdate,
} from "./activityStore";
import { loadArtifacts, type LoadProgress } from "./artifacts";
import {
  DEVICE_KEYS,
  MULTI_NETWORK,
  PRIVACY_NETWORKS,
  PRIVACY_POOLS,
  PRIVACY_PROTOCOL,
  poolBySlug,
  poolRefByKey,
  poolStorageKey,
  publicClientFor,
  type PoolRef,
} from "./config";
import { checkedRelayerFee, remoteRelayerClient, selectedRelayer, validRelayerQuote, type RelayerEntry } from "./relayers";
import { clearActivityStorage, clearPendingDeposits, forgetDeviceStorage, migrateLegacyStorage } from "./migrate";
import { activeASPStatus, forgetAnnouncedSightings, inclusionDelay, publishNeeded, statusRecord } from "./publicData";
import { loadJSON, remove, saveJSON } from "./storage";
import {
  classifyWalletError,
  isReceiptTimeout,
  SELF_RELAY_PROOF_LOST,
  sentOnOtherNetworkMessage,
  walletChainMessage,
  WalletChainFailure,
  walletNetworkName,
  type WalletChainError,
} from "./walletChain";
import { createLockGate, waitInRounds } from "./unlockedWork";
import { privacyWagmiConfig } from "./wagmi";
import { setWalletReadChain } from "./walletGuard";
import { publishWalletRoot } from "./publishRoot";

const RUNTIME = protocolRuntime(PRIVACY_PROTOCOL);
const { abi: PRIVACY_POOL_ABI, discover: discoverNotes, deriveMasterKeys,
  encryptSeed: encryptSeedV2, decryptSeed, generateSeed, parseBackup, seedFingerprint } = RUNTIME;

// ─────────────────────────────── types ───────────────────────────────

export type VaultStatus = "none" | "locked" | "unlocked";

export interface VaultState {
  status: VaultStatus;
  backup: BackupFile | null;
  fingerprint: string | null;
  backupVerified: boolean;
}

export interface PoolState {
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  scope: bigint | null;
  aspRoot: bigint;
  lastRoot: bigint;
  leafCount: number;
  dead: boolean;
  minDeposit: bigint;
  events: PoolEvent[];
  lastBlock: bigint;
  tree: MerkleTree | null;
  inSync: boolean;
  syncedAt: number | null;
  /**
   * false while this device's copy started from the site's static snapshot (shared/privacy/snapshot.ts): its tree
   * events are checked against the chain, but the rest of the history before the snapshot's block (ragequits,
   * association-set roots) waits for the full scan that runs right after. Private withdrawals are held until then.
   */
  historyVerified: boolean;
}

export interface NotesState {
  list: Note[];
  nextDepositIndex: number;
  conflicts: number[];
}

export type OpStage =
  | "idle"
  | "preparing"
  | "awaiting_wallet"
  | "downloading"
  | "proving"
  | "submitting"
  | "pending"
  | "confirmed"
  | "failed";

export interface OpState {
  kind: "deposit" | "withdraw" | "ragequit" | null;
  stage: OpStage;
  message?: string;
  progress?: LoadProgress;
  txHash?: Hex;
  error?: string;
  /**
   * withdrawals: the crowd of the association set the proof is made against, once that proof is built: its members
   * minus those whose exclusion the operator's status announces (`announcedOut`)
   */
  crowd?: number;
  /** withdrawals: members of that root the crowd leaves out because the operator announces their exclusion */
  announcedOut?: number;
  /** the operation's network and pool, from its start (its transaction and explorer link are on that network) */
  chainId?: number;
  pool?: Address;
}

export interface Activity {
  id: string;
  kind: "deposit" | "withdraw" | "ragequit";
  status: "pending" | "confirmed" | "failed";
  txHash?: Hex;
  createdAt: number;
  updatedAt: number;
  amountWei: bigint;
  feeWei?: bigint;
  recipient?: Address;
  via?: "relayer" | "self";
  error?: string;
  /** the network and pool the operation ran on */
  chainId: number;
  pool: Address;
}

/** What unlocking found in this device's stored log (the Activity panel says so). */
export interface ActivityNotice {
  /** a stored log did not decrypt with this vault's key (changed, damaged or another vault's): it is set aside, unread */
  setAside: boolean;
  /** this unlock found an older plaintext log that could not be read, and deleted it unread */
  unreadableRemoved: boolean;
}

/**
 * When a withdrawal question comes (associationSet.ts WithdrawalQuestion): `beforeRequest`, before any request about
 * the withdrawal (nothing sent yet but label-free reads); `publishes`, the withdrawal asks (or asked) for a newer root.
 */
export interface QuestionContext {
  beforeRequest: boolean;
  publishes: boolean;
}

/**
 * The small-set question's numbers: `expected`, the crowd the form showed; `onChain`, the members of the root on-chain
 * the crowd is counted from; `announced`, those of them the operator's status announces for exclusion (the crowd is
 * onChain - announced; with announced > 0 the texts give both numbers, never the crowd as the set on-chain).
 */
export interface SmallSetContext extends QuestionContext {
  expected: number | null;
  onChain: number;
  announced: number;
}

export interface WithdrawParams {
  note: Note;
  amountWei: bigint;
  recipient: Address;
  via: "relayer" | "self";
  /**
   * Asked when the crowd the withdrawal would hide in has fewer than SMALL_ASSOCIATION_SET deposits: an observer could
   * narrow the withdrawal to one of them (1 names the deposit). Asked about the current root before any request the
   * operator sees (`beforeRequest`), so a request for a newer root never goes out from a crowd this small without a
   * yes. Resolve true to go on. Without it such a withdrawal is refused.
   */
  confirmSmallSet?: (size: number, o: SmallSetContext) => Promise<boolean>;
  /**
   * Asked when the crowd the withdrawal would hide in is far smaller than the largest of the pool's last 16 different
   * roots, than the current root itself (members the operator announces for exclusion are counted out), both before
   * any request the operator sees, or, once the withdrawal's own request for a newer root was answered, than the crowd
   * the form showed (basis "form") (shared/privacy/screening.ts shrinkAlarm): a publisher could shrink the set around
   * a withdrawal. It also covers the small-set question when the shrunk set is small. Resolve true to go on. Without
   * it such a withdrawal is refused.
   */
  confirmShrink?: (alarm: ShrinkAlarm, o: QuestionContext) => Promise<boolean>;
  /**
   * The crowd the withdraw form showed (previewAssociationSet: the next root's when the withdrawal asks for one, else
   * the current root's; both without announced exclusions; the same for every note the form lets start). When the
   * proof's crowd is materially smaller, confirmShrink is asked with the real number (basis "form") before anything is
   * sent to the relayer or the wallet.
   */
  expectedCrowd?: number | null;
  /** The maximum relayer fee displayed when the form was submitted, kept on this device only. */
  maxRelayerFeeWei?: bigint;
  /** the note's pool (a registry key); default: the active pool */
  poolKey?: PoolKey;
}

/** One registry pool: its state, the vault's notes in it (rediscovered with its own scope), and their totals. */
export interface PoolView {
  ref: PoolRef;
  state: PoolState;
  notes: NotesState;
  spendable: Note[];
  balance: bigint;
}

/** One network this build offers. `pool` null with `problem` null: not deployed yet; with a problem: unavailable. */
export interface NetworkView {
  network: NetworkInfo;
  pool: PoolView | null;
  problem: NetworkProblem | null;
}

export interface PrivacyContextValue {
  /** the build has at least one usable pool */
  configured: boolean;
  /** the active pool's state (empty when there is none) */
  pool: PoolState;
  vault: VaultState;
  keys: MasterKeys | null;
  /** the vault's notes in the active pool */
  notes: NotesState;
  spendable: Note[];
  /** private balance in the active pool (never a sum across networks) */
  balance: bigint;
  /** every network this build offers, in registry order (Robinhood Chain Testnet first) */
  networks: NetworkView[];
  /** every registry pool, in registry order */
  pools: PoolView[];
  /** the network the vault acts on; in memory only */
  activePool: PoolRef | null;
  /** registry keys only; false while an operation is in flight (or for a key outside the registry) */
  setActivePool: (key: PoolKey) => boolean;
  /** an operation is between its start and confirmed or failed */
  busy: boolean;
  /** lowercase depositor addresses of this vault's deposits on every network (an address is the same on each) */
  ownDepositors: ReadonlySet<string>;
  /**
   * This device's activity log, newest first, every network. Stored encrypted with a key from the seed: read and
   * decrypted only once the vault is unlocked, empty while it is locked, deleted by forgetVault.
   */
  activity: Activity[];
  /** what unlocking found in the stored log; nothing while the vault is locked */
  activityNotice: ActivityNotice;
  /** deletes a set-aside log (one that did not decrypt with this vault's key) from this device, unread */
  discardSetAsideLog: () => void;
  op: OpState;
  /** every registry pool (Promise.allSettled), or the one `poolKey` names */
  sync: (opts?: { full?: boolean; poolKey?: PoolKey }) => Promise<void>;
  createVault: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  /**
   * Locks now (true). While an operation of this vault is in flight, it locks as soon as that operation has finished
   * and written its outcome with the vault's key (false; `lockPending` is true until then).
   */
  lock: () => boolean;
  /** a lock was asked for while an operation ran, and happens when it has finished */
  lockPending: boolean;
  exportBackup: () => void;
  verifyBackup: (fileText: string, password: string) => Promise<void>;
  importBackup: (fileText: string, password: string) => Promise<void>;
  forgetVault: () => void;
  /** into the `poolKey` pool, default the active one */
  deposit: (amountWei: bigint, poolKey?: PoolKey) => Promise<void>;
  withdraw: (params: WithdrawParams) => Promise<void>;
  ragequit: (note: Note, poolKey?: PoolKey) => Promise<void>;
  resetOp: () => void;
  /** Publisher wallet explicitly signs a verified public root; no service key is sent to the server. */
  publishEligibilityRoot: () => Promise<Hex | null>;
}

// ───────────────────────────── helpers ───────────────────────────────

/**
 * The site's static snapshot of a pool's tree events (shared/privacy/snapshot.ts), checked offline and then against
 * the chain: its last block must exist with the same hash on this RPC's chain (no other chain, no reorg below it).
 * null when there is none, it does not pass, or it is ahead of the RPC. The same file for every visitor, no input.
 */
async function loadSnapshot(ref: PoolRef, client: PublicClient, head: bigint): Promise<PoolSnapshot | null> {
  // V1 snapshots do not authenticate v2 recovery nonces. V2 always reads complete RPC history.
  if (isV2Protocol(ref.protocol)) return null;
  try {
    const res = await fetch(snapshotPath(ref.chainId, ref.pool), { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer", redirect: "error" });
    if (!res.ok) return null;
    const parsed = parseSnapshot(await res.text(), { chainId: ref.chainId, pool: ref.pool, deployBlock: ref.deployBlock });
    if (!parsed.ok) {
      console.warn(`[privacy] the site's snapshot of the ${ref.network.name} pool is not used: ${parsed.error}`);
      return null;
    }
    const snap = parsed.snapshot;
    return (await verifySnapshotAgainstChain(snap, client, head)) ? snap : null;
  } catch {
    return null; // no snapshot, or the RPC could not confirm its block: the usual full scan
  }
}

const emptyPool: PoolState = {
  status: "idle",
  scope: null,
  aspRoot: 0n,
  lastRoot: 0n,
  leafCount: 0,
  dead: false,
  minDeposit: 0n,
  events: [],
  lastBlock: 0n,
  tree: null,
  inSync: false,
  syncedAt: null,
  historyVerified: true,
};

const EMPTY_NOTES: NotesState = { list: [], nextDepositIndex: 0, conflicts: [] };
const NO_NOTES: Note[] = [];

/** What `activity` exposes while the vault is locked (one constant, so consumers do not re-render). */
const NO_ACTIVITY: Activity[] = [];
const NO_NOTICE: ActivityNotice = { setAside: false, unreadableRemoved: false };

/** The unlocked vault's log: its key and fingerprint (LogSession), and the vault it belongs to. */
interface ActivitySession extends LogSession {
  /** Forget, create and restoring another vault start a new epoch: a write from an older one never lands. */
  epoch: number;
  /**
   * This opening of the log (a new number at each unlock). Work that outlives a moment (an operation, the pending
   * check) keeps this number, never the session, and finds the session again when it writes: after a lock or Forget
   * there is none, so the key is not kept alive by that work.
   */
  opened: number;
  /** older plaintext logs merged in whose encrypted write failed: deleted after the next write succeeds */
  plaintextLeft: string[];
}

const OUT_OF_SYNC = "Local state does not match the pool. Re-sync before withdrawing.";
/** The publish step's status line; with several networks it says the one request covers them all (final design §6). */
const PUBLISH_MESSAGE = MULTI_NETWORK
  ? "Asking the association-set publisher for the roots that are due (any withdrawal, on any network, would ask now; it says nothing about yours)"
  : "Asking the association-set publisher for the root that is due (any withdrawal would ask now; it says nothing about yours)";
const RECEIPT_TIMEOUT_MS = 300_000;
/** the pending check after unlock waits for a receipt in rounds this long, and stops after the round once the vault is locked */
const RECHECK_ROUND_MS = 15_000;
/** how long a withdrawal waits for a root the publisher posted but whose receipt was not in yet */
const PUBLISH_WAIT_MS = 120_000;
const SYNC_EVERY_MS = 45_000;
/** the initial choice may follow the wallet's chain while its connection is restored, for this long at most */
const WALLET_CHOICE_MS = 5_000;
/** a log entry left pending without a transaction (the page was left before the wallet answered) */
const INTERRUPTED =
  "Interrupted by a page reload before a transaction was seen. Nothing more is sent from this app; if one was sent, your notes show it after the next sync.";
/** the vault this tab opened is no longer the one stored on this device (forgotten or replaced, here or in another tab) */
const VAULT_CHANGED = "The vault on this device changed meanwhile, possibly in another tab. Nothing was sent. Reload the page and try again.";
/** a deposit's pool holds reservations this vault cannot decrypt: they are never overwritten, so the deposit waits */
const foreignReservations = (name: string) =>
  `This device holds deposit reservations for ${name} that this vault cannot decrypt: another vault may be open in another tab, or they were changed. Nothing was sent. Close other Hylsia tabs and try again; if this stays, lock the vault and restore it from its backup file, which clears them.`;

/** The network a single-network build used: log entries from before the move without a chainId are checked there. */
const LEGACY_CHAIN_ID = PRIVACY_NETWORKS[0].network.chainId;
const LEGACY_POOL: Address = PRIVACY_NETWORKS[0].pool?.pool ?? zeroAddress;

type WalletAction = "deposit" | "withdraw" | "exit";
type WalletClient = Awaited<ReturnType<typeof getWalletClient>>;

interface PoolSlot {
  state: PoolState;
  notes: NotesState;
}
type Slots = Readonly<Record<string, PoolSlot>>;

const errorMessage = (err: unknown): string => {
  if (err instanceof VaultError || err instanceof WalletChainFailure) return err.message;
  const e = err as { shortMessage?: string; message?: string };
  return e?.shortMessage ?? e?.message ?? String(err);
};

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function deviceStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * Whether the vault stored on this device right now is the one with this fingerprint. Another tab may have forgotten
 * or replaced it; a tab still holding the old vault then writes nothing of it (its log, its reservations). True when
 * storage cannot be read: nothing can be written there either.
 */
function storedVaultIs(fingerprint: string): boolean {
  const store = deviceStorage();
  let raw: string | null;
  try {
    if (!store) return true;
    raw = store.getItem(DEVICE_KEYS.vault);
  } catch {
    return true;
  }
  try {
    return (
      raw !== null && (JSON.parse(raw) as { fingerprint?: unknown } | null)?.fingerprint === fingerprint
    );
  } catch {
    return false;
  }
}

let migrated = false;
/** The one-time storage move (migrate.ts), before the provider reads storage. Silent; a failure leaves the old keys. */
function migrateOnce() {
  if (migrated) return;
  migrated = true;
  const store = deviceStorage();
  if (!store) return;
  try {
    migrateLegacyStorage(store, PRIVACY_POOLS);
  } catch {
    /* storage full or blocked: the legacy keys stay as they were */
  }
}

function initialSlots(): Slots {
  const out: Record<string, PoolSlot> = {};
  for (const ref of PRIVACY_POOLS) {
    const cached = loadJSON<{ protocol?: unknown; events?: unknown; lastBlock?: unknown } | null>(poolStorageKey(ref, "events"), null);
    const usable = !!cached && Array.isArray(cached.events) && typeof cached.lastBlock === "bigint"
      && (!isV2Protocol(ref.protocol) || cached.protocol === ref.protocol);
    out[ref.key] = {
      state: usable ? { ...emptyPool, events: cached!.events as PoolEvent[], lastBlock: cached!.lastBlock as bigint } : emptyPool,
      notes: EMPTY_NOTES,
    };
  }
  return out;
}

/** A decrypted log entry, tagged with its network (entries from before the move: the legacy build chain). */
const toActivity = (e: LogEntry): Activity =>
  ({
    ...e,
    chainId: typeof e.chainId === "number" ? e.chainId : LEGACY_CHAIN_ID,
    pool: typeof e.pool === "string" ? e.pool : LEGACY_POOL,
  }) as Activity;

/** The vault's notes in one pool, found with that pool's own scope (a note never shows up in another pool). */
function discover(k: MasterKeys | null, ref: PoolRef, state: PoolState): NotesState {
  if (!k || state.scope === null) return EMPTY_NOTES;
  const res = discoverNotes(k, ref.scope, state.events);
  return { list: res.notes, nextDepositIndex: res.nextDepositIndex, conflicts: res.conflicts };
}

/**
 * A vault as v2 (one vault for every network, naming none), re-encrypted with the same password: the fingerprint is
 * the seed's, so it and the verified state stay. A v1 file the person exported still imports.
 */
async function asV2(seed: Uint8Array, password: string, backup: BackupFile): Promise<BackupFile> {
  if (backup.version === 2) return backup;
  try {
    const v2 = await encryptSeedV2(seed, password);
    return v2.fingerprint === backup.fingerprint ? v2 : backup;
  } catch {
    return backup; // keep the v1 blob; the next unlock tries again
  }
}

/** The pool hosted on a chain, if the registry has one there. */
const poolOnChain = (chainId: number | null | undefined): PoolRef | null =>
  typeof chainId === "number" ? (PRIVACY_POOLS.find(r => r.chainId === chainId) ?? null) : null;

/**
 * `#network=<slug>` from an in-app link: read once, then the hash is removed from the URL (replaceState), so the
 * choice never stays in the address bar or the history entry. undefined: the hash names no network; null: it names
 * one without a pool in this build.
 */
function takeNetworkHash(): PoolRef | null | undefined {
  if (typeof window === "undefined") return undefined;
  const m = /(?:^#|&)network=([^&]*)/.exec(window.location.hash);
  if (!m) return undefined;
  try {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  } catch {
    /* ignore */
  }
  let slug = m[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    /* keep it as it is */
  }
  return poolBySlug(slug);
}

/**
 * The pool's header, read through that network's own client. Its SCOPE must be the registry's computeScope(pool,
 * chainId): otherwise this app's pool record (or the RPC's chain) is not the contract, and the pool's actions stay
 * disabled.
 */
async function readPoolHeader(ref: PoolRef) {
  const c = publicClientFor(ref.chainId);
  const address = ref.pool;
  if (isV2Protocol(ref.protocol) && await c.readContract({ address, abi: PRIVACY_POOL_ABI, functionName: "PROTOCOL_VERSION" }) !== ref.protocol) {
    throw new Error("The pool contract does not match this app's selected protocol");
  }
  const [scope, aspRoot, lastRoot, nextIndex, dead, minDeposit] = await Promise.all([
    c.readContract({ address, abi: PRIVACY_POOL_ABI, functionName: "SCOPE" }),
    c.readContract({ address, abi: PRIVACY_POOL_ABI, functionName: "currentASPRoot" }),
    c.readContract({ address, abi: PRIVACY_POOL_ABI, functionName: "getLastRoot" }),
    c.readContract({ address, abi: PRIVACY_POOL_ABI, functionName: "nextIndex" }),
    c.readContract({ address, abi: PRIVACY_POOL_ABI, functionName: "dead" }),
    c.readContract({ address, abi: PRIVACY_POOL_ABI, functionName: "minDeposit" }),
  ]);
  if (scope !== ref.scope) throw new Error(`This app's pool record does not match the contract on ${ref.network.name}`);
  return { scope, aspRoot, lastRoot, leafCount: Number(nextIndex), dead, minDeposit };
}

const failure = (code: WalletChainError, action: WalletAction, ref: PoolRef, current: string | null) =>
  new WalletChainFailure(code, walletChainMessage(code, { action, target: ref.network.name, current }));

/**
 * A wallet client on the operation's own network (final design §5 "requireWallet"): a connected wallet, switched to
 * the operation's chain when it is elsewhere, fetched for that chain id (wagmi refuses a connector on another chain).
 * Every failure here happens before anything is sent.
 */
async function requireWallet(ref: PoolRef, action: WalletAction): Promise<WalletClient> {
  const config = privacyWagmiConfig;
  const account = getAccount(config);
  if (!account.address || !account.connector || account.status !== "connected") {
    throw failure("not_connected", action, ref, null);
  }
  if (account.chainId !== ref.chainId) {
    try {
      await switchChain(config, { chainId: ref.chainId, connector: account.connector });
    } catch (err) {
      throw failure(classifyWalletError(err) ?? "switch_unsupported", action, ref, walletNetworkName(account.chainId));
    }
  }
  try {
    return await getWalletClient(config, { chainId: ref.chainId, connector: account.connector });
  } catch (err) {
    const code = classifyWalletError(err);
    if (code) throw failure(code, action, ref, walletNetworkName(getAccount(config).chainId));
    throw err;
  }
}

/** A write's error: "the wallet changed network before sending" when viem's chain check refused it. */
function writeError(err: unknown, ref: PoolRef, action: WalletAction): unknown {
  return classifyWalletError(err) === "chain_changed" ? failure("chain_changed", action, ref, null) : err;
}

/** "Confirm the deposit on X in your wallet", or the switch it is about to ask for. */
function walletPrompt(ref: PoolRef, what: "deposit" | "withdrawal" | "exit"): string {
  return getAccount(privacyWagmiConfig).chainId === ref.chainId
    ? `Confirm the ${what} on ${ref.network.name} in your wallet`
    : `Switch your wallet to ${ref.network.name} and confirm the ${what}`;
}

/**
 * The receipt, from the operation's own chain. When the wait runs out, the hash is looked up on the other registry
 * pools' networks (never on a network without a pool): a send that landed elsewhere is named, and nothing more is sent.
 */
async function waitForReceipt(ref: PoolRef, hash: Hex) {
  try {
    return await publicClientFor(ref.chainId).waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
  } catch (err) {
    if (!isReceiptTimeout(err)) throw err;
    return lookElsewhere(ref, hash, err);
  }
}

/** After a receipt timeout: the hash looked up on the other registry pools' networks; throws what was found, else `timeout`. */
async function lookElsewhere(ref: PoolRef, hash: Hex, timeout: unknown): Promise<never> {
  for (const other of PRIVACY_POOLS) {
    if (other.chainId === ref.chainId) continue;
    const tx = await publicClientFor(other.chainId)
      .getTransaction({ hash })
      .catch(() => null);
    if (tx) throw new Error(sentOnOtherNetworkMessage(other.network.name, ref.network.name));
  }
  throw timeout;
}

/**
 * The pending check after unlock: waitForReceipt (the receipt on the entry's own chain for up to 300 s, then the
 * lookup on the other networks, with the same requests), waited for in rounds of RECHECK_ROUND_MS (waitInRounds).
 * Before each round it asks `open()`: once the vault is locked or forgotten it stops after the round in progress,
 * sends nothing more and resolves null. It holds no key, only the hash.
 */
async function followReceipt(ref: PoolRef, hash: Hex, open: () => boolean) {
  const client = publicClientFor(ref.chainId);
  try {
    return await waitInRounds(
      timeout => client.waitForTransactionReceipt({ hash, timeout }), open, {
      totalMs: RECEIPT_TIMEOUT_MS,
      roundMs: RECHECK_ROUND_MS,
      isTimeout: isReceiptTimeout,
    });
  } catch (err) {
    if (!isReceiptTimeout(err)) throw err;
    return open() ? lookElsewhere(ref, hash, err) : null;
  }
}

/** A root the publisher posted without its receipt in time: wait for it on this pool's own client. False: it reverted. */
async function waitForPublishedRoot(ref: PoolRef, hash: Hex): Promise<boolean> {
  try {
    const receipt = await publicClientFor(ref.chainId).waitForTransactionReceipt({ hash, timeout: PUBLISH_WAIT_MS });
    return receipt.status === "success";
  } catch {
    return true; // still pending: the proof checks every candidate root on-chain and falls back to the published ones
  }
}

const isPool = (entry: { chainId?: unknown; pool?: unknown } | null | undefined, ref: PoolRef): boolean =>
  !!entry && typeof entry.chainId === "number" && typeof entry.pool === "string" && samePool({ chainId: entry.chainId, pool: entry.pool as Address }, ref);

/** This pool's publish result, from the answer for every pool. */
const publishResultFor = (answer: PublishAnswer | null, ref: PoolRef): PublishResult | null =>
  answer && Array.isArray(answer.results) ? (answer.results.find(r => isPool(r, ref)) ?? null) : null;

/** This pool's relayer quote: same chain and pool, available, with a relayer. Anything else fails closed. */
const quoteFor = (answer: RelayerQuotesAnswer | null, ref: PoolRef): RelayerQuote | null => {
  const q = answer && Array.isArray(answer.quotes) ? answer.quotes.find(x => isPool(x, ref)) : undefined;
  return q && validRelayerQuote(q) ? q : null;
};

/** The route the Withdraw form names for sending without the relayer (WithdrawPanel's OWN_GAS). */
const OWN_GAS_ROUTE = '"Pay your own gas (from my wallet)"';

/**
 * Why there is no usable quote, before anything is proved or sent: the server's own relayer state (never anything
 * about the visitor). An unfunded relayer is temporary; paying your own gas still works but shows the payer.
 */
function relayerDownMessage(answer: RelayerQuotesAnswer | null, ref: PoolRef): string {
  const q = answer && Array.isArray(answer.quotes) ? answer.quotes.find(x => isPool(x, ref)) : undefined;
  const name = ref.network.name;
  const alt = `Nothing was sent. ${OWN_GAS_ROUTE} still works, but makes the gas payer visible; waiting for the relayer avoids that.`;
  if (q?.reason === "relayer_unfunded") return `The relayer for ${name} is temporarily unavailable. ${alt}`;
  if (q?.reason === "no_relayer_key") return `This app has no relayer for ${name}. Nothing was sent. ${OWN_GAS_ROUTE} works, but makes the gas payer visible.`;
  return `The relayer for ${name} is not available right now. ${alt}`;
}

/**
 * A private withdrawal found no published root at all (AssociationProofError NO_PUBLISHED_ROOT): what the publish
 * answer says about why, or null to keep the general message. Local wording only; nothing is sent. `delay` is the
 * pool's inclusion delay (screening): no deposit joins before it.
 */
function noRootMessage(status: PublishResult["status"] | null, name: string, delay: number): string | null {
  switch (status) {
    case "unfunded":
      return `No association-set root includes this deposit yet, and the association-set publisher for ${name} is temporarily unable to post one. No withdrawal was sent. Withdrawals of this deposit wait for the publisher; ragequit (public exit) works now.`;
    case "no_key":
    case "not_postman":
      return `No association-set root includes this deposit yet, and this app's server cannot post one for ${name}. No withdrawal was sent. Ragequit (public exit) works now.`;
    case "policy_error":
      return `No association-set root includes this deposit yet, and publishing on ${name} is paused until the operator fixes a problem with its screening list. No withdrawal was sent. Ragequit (public exit) works now.`;
    case "empty":
    case "current":
      // no deposit is past the screening wait (and its confirmations) yet, or the publisher's RPC lags
      return `No association-set root has been posted on ${name} yet: ${
        delay > 0
          ? `a deposit joins the set once it is ${formatDelay(delay)} old and confirmed`
          : "a deposit joins the set once it is confirmed"
      }. No withdrawal was sent. Try again later; ragequit (public exit) works now.`;
    default:
      return null;
  }
}

/**
 * A deposit waits for the next root (AssociationProofError WAITING without an announced exclusion) and the publish
 * answer says why none came: the publisher cannot post. null keeps the general "waiting for screening" message.
 */
function waitingMessage(status: PublishResult["status"] | null, name: string): string | null {
  switch (status) {
    case "unfunded":
      return `This deposit is not in the association set yet, and the association-set publisher for ${name} is temporarily unable to post the next root. No withdrawal was sent. Withdrawals of this deposit wait for the publisher; ragequit (public exit) works now.`;
    case "no_key":
    case "not_postman":
      return `This deposit is not in the association set yet, and this app's server cannot post the next root for ${name}. No withdrawal was sent. Ragequit (public exit) works now.`;
    case "policy_error":
      return `This deposit is not in the association set yet, and publishing on ${name} is paused until the operator fixes a problem with its screening list. No withdrawal was sent. Ragequit (public exit) works now.`;
    default:
      return null;
  }
}

/**
 * The pool refused the proof because its association-set root is no longer one of the 16 it accepts (UnknownASPRoot:
 * newer roots pushed it out between proving and sending). The relayer and the wallet both simulate first, so nothing
 * was sent. null for any other error.
 */
function staleRootError(err: unknown): Error | null {
  const text = err instanceof Error ? `${err.message} ${(err as { shortMessage?: unknown }).shortMessage ?? ""}` : String(err ?? "");
  return /UnknownASPRoot/.test(text)
    ? new Error("The association-set root this proof used is no longer accepted by the pool. Nothing was sent; try again (the app makes a new proof against the newest root).")
    : null;
}

const decimalRoot = (root: string | null): bigint | null => {
  if (root === null || !/^\d+$/.test(root)) return null;
  return BigInt(root);
};

type Utils = ReturnType<typeof trpc.useUtils>;

/**
 * The privacy.* calls this provider makes, with the answers of shared/privacy/api.ts. Every answer is also checked
 * at run time (Array.isArray) where it is read, so an answer of another shape fails closed.
 */
function privacyApi(utils: Utils) {
  return {
    /** input-less and label-free: every pool's publish result */
    publish: (): Promise<PublishAnswer> => utils.client.privacy.asp.publish.mutate(),
    /** input-less: every pool's full public set */
    sets: (): Promise<AssociationSetsAnswer> => utils.client.privacy.asp.set.query(),
    /**
     * input-less: every pool's quote, from the chosen relayer (relayers.ts): this site's server, or another Hylsia
     * relayer the build or the person lists. One withdrawal asks for its quote and submits to the same relayer.
     */
    quotes: (r: RelayerEntry): Promise<RelayerQuotesAnswer> =>
      r.origin ? remoteRelayerClient(r.origin).privacy.relayer.quote.query() : utils.privacy.relayer.quote.fetch(),
    /** names the withdrawal's network (inherent: the relayer sends it there) */
    submit: (
      r: RelayerEntry,
      input: {
        chainId: number;
        withdrawal: { recipient: Address; relayer: Address; fee: bigint; deadline: bigint;
        };
        proof: Groth16ProofCalldata;
        pubSignals: bigint[];
      },
    ): Promise<RelaySubmitAnswer> =>
      r.origin ? remoteRelayerClient(r.origin).privacy.relayer.submit.mutate(input) : utils.client.privacy.relayer.submit.mutate(input),
  };
}

// ───────────────────────────── provider ──────────────────────────────

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const configured = PRIVACY_POOLS.length > 0;
  const utils = trpc.useUtils();
  const api = useMemo(() => privacyApi(utils), [utils]);
  const account = useAccount({ config: privacyWagmiConfig });

  // The association-set publisher's public status, as the shell fetches it for every privacy-area visitor on one
  // schedule (PoolsShell, ASP_STATUS_SCHEDULE). This observer is disabled: it never asks the server itself, and a
  // withdrawal reads the copy at hand (the publish decision, the operator's announced exclusions).
  const aspStatusQ = trpc.privacy.asp.status.useQuery(undefined, { enabled: false });
  const aspStatusRef = useRef<{ answer: ASPStatusAnswer | undefined; failed: boolean; fetchedAt: number;
  }>({ answer: undefined, failed: false, fetchedAt: 0 });
  useEffect(() => {
    aspStatusRef.current = { answer: aspStatusQ.data, failed: aspStatusQ.isError, fetchedAt: aspStatusQ.dataUpdatedAt };
  }, [aspStatusQ.data, aspStatusQ.isError, aspStatusQ.dataUpdatedAt]);

  // ── vault ── (the storage move runs first, before anything here reads storage)
  const [vault, setVaultState] = useState<VaultState>(() => {
    migrateOnce();
    const backup = loadJSON<BackupFile | null>(DEVICE_KEYS.vault, null);
    return {
      status: backup ? "locked" : "none",
      backup,
      fingerprint: backup?.fingerprint ?? null,
      backupVerified: loadJSON<boolean>(DEVICE_KEYS.backupVerified, false) === true,
    };
  });
  const vaultRef = useRef<VaultState>(vault);
  const setVault = useCallback((next: VaultState | ((v: VaultState) => VaultState)) => {
    const value = typeof next === "function" ? next(vaultRef.current) : next;
    vaultRef.current = value;
    setVaultState(value);
  }, []);
  const [keys, setKeys] = useState<MasterKeys | null>(null);
  const keysRef = useRef<MasterKeys | null>(null);

  // ── pools ── (the ref is the source of truth; state follows it for rendering)
  const [slots, setSlots] = useState<Slots>(initialSlots);
  const slotsRef = useRef<Slots>(slots);
  const updateSlot = useCallback((key: PoolKey, fn: (s: PoolSlot) => PoolSlot) => {
    const prev = slotsRef.current[key];
    if (!prev) return;
    const next = fn(prev);
    if (next === prev) return;
    slotsRef.current = { ...slotsRef.current, [key]: next };
    setSlots(slotsRef.current);
  }, []);
  const rediscoverAll = useCallback((k: MasterKeys | null) => {
    let next = slotsRef.current;
    for (const ref of PRIVACY_POOLS) {
      const slot = next[ref.key];
      const notes = discover(k, ref, slot.state);
      if (notes !== slot.notes) next = { ...next, [ref.key]: { ...slot, notes } };
    }
    if (next !== slotsRef.current) {
      slotsRef.current = next;
      setSlots(next);
    }
  }, []);

  // ── activity ── (the log belongs to the vault on this device, encrypted with a key from its seed: activityStore.ts)
  // Nothing of it is read before unlock: the list stays empty until a vault is opened.
  const [activity, setActivity] = useState<Activity[]>(() => {
    // Without a vault any activity key is a leftover (older builds kept the log after "Forget vault on this device"),
    // and it still pairs deposits with withdrawal recipients: delete it, unread.
    const store = vaultRef.current.backup ? null : deviceStorage();
    try {
      if (store) clearActivityStorage(store);
    } catch {
      /* storage blocked */
    }
    return NO_ACTIVITY;
  });
  const activityRef = useRef<Activity[]>(NO_ACTIVITY);
  const [activityNotice, setActivityNotice] = useState<ActivityNotice>(NO_NOTICE);
  /** the open log while the vault is unlocked (its key goes with it on lock and on Forget) */
  const sessionRef = useRef<ActivitySession | null>(null);
  const epochRef = useRef(0);
  /** a new number each time a log is opened or closed: the pending recheck below follows it */
  const sessionSeq = useRef(0);
  const [logSession, setLogSession] = useState(0);
  const [logWriter] = useState(createSerialWriter);
  const [reservations] = useState(() => createReservations(deviceStorage));
  const [op, setOp] = useState<OpState>({ kind: null, stage: "idle" });

  // ── busy ──
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  /**
   * Operations not finished yet, per opening of the log (ActivitySession.opened): from begin() until their last write
   * with the vault's key (finishOp below), which for a deposit is its reservation release after `busy` has ended. A
   * lock asked for meanwhile waits for them (unlockedWork.ts).
   */
  const [lockGate] = useState(createLockGate);
  const [lockPending, setLockPending] = useState(false);
  const begin = useCallback(
    (opened: number) => {
      if (busyRef.current) throw new Error("Another transaction is in progress. Wait for it to finish first.");
      busyRef.current = true;
      setBusy(true);
      lockGate.start(opened);
    },
    [lockGate],
  );
  const end = useCallback(() => {
    busyRef.current = false;
    setBusy(false);
  }, []);

  // ── active pool ── (memory only: the hash of an in-app link, else the wallet's chain once it reconnects, else the
  // first pool). The stored wallet connection never names a network (walletGuard.ts), so the wallet's chain is the one
  // it reports when it reconnects, followed for a few seconds at most (below).
  const choiceSettled = useRef(false);
  const [activeKey, setActiveKey] = useState<PoolKey | null>(() => {
    const fromHash = takeNetworkHash();
    if (fromHash) {
      choiceSettled.current = true;
      return fromHash.key;
    }
    return PRIVACY_POOLS[0]?.key ?? null;
  });
  const activePool = useMemo(() =>
      activeKey ? (PRIVACY_POOLS.find(r => r.key === activeKey) ?? null) : null, [activeKey]);
  const activeRef = useRef<PoolRef | null>(activePool);
  activeRef.current = activePool;

  // Reads that carry the wallet's address go to the active network's RPC only, whichever component asks (RainbowKit's
  // account window included): the privacy area's transports refuse them elsewhere (walletGuard.ts). A layout effect,
  // so the slot is set before any child's query fetches.
  useLayoutEffect(() => {
    setWalletReadChain(activePool?.chainId ?? null);
  }, [activePool]);
  useLayoutEffect(() => () => setWalletReadChain(null), []);

  const choose = useCallback((ref: PoolRef) => {
    choiceSettled.current = true;
    if (activeRef.current?.key === ref.key) return;
    activeRef.current = ref;
    setActiveKey(ref.key);
  }, []);

  const setActivePool = useCallback(
    (key: PoolKey): boolean => {
      if (busyRef.current) return false;
      const ref = poolRefByKey(key);
      if (!ref) return false;
      choose(ref);
      return true;
    },
    [choose],
  );

  // While the wallet connection is restored at page load, the choice may still follow the wallet's chain; after that
  // (or once a link or the person chose), it never follows the wallet.
  useEffect(() => {
    const id = window.setTimeout(() => {
      choiceSettled.current = true;
    }, WALLET_CHOICE_MS);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (choiceSettled.current || account.status !== "connected") return;
    choiceSettled.current = true;
    const ref = poolOnChain(account.chainId);
    if (ref && !busyRef.current) choose(ref);
  }, [account.status, account.chainId, choose]);

  // An in-app link into the vault (#network=<slug>) while the provider is already mounted: read once, then stripped.
  useEffect(() => {
    const onNavigate = () => {
      const ref = takeNetworkHash();
      if (ref && !busyRef.current) choose(ref);
    };
    onNavigate();
    const events = ["pushState", "popstate", "hashchange"];
    for (const e of events) window.addEventListener(e, onNavigate);
    return () => {
      for (const e of events) window.removeEventListener(e, onNavigate);
    };
  }, [choose]);

  // ── log persistence ── (encrypted cross-tab read/merge/write, guarded by the current vault)
  const showActivity = useCallback((list: Activity[]) => {
    activityRef.current = list;
    setActivity(list);
  }, []);

  /**
   * Whether this session may still change what is stored: no Forget, create or restore since it opened (its epoch),
   * and the vault stored on this device is still its vault (another tab may have forgotten or replaced it).
   */
  const isLive = useCallback((s: ActivitySession) => s.epoch === epochRef.current && storedVaultIs(s.fingerprint), []);

  /** The open log, if it is still the opening `opened` (a lock, Forget, create or restore closes it). */
  const sessionFor = useCallback((opened: number): ActivitySession | null => {
    const s = sessionRef.current;
    return s && s.opened === opened ? s : null;
  }, []);

  /** A change to a pool's reservations by work that keeps only `opened`: the session is found now, and guarded. */
  const updateReservations = useCallback(
    (opened: number, ref: PoolRef, change: (list: Reservation[]) => Reservation[]): Promise<ReservationUpdate> => {
      const s = sessionFor(opened);
      if (!s) return Promise.resolve({ list: [], saved: false, problem: "stale" });
      return reservations.update(s, ref, change, () => sessionFor(opened) === s && isLive(s));
    },
    [reservations, sessionFor, isLive],
  );

  /** A change to the log: shown at once, then written encrypted behind any write in flight. Nothing while locked. */
  const commitActivity = useCallback(
    (next: Activity[]) => {
      const s = sessionRef.current;
      if (!s) return;
      showActivity(next);
      const store = deviceStorage();
      if (!store) return;
      const live = () => isLive(s);
      void logWriter.schedule(async () => {
        const ok = await writeActivityLog(store, s, next, live);
        if (ok && s.plaintextLeft.length > 0 && live()) {
          // the encrypted log now holds what the older plaintext logs held
          for (const key of s.plaintextLeft) remove(key);
          s.plaintextLeft = [];
        }
        return ok;
      });
    },
    [logWriter, showActivity, isLive],
  );

  /**
   * Lock: the log's key and its decrypted entries leave memory (the pending check below holds neither). A write already
   * scheduled still lands (it is this vault's), within milliseconds.
   */
  const closeActivity = useCallback(() => {
    sessionRef.current = null;
    lockGate.clear();
    setLockPending(false);
    showActivity(NO_ACTIVITY);
    setActivityNotice(NO_NOTICE);
    setLogSession(++sessionSeq.current);
  }, [showActivity, lockGate]);

  /** Forget, create, restoring another vault: the log goes in every form (v2, v3, a set-aside copy), and no earlier write lands. */
  const clearActivity = useCallback(() => {
    epochRef.current++;
    logWriter.cancel();
    closeActivity();
    const store = deviceStorage();
    try {
      if (store) clearActivityStorage(store);
    } catch {
      /* storage blocked */
    }
  }, [logWriter, closeActivity]);

  /**
   * Opens the log of a vault being unlocked, with the key from its seed. `fresh` (a new vault, or another one restored
   * here): there is nothing to read. Otherwise the stored log is decrypted now (set aside if it does not decrypt) and
   * an older plaintext log is moved in (activityStore.ts loadActivityLog). Reservations an older build left in
   * plaintext are sealed. Nothing is sent anywhere. Throws when the vault on this device was replaced meanwhile (a
   * restore that ran at the same time, or Forget or a restore in another tab), so the caller does not open it.
   */
  const openActivity = useCallback(
    async (key: CryptoKey, fingerprint: string, fresh: boolean): Promise<void> => {
      const s: ActivitySession = { key, fingerprint, epoch: epochRef.current, opened: 0, plaintextLeft: [] };
      const live = () => isLive(s);
      let entries = NO_ACTIVITY;
      let notice = NO_NOTICE;
      const store = deviceStorage();
      if (store && !fresh) {
        await logWriter.flush(); // a write from before the last lock lands first
        try {
          const loaded = await loadActivityLog(store, s, live);
          entries = loaded.entries.map(toActivity);
          notice = { setAside: loaded.setAside, unreadableRemoved: loaded.unreadableRemoved };
          s.plaintextLeft = loaded.left;
        } catch {
          /* storage cannot be read: this session starts with an empty log */
        }
      }
      if (store) await reservations.sealPlaintext(s, live).catch(() => 0);
      if (!live()) throw new Error("The vault on this device changed meanwhile, possibly in another tab. Reload the page and try again.");
      s.opened = ++sessionSeq.current;
      sessionRef.current = s;
      showActivity(entries);
      setActivityNotice(notice);
      setLogSession(s.opened);
    },
    [logWriter, reservations, showActivity, isLive],
  );

  const discardSetAsideLog = useCallback(() => {
    remove(DEVICE_KEYS.activityQuarantine);
    setActivityNotice(n => (n.setAside ? { ...n, setAside: false } : n));
  }, []);

  const addActivity = useCallback((entry: Activity) => commitActivity([entry, ...activityRef.current]), [commitActivity]);

  const updateActivity = useCallback(
    (id: string, patch: Partial<Activity>) => {
      const list = activityRef.current;
      // an entry of a log that was closed, forgotten or replaced meanwhile is not this log's
      if (!list.some(a => a.id === id)) return;
      commitActivity(list.map(a =>
          a.id === id ? { ...a, ...patch, updatedAt: Date.now() } : a));
    },
    [commitActivity],
  );

  // ── sync ── (one guard per pool)
  const syncing = useRef(new Map<string, Promise<void>>());
  // Pools whose last sync found this device's copy inconsistent with the chain (a leaf gap, or a tree root the pool
  // does not know): their next sync, on the 45 s round or a Sync click, rebuilds them from the deploy block. Decided by
  // each pool's own public data, never by the vault's notes or the active network.
  const needsFull = useRef(new Set<string>());
  // Pools whose site snapshot was used and then failed the chain's check in this tab: never used again until a reload.
  const snapshotRejected = useRef(new Set<string>());

  const syncPool = useCallback(
    (ref: PoolRef, fullAsked: boolean): Promise<void> => {
      const running = syncing.current.get(ref.key);
      if (running) return fullAsked ? running.then(() => syncPool(ref, true)) : running;
      let bootstrapped = false;
      let usedSnap = false;
      let snapFailed = false;
      const job = (async () => {
        // a copy that started from the snapshot is replaced by a full scan on every round until one succeeds
        const full = fullAsked || needsFull.current.has(ref.key) || slotsRef.current[ref.key].state.historyVerified === false;
        updateSlot(ref.key, s =>
          s.state.status === "ready" || s.state.status === "loading" ? s : { ...s, state: { ...s.state, status: "loading", error: undefined } },
        );
        try {
          const prev = slotsRef.current[ref.key].state;
          const client = publicClientFor(ref.chainId);
          // The pool header first, then the newest head (never viem's cached one, up to 4 s old): the events are read up
          // to a head at or after the block the current root was read at, so they hold that root's own record (its
          // ASPRootUpdated event) and the device need not take a server's record of it.
          const header = await readPoolHeader(ref);
          const head = await client.getBlockNumber({ cacheTime: 0 });
          let haveCache = !full && (prev.events.length > 0 || prev.lastBlock > 0n);
          // No copy on this device yet: start from the site's snapshot when it checks out (loadSnapshot), then scan only
          // the blocks after it. Its tree events are verified by the root check below; the rest of the history comes
          // from the full scan queued right after this one.
          const snap =
            !haveCache && !full && !snapshotRejected.current.has(ref.key) ? await loadSnapshot(ref, client, head) : null;
          usedSnap = snap !== null;
          let range = snap ? { from: snap.toBlock + 1n, to: head } : nextScanRange({
            deployBlock: ref.deployBlock,
            lastBlock: haveCache ? prev.lastBlock : null,
            head,
            reorgWindow: ref.network.reorgWindow,
          });
          if (!range) {
            if (headRegression({ lastBlock: prev.lastBlock, head, reorgWindow: ref.network.reorgWindow }) === "keep") {
              // The RPC is a few blocks behind what this device already holds (inside the reorg window): keep the
              // cache and try again on the next round.
              updateSlot(ref.key, s =>
                s.state.status === "ready"
                  ? s
                  : { ...s, state: { ...s.state, status: "error", error: `The ${ref.network.name} RPC is behind this device's copy of the pool. Retrying shortly.` } },
              );
              return;
            }
            // The head fell further than the reorg window (or at all, on a local chain): a restart, a revert or a
            // regenesis. This copy no longer describes the chain, so it is rebuilt from the deploy block now.
            haveCache = false;
            range = { from: ref.deployBlock, to: head };
          }
          const fresh =
            range.from <= range.to
              ? await fetchPoolEvents(client, ref.pool, range.from, range.to, {
                  protocol: ref.protocol,
                  chunkSize: ref.network.logChunk,
                  minChunkSize: ref.network.minLogChunk,
                  concurrency: SCAN_CONCURRENCY,
                })
              : [];
          // everything from the re-scanned blocks on is replaced (a re-included transaction can move)
          const events = snap ? mergePoolEvents(snap.events, fresh, range.from) : haveCache ? mergePoolEvents(prev.events, fresh, range.from) : fresh;
          let tree: MerkleTree;
          try {
            tree = buildStateTree(events);
          } catch (err) {
            // a leaf gap: a copy built from the cache (or the snapshot) is rebuilt from the deploy block next time
            if (haveCache) needsFull.current.add(ref.key);
            if (snap) snapshotRejected.current.add(ref.key);
            throw err;
          }
          let inSync = tree.root === header.lastRoot;
          if (!inSync) {
            inSync = await client.readContract({ address: ref.pool, abi: PRIVACY_POOL_ABI, functionName: "isKnownRoot", args: [tree.root] });
          }
          // a copy from the cache that the pool does not know is rebuilt next time; a rebuilt one is not rebuilt again
          if (!inSync && haveCache) needsFull.current.add(ref.key);
          else needsFull.current.delete(ref.key);
          if (snap && !inSync) {
            // the snapshot's tree does not lead to a root the pool knows: drop it, and scan from the deploy block now
            snapshotRejected.current.add(ref.key);
            throw new Error(`The site's snapshot of the ${ref.network.name} pool did not check out against the chain; reading the whole history instead.`);
          }
          // a copy started from the snapshot is not cached: only a full scan's copy (whole history) is kept on the device
          if (!snap) saveJSON(poolStorageKey(ref, "events"), { protocol: ref.protocol, events, lastBlock: head });
          const state: PoolState = {
            status: "ready",
            ...header,
            events,
            lastBlock: head,
            tree,
            inSync,
            syncedAt: Date.now(),
            error: inSync ? undefined : OUT_OF_SYNC,
            historyVerified: !snap,
          };
          updateSlot(ref.key, () => ({ state, notes: discover(keysRef.current, ref, state) }));
          // the rest of the history, in the background: the full scan replaces this copy and sets historyVerified
          if (snap) bootstrapped = true;
        } catch (err) {
          // a rejected snapshot: say nothing yet, the full scan follows at once
          if (usedSnap) snapFailed = true;
          else updateSlot(ref.key, s => ({ ...s, state: { ...s.state, status: "error", error: errorMessage(err) } }));
        }
      })().finally(() => {
        if (syncing.current.get(ref.key) === job) syncing.current.delete(ref.key);
        if (bootstrapped || snapFailed) void syncPool(ref, true);
      });
      syncing.current.set(ref.key, job);
      return job;
    },
    [updateSlot],
  );

  const sync = useCallback(
    async (opts: { full?: boolean; poolKey?: PoolKey } = {}) => {
      if (opts.poolKey !== undefined) {
        const ref = poolRefByKey(opts.poolKey);
        if (ref) await syncPool(ref, !!opts.full);
        return;
      }
      await Promise.allSettled(PRIVACY_POOLS.map(ref => syncPool(ref, !!opts.full)));
    },
    [syncPool],
  );

  // Every registry pool, on mount and every 45 s, for every visitor (never only the active one).
  useEffect(() => {
    void sync();
    const id = window.setInterval(() => void sync(), SYNC_EVERY_MS);
    return () => window.clearInterval(id);
  }, [sync]);

  // After each unlock (the log is unreadable before), each pending entry it holds, left by an earlier page, is followed
  // on its own network (registry pools' networks only) the way the operation itself would have been: its receipt for
  // up to 300 s, then a lookup on the other networks, then failed with what was found (followReceipt). A deposit's
  // index reservation is freed once its transaction is settled, and kept while it may still land. An entry left
  // without a transaction (the page went before the wallet answered) is closed with a line saying so. This work keeps
  // only the number of this opening of the log and each entry's id, kind, network and hash, never the session or its
  // key: a lock or Forget stops it after the receipt round in progress (RECHECK_ROUND_MS), and the next unlock starts
  // it again.
  useEffect(() => {
    const opened = sessionRef.current?.opened;
    if (opened === undefined) return;
    const pending = activityRef.current
      .filter(a => a.status === "pending")
      .map(({ id, kind, txHash, chainId }) => ({ id, kind, txHash, chainId }));
    if (pending.length === 0) return;
    let cancelled = false;
    const open = () => !cancelled && sessionFor(opened) !== null;
    void Promise.allSettled(
      pending.map(async a => {
        if (!a.txHash) {
          updateActivity(a.id, { status: "failed", error: INTERRUPTED });
          return;
        }
        const ref = poolOnChain(a.chainId);
        if (!ref) return;
        let receipt: Awaited<ReturnType<typeof followReceipt>>;
        try {
          receipt = await followReceipt(ref, a.txHash, open);
        } catch (err) {
          // not in after 300 s, or sent on another network: failed with that message; a deposit keeps its reservation
          if (open()) updateActivity(a.id, { status: "failed", error: errorMessage(err) });
          return;
        }
        if (!receipt || !open()) return;
        const ok = receipt.status === "success";
        updateActivity(a.id, ok ? { status: "confirmed" } : { status: "failed", error: "Transaction reverted" });
        if (a.kind === "deposit") {
          // the confirmed note is found first, so its index is never handed out again; then the reservation goes
          if (ok) await syncPool(ref, false);
          const hash = a.txHash.toLowerCase();
          if (open()) await updateReservations(opened, ref, list =>
              retireReservations(list, d => d.txHash?.toLowerCase() === hash));
        }
      }),
    ).then(() => {
      if (!cancelled) void sync();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logSession]);

  // ── vault ──
  const setUnlocked = useCallback(
    (seed: Uint8Array, backup: BackupFile, backupVerified: boolean) => {
      const k = deriveMasterKeys(seed);
      keysRef.current = k;
      setKeys(k);
      setVault({ status: "unlocked", backup, fingerprint: backup.fingerprint, backupVerified });
      rediscoverAll(k);
    },
    [rediscoverAll, setVault],
  );

  const createVault = useCallback(
    async (password: string) => {
      if (!configured) throw new Error("Pool not configured");
      if (vaultRef.current.status !== "none") throw new Error("A vault already exists on this device. Lock, export, then forget it first.");
      const seed = generateSeed();
      const backup = await encryptSeedV2(seed, password);
      const logKey = await deriveActivityKey(seed);
      saveJSON(DEVICE_KEYS.vault, backup);
      saveJSON(DEVICE_KEYS.backupVerified, false);
      const store = deviceStorage();
      if (store) clearPendingDeposits(store);
      clearActivity(); // a new vault starts with no history
      await openActivity(logKey, backup.fingerprint, true);
      forgetAnnouncedSightings();
      setUnlocked(seed, backup, false);
    },
    [configured, setUnlocked, clearActivity, openActivity],
  );

  const unlock = useCallback(
    async (password: string) => {
      const v = vaultRef.current;
      if (!v.backup) throw new Error("No vault on this device");
      const seed = await decryptSeed(v.backup, password);
      // The first unlock of a single-network (v1) vault re-encrypts it as v2; fingerprint and verified state stay.
      const backup = await asV2(seed, password, v.backup);
      if (backup !== v.backup) saveJSON(DEVICE_KEYS.vault, backup);
      // the activity log is read only now, decrypted with a key from the seed (pending entries are followed next)
      await openActivity(await deriveActivityKey(seed), backup.fingerprint, false);
      setUnlocked(seed, backup, v.backupVerified);
    },
    [setUnlocked, openActivity],
  );

  const lockNow = useCallback(() => {
    keysRef.current = null;
    setKeys(null);
    closeActivity();
    rediscoverAll(null);
    // what this tab still holds about the vault's deposits and its last operation goes too (its outcome is in the log)
    forgetAnnouncedSightings();
    setOp({ kind: null, stage: "idle" });
    setVault(v => ({ ...v, status: v.backup ? "locked" : "none" }));
  }, [closeActivity, rediscoverAll, setVault]);

  // An operation in flight records its outcome in the log, and a deposit updates and then releases its index
  // reservation, with this vault's key. So a lock asked for meanwhile waits for the operation's last write and then
  // happens (finishOp), instead of dropping the key under it. Forget is never deferred: it works at once, and the
  // operation's later writes are dropped (the vault is gone).
  const lock = useCallback((): boolean => {
    if (lockGate.ask(sessionRef.current?.opened)) {
      lockNow();
      return true;
    }
    setLockPending(true);
    return false;
  }, [lockNow, lockGate]);

  /** An operation's last write is done: a lock asked for while it ran happens now, once no other operation of this log runs. */
  const finishOp = useCallback(
    (opened: number) => {
      if (lockGate.finish(opened, sessionRef.current?.opened)) lockNow();
    },
    [lockNow, lockGate],
  );

  const exportBackup = useCallback(() => {
    const backup = vaultRef.current.backup;
    if (!backup) throw new Error("No vault to export");
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hylsia-privacy-backup-${backup.fingerprint.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const verifyBackup = useCallback(
    async (fileText: string, password: string) => {
      const current = vaultRef.current.backup;
      if (!current) throw new Error("No vault on this device");
      const parsed = parseBackup(fileText);
      // v1 or v2: no expected network, but the seed must be this vault's
      const seed = await decryptSeed(parsed, password);
      if (seedFingerprint(seed) !== current.fingerprint) {
        throw new VaultError("WRONG_CONTEXT", "That backup file belongs to a different vault than the one on this device.");
      }
      saveJSON(DEVICE_KEYS.backupVerified, true);
      setVault(v => ({ ...v, backupVerified: true }));
    },
    [setVault],
  );

  const importBackup = useCallback(
    async (fileText: string, password: string) => {
      if (!configured) throw new Error("Pool not configured");
      const parsed = parseBackup(fileText);
      const seed = await decryptSeed(parsed, password);
      // Restoring a different vault replaces (forgets) the one stored here, so its activity log goes with it (as does
      // any log left on a device without a vault); the same vault keeps its log.
      const current = vaultRef.current.backup;
      const same = !!current && current.fingerprint === seedFingerprint(seed);
      if (!same) clearActivity();
      const stored = await asV2(seed, password, parsed);
      saveJSON(DEVICE_KEYS.vault, stored);
      saveJSON(DEVICE_KEYS.backupVerified, true); // the file just proved it restores access
      const store = deviceStorage();
      if (store) clearPendingDeposits(store);
      await openActivity(await deriveActivityKey(seed), stored.fingerprint, !same);
      forgetAnnouncedSightings(); // the vault this tab read before is replaced (or opened again): its sightings go
      setUnlocked(seed, stored, true);
      await sync({ full: true });
    },
    [configured, setUnlocked, sync, clearActivity, openActivity],
  );

  const forgetVault = useCallback(() => {
    // every activity key first, so no write still in flight lands after this (activityStore.ts); then the device keys,
    // every pool's pending deposits and every legacy vault-bound key (event caches are public, kept)
    clearActivity();
    const store = deviceStorage();
    if (store) forgetDeviceStorage(store);
    keysRef.current = null;
    setKeys(null);
    rediscoverAll(null);
    forgetAnnouncedSightings();
    setVault({ status: "none", backup: null, fingerprint: null, backupVerified: false });
  }, [clearActivity, rediscoverAll, setVault]);

  // ── operations ── (each captures its pool when it starts)
  const resetOp = useCallback(() => setOp({ kind: null, stage: "idle" }), []);

  /** The operation's pool: the registry pool `key` names, else the active one. Never a pool from a URL or a server. */
  const opPool = useCallback((key?: PoolKey): PoolRef => {
    const ref = key !== undefined ? poolRefByKey(key) : activeRef.current;
    if (!ref) throw new Error(key !== undefined ? "That pool is not one this app is built for" : "Privacy pool is not configured for this build");
    return ref;
  }, []);

  /** The unlocked vault's keys and the pool's state; `opened` names this opening of the log (never the session itself). */
  const requireReady = useCallback((ref: PoolRef) => {
    const k = keysRef.current;
    const opened = sessionRef.current?.opened;
    if (!k || opened === undefined) throw new Error("Unlock your privacy vault first");
    const slot = slotsRef.current[ref.key];
    const p = slot.state;
    if (p.status !== "ready" || p.scope === null) {
      throw new Error(p.status === "error" && p.error ? p.error : `The ${ref.network.name} pool state is not loaded yet`);
    }
    return { keys: k, pool: p, notes: slot.notes, opened };
  }, []);

  const deposit = useCallback(
    async (amountWei: bigint, key?: PoolKey) => {
      const ref = opPool(key);
      const { keys: k, pool: p, notes: n, opened } = requireReady(ref);
      if (!vaultRef.current.backupVerified) throw new Error("Verify your backup before depositing");
      if (p.dead) throw new Error("This pool no longer accepts deposits");
      if (amountWei <= 0n || amountWei < p.minDeposit) throw new Error("Amount is below the minimum deposit");
      if (ref.chainId === 1) {
        const cached = aspStatusRef.current;
        const status = activeASPStatus(cached.answer, cached.failed, ref, cached.fetchedAt, Date.now());
        if (status.status !== "ready" || status.screening?.walletPublishable !== true || status.screening.policyVersion !== 1) {
          throw new Error("Mainnet eligibility status is unavailable or paused. Wait before depositing.");
        }
      }
      const name = ref.network.name;
      const at = { chainId: ref.chainId, pool: ref.pool };
      // This pool's index reservations, encrypted like the log and changed one at a time (activityStore.ts). Nothing is
      // read or written once this vault was forgotten or replaced (here or in another tab), and a stored list this
      // vault cannot decrypt is never touched. A settled-index watermark remains encrypted; its key name can reveal prior pool usage.
      const reserve = (change: (list: Reservation[]) => Reservation[]) => updateReservations(opened, ref, change);
      const release = (index: number) => reserve(list =>
          retireReservations(list, d => d.depositIndex === index));
      const id = newId();
      let depositIndex = -1;
      let sent: Hex | null = null;
      begin(opened);
      try {
        try {
          // this pool's own index sequence (its scope differs from every other pool's), held before the wallet is asked
          if (!isV2Protocol(ref.protocol)) {
            const held = await reserve(list => {
              depositIndex = allocateDepositIndex(n.nextDepositIndex, list);
              return [...list, { depositIndex }];
            });
            // V1 needs durable reservations before asking the wallet; v2 uses independent random nonces.
            if (held.problem === "stale") throw new Error(VAULT_CHANGED);
            if (held.problem === "foreign") throw new Error(foreignReservations(name));
            if (!held.saved)
              throw new Error(
                "Deposit index could not be saved safely. Use a browser with Web Locks over HTTPS and available device storage. Nothing was sent."
              );
          }
          const prepared = RUNTIME.prepareDeposit(k, ref.scope, depositIndex);
          const precommitment = prepared.precommitment;

          addActivity({ id, kind: "deposit", status: "pending", createdAt: Date.now(), updatedAt: Date.now(), amountWei, ...at });
          setOp({ kind: "deposit", stage: "awaiting_wallet", message: walletPrompt(ref, "deposit"), ...at });
          const wallet = await requireWallet(ref, "deposit");
          if (
            sessionRef.current?.opened !== opened ||
            !storedVaultIs(sessionRef.current.fingerprint)
          )
            throw new Error(VAULT_CHANGED);
          setOp({ kind: "deposit", stage: "awaiting_wallet", message: `Confirm the deposit on ${name} in your wallet`, ...at });
          const txHash = await wallet
            .writeContract({
              address: ref.pool,
              abi: PRIVACY_POOL_ABI,
              functionName: "deposit",
              args: prepared.recoveryNonce === undefined ? [precommitment] : [precommitment, prepared.recoveryNonce],
              value: amountWei,
              account: wallet.account,
              chain: ref.network.chain,
            })
            .catch((err: unknown) => {
              throw writeError(err, ref, "deposit");
            });
          sent = txHash;
          updateActivity(id, { txHash });
          // the reservation names its transaction, so a reload can follow it and free the index once it is settled
          if (depositIndex >= 0) await reserve(list => list.map(d =>
              d.depositIndex === depositIndex ? { ...d, txHash } : d
            ));
          setOp({ kind: "deposit", stage: "pending", txHash, message: `Waiting for confirmation on ${name}`, ...at });
          const receipt = await waitForReceipt(ref, txHash);
          if (receipt.status !== "success") throw new Error("Deposit transaction reverted");
          updateActivity(id, { status: "confirmed" });
          setOp({ kind: "deposit", stage: "confirmed", txHash, message: `Deposit confirmed on ${name}`, ...at });
        } catch (err) {
          const msg = errorMessage(err);
          updateActivity(id, { status: "failed", error: msg });
          // a transaction still waiting for its receipt may yet land: keep its index reserved
          if (depositIndex >= 0 && !(sent && isReceiptTimeout(err))) await release(depositIndex);
          setOp({ kind: "deposit", stage: "failed", error: msg, ...at });
          throw err;
        } finally {
          end();
        }
        // the confirmed note is found first, so its index is never handed out again; then the reservation goes
        await sync({ poolKey: ref.key });
        if (depositIndex >= 0) await release(depositIndex);
      } finally {
        // the last write with the vault's key is done: a lock asked for meanwhile happens now
        finishOp(opened);
      }
    },
    [opPool, requireReady, begin, end, finishOp, addActivity, updateActivity, sync, updateReservations],
  );

  const withdraw = useCallback(
    async ({ note, amountWei, recipient, via, confirmSmallSet, confirmShrink, expectedCrowd, maxRelayerFeeWei, poolKey: key }: WithdrawParams) => {
      const ref = opPool(key);
      // Keep this withdrawal on the relayer selected at its start, including while crowd questions are open.
      const relayerEntry = selectedRelayer();
      const { keys: k, opened } = requireReady(ref);
      if (note.spent) throw new Error("This note is already spent");
      if (amountWei <= 0n || amountWei > note.value) throw new Error("Invalid withdrawal amount");
      // Paying your own gas needs a wallet: checked before any work (the network switch comes after proving).
      if (via === "self" && !getAccount(privacyWagmiConfig).address) throw failure("not_connected", "withdraw", ref, null);
      const name = ref.network.name;
      const at = { chainId: ref.chainId, pool: ref.pool };
      const scope = ref.scope;
      const step = (o: Omit<OpState, "kind" | "chainId" | "pool">) => setOp({ kind: "withdraw", ...o, ...at });
      const id = newId();
      begin(opened);
      try {
        addActivity({ id, kind: "withdraw", status: "pending", createdAt: Date.now(), updatedAt: Date.now(), amountWei, recipient, via, ...at });
        // 1. every registry pool, as any withdrawal on any network does: the publish decision reads them all
        step({ stage: "preparing", message: `Syncing pool state before withdrawing on ${name}` });
        await sync();
        const p = slotsRef.current[ref.key].state;
        if (p.status !== "ready" || !p.tree || !p.inSync) {
          throw new Error(p.status === "error" && p.error ? p.error : "Local state is out of sync with the pool. Try again in a moment.");
        }
        // a copy that started from the site's snapshot: its tree is checked, the rest of the history (ragequits, roots)
        // is still being read; nothing is decided on it before then (the same for every note)
        if (!p.historyVerified) {
          throw new Error(`This device is still reading the ${name} pool's full history. No withdrawal was sent; try again in a moment.`);
        }
        // the live note is found in this pool's own events: a note of another pool is never found here
        const live = discoverNotes(k, scope, p.events).notes.find(
          n => n.commitment === note.commitment);
        if (!live || live.spent) throw new Error("This note is no longer spendable");
        const stateProof = p.tree.proof(live.leafIndex);
        if (stateProof.leaf !== live.commitment) throw new Error("State tree mismatch for this note");

        // 2. Whether this withdrawal asks for a newer root: one label-free request covering every network's pool, due when
        // a root is due on any pool: the operator's rootDue from the privacy.asp.status copy every visitor fetches
        // (younger than ASP_STATUS_MAX_AGE_MS; not followed when its announcements alone shrink a pool's root sharply),
        // else the open policy's rule (a current root behind the deposits). Public data only, so every withdrawal on
        // every network decides the same.
        const status = aspStatusRef.current;
        const nowMs = Date.now();
        const screenings = PRIVACY_POOLS.map(
          r => activeASPStatus(status.answer, status.failed, r, status.fetchedAt, nowMs).screening);
        const screening = screenings[PRIVACY_POOLS.findIndex(r => r.key === ref.key)] ?? null;
        const due = publishNeeded(
          PRIVACY_POOLS.map(r => slotsRef.current[r.key].state),
          screenings,
        );

        // 3. Association-set membership is proved from public events on this device, against the pool's current root
        // only: the device rebuilds that root's member list from its recipe and its own events and checks it, finds this
        // note in it, and asks its questions about the crowd, all before the operator sees any request about this
        // withdrawal; only then the label-free publish request, if one is due (shared/privacy/associationSet.ts
        // resolveAssociationProof). The label is never sent anywhere.
        step({ stage: "preparing", message: "Building the association-set proof on this device" });
        let published: PublishAnswer | null = null;
        const ask = async (q: WithdrawalQuestion): Promise<boolean> => {
          const context = { beforeRequest: q.beforeRequest, publishes: q.publishes };
          if (q.kind === "shrink") {
            const s = q.alarm;
            const deposits = `${s.to} deposit${s.to === 1 ? "" : "s"}`;
            const what = s.basis === "form" ? `holds ${deposits}; the withdraw form showed ${s.from}` : `shrank from ${s.from} deposits to ${deposits}`;
            step({ stage: "preparing", crowd: s.to, message: `The association set on ${name} ${what}. Waiting for your choice.` });
            if (confirmShrink && (await confirmShrink(s, context))) return true;
            throw new Error(
              s.basis === "form"
                ? `No withdrawal was sent: the association set this withdrawal would be proved in on ${name} holds ${deposits}, fewer than the ${s.from} the form showed. Check the form again before you withdraw.`
                : `No withdrawal was sent: the association set on ${name} shrank from ${s.from} deposits to ${deposits} (${s.removed} taken out${
                    s.announced > 0
                      ? `, ${s.announced} of them only announced by the operator`
                      : ""
                  }${s.unexplained > 0 ? `, ${s.unexplained} with no reason from the operator` : ""}). Try again when the set has grown again.`,
            );
          }
          const crowd = q.crowd;
          const deposits = `${crowd} deposit${crowd === 1 ? "" : "s"}`;
          // members the operator's status announces for exclusion are not counted, so the root on-chain is named apart:
          // the crowd is what this app counts, not the set on-chain, and only the operator could narrow it that far
          const counted =
            q.announced > 0
              ? `this app counts only ${deposits} in the association set on ${name} (the root on-chain holds ${q.onChain}; the operator's status announces ${q.announced} of them for exclusion)`
              : null;
          step({ stage: "preparing", crowd, message: `${counted ? `${counted[0].toUpperCase()}${counted.slice(1)}` : `The association set on ${name} has only ${deposits}`}. Waiting for your choice.` });
          if (confirmSmallSet && (await confirmSmallSet(crowd, { ...context, expected: q.expected, onChain: q.onChain, announced: q.announced }))) return true;
          throw new Error(
            counted
              ? `No withdrawal was sent: ${counted}, so the operator could narrow this withdrawal to ${crowd === 1 ? "your deposit" : "one of them"}. Try again when more deposits are in the set.`
              : `No withdrawal was sent: ${
                  q.beforeRequest
                    ? `only ${deposits} ${crowd === 1 ? "is" : "are"} in the association set now`
                    : `it would be proved in an association set of only ${deposits}`
                }, so an observer could narrow it to ${crowd === 1 ? "your deposit" : "one of them"}. Try again when more deposits are in the set.`,
          );
        };
        const aspProof = await resolveAssociationProof({
          label: live.label,
          state: { events: p.events, currentRoot: p.aspRoot },
          reload: async () => {
            await sync({ poolKey: ref.key });
            const s = slotsRef.current[ref.key].state;
            return { events: s.events, currentRoot: s.aspRoot };
          },
          // Fail closed: only the current root, and only when the pool contract reports it as known.
          isKnownRoot: root =>
            publicClientFor(ref.chainId).readContract({ address: ref.pool, abi: PRIVACY_POOL_ABI, functionName: "isKnownASPRoot", args: [root] }),
          // Only when this device's events lack the current root's ASPRootUpdated event (its log RPC is behind its
          // contract reads): first the record the status answer already brought (no request), then every pool's
          // public record, the same for every caller, never one label. This pool's { root, cid } is used only when the
          // root is the current one and the cid rebuilds to it from this device's own events; server labels never are.
          record: statusRecord(screening),
          fetchRootRecord: async () => {
            const answer = await api.sets();
            const entry = answer && Array.isArray(answer.sets) ? answer.sets.find(s => isPool(s, ref)) : undefined;
            // superjson carries the root as a bigint: anything else is no record
            if (!entry || typeof entry.root !== "bigint") return null;
            return { root: entry.root, cid: typeof entry.cid === "string" ? entry.cid : null };
          },
          // The operator's announced exclusions (its claim): they can only hold this app back, never mark a deposit
          // excluded or point at the public exit (shared/privacy/associationSet.ts).
          announced: announcedExclusions(screening),
          // the same decision for every withdrawal, never this note's
          publishDue: due,
          // the crowd the form showed (the same for every note it lets start): compared once the request is answered
          expectedCrowd,
          ask,
          // Called only when the request is due, after this note was found in the checked root and the questions about
          // its crowd were answered: send it, then read this pool's result.
          requestPublish: async () => {
            step({ stage: "preparing", message: PUBLISH_MESSAGE });
            published = await api.publish().catch(() => null);
            const r = publishResultFor(published, ref);
            const root = r ? decimalRoot(r.root) : null;
            if (!r || root === null) return null;
            if (r.status === "published") return root;
            if (r.status === "pending" && r.txHash) {
              step({ stage: "preparing", message: `Waiting for the new association-set root on ${name}` });
              return (await waitForPublishedRoot(ref, r.txHash)) ? root : null;
            }
            // unfunded, no key, not the postman, paused (policy_error), nothing new, or a transaction already in flight
            // (pending without a hash): no new root now; the proof uses the current root
            return null;
          },
        }).catch((err: unknown) => {
          if (err instanceof AssociationProofError) {
            // this pool's publish result, when one was asked for: it explains a missing root (an unfunded publisher, a
            // paused one, a deposit not admitted yet) better than the general message
            const publishStatus = publishResultFor(published, ref)?.status ?? null;
            const better =
              err.code === "NO_PUBLISHED_ROOT"
                ? noRootMessage(publishStatus, name, inclusionDelay(screening, ref.chainId))
                : err.code === "WAITING" && err.detail !== "announced"
                  ? waitingMessage(publishStatus, name)
                  : null;
            if (better) throw new AssociationProofError(err.code, better, { detail: err.detail, reason: err.reason });
          }
          throw err;
        });
        // The crowd this withdrawal is judged by: the root's members minus those whose exclusion the operator's status
        // answer announces. That answer can differ for each visitor, and this app holds an announced member back, so to
        // the operator a withdrawal from this app can only be one of the others. Every question about it was asked above.
        const crowd = aspProof.effectiveSize;
        const announcedOut = aspProof.announcedOut;

        let relayer: Address = zeroAddress;
        let fee = 0n;
        let deadline = 0n;
        if (via === "relayer") {
          // this pool's own quote: another network's (or none) fails closed, saying why before anything is proved
          const quotes = await api.quotes(relayerEntry).catch(() => null);
          const quote = quoteFor(quotes, ref);
          if (!quote) throw new Error(relayerDownMessage(quotes, ref));
          fee = checkedRelayerFee(quote, amountWei, maxRelayerFeeWei);
          relayer = quote.relayer!;
          deadline = BigInt(quote.expiresAt);
        }
        const context = computeContext(scope, { recipient, relayer, fee, deadline });
        const next = RUNTIME.nextSecrets(k, scope, live);

        step({ stage: "downloading", crowd, announcedOut, message: "Loading proving artifacts" });
        const artifacts = await loadArtifacts("withdraw", progress =>
          setOp(o => (o.stage === "downloading" ? { ...o, progress } : o)),
          ref.artifacts,
        );
        step({ stage: "proving", crowd, announcedOut, message: "Generating zero-knowledge proof on this device" });
        const result = await proveWithdraw(
          {
            withdrawnValue: amountWei,
            stateRoot: stateProof.root,
            ASPRoot: aspProof.root,
            context,
            label: live.label,
            existingValue: live.value,
            existingNullifier: live.nullifier,
            existingSecret: live.secret,
            newNullifier: next.nullifier,
            newSecret: next.secret,
            stateSiblings: stateProof.siblings,
            stateIndex: stateProof.index,
            ASPSiblings: aspProof.siblings,
            ASPIndex: aspProof.index,
          },
          artifacts,
        );
        const ps = result.publicSignals;
        if (
          ps[WITHDRAW_PUBLIC_SIGNALS.withdrawnValue] !== amountWei ||
          ps[WITHDRAW_PUBLIC_SIGNALS.stateRoot] !== stateProof.root ||
          ps[WITHDRAW_PUBLIC_SIGNALS.ASPRoot] !== aspProof.root ||
          ps[WITHDRAW_PUBLIC_SIGNALS.context] !== context ||
          ps[WITHDRAW_PUBLIC_SIGNALS.existingNullifierHash] !== live.nullifierHash
        ) {
          throw new Error("Prover returned unexpected public signals; aborting");
        }

        const withdrawal = { recipient, relayer, fee, deadline };
        if (
          sessionRef.current?.opened !== opened ||
          !storedVaultIs(sessionRef.current.fingerprint)
        )
          throw new Error(VAULT_CHANGED);
        if (
          via === "relayer" &&
          deadline <= BigInt(Math.floor(Date.now() / 1000) + 30)
        ) {
          throw new Error(
            "The relayer quote expired while proving. Review a fresh quote and try again. Nothing was sent."
          );
        }
        let txHash: Hex;
        if (via === "relayer") {
          // a relayed withdrawal never touches the wallet; it names its network to the relayer, which sends it there
          step({ stage: "submitting", crowd, announcedOut, message: `Sending the proof to the relayer for ${name}` });
          // the relayer simulates first: a root that newer roots pushed out of the pool's 16 is refused, nothing sent
          const res = await api.submit(relayerEntry, { chainId: ref.chainId, withdrawal, proof: result.proof, pubSignals: [...ps] }).catch((err: unknown) => {
            throw staleRootError(err) ?? err;
          });
          if (typeof res?.chainId === "number" && res.chainId !== ref.chainId) throw new Error(`The relayer answered for another network than ${name}`);
          txHash = res.txHash;
        } else {
          // pay-your-own-gas: the wallet switches now, after proving
          step({ stage: "awaiting_wallet", crowd, announcedOut, message: walletPrompt(ref, "withdrawal") });
          const lost = (err: unknown) =>
            err instanceof WalletChainFailure ? new WalletChainFailure(err.code, `${err.message} ${SELF_RELAY_PROOF_LOST}`) : err;
          let wallet: WalletClient;
          try {
            wallet = await requireWallet(ref, "withdraw");
          } catch (err) {
            throw lost(err);
          }
          step({ stage: "awaiting_wallet", crowd, announcedOut, message: `Confirm the withdrawal on ${name} in your wallet` });
          if (
            sessionRef.current?.opened !== opened ||
            !storedVaultIs(sessionRef.current.fingerprint)
          )
            throw new Error(VAULT_CHANGED);
          txHash = await wallet
            .writeContract({
              address: ref.pool,
              abi: PRIVACY_POOL_ABI,
              functionName: "withdraw",
              args: [withdrawal, result.proof, ps as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint]],
              account: wallet.account,
              chain: ref.network.chain,
            })
            .catch((err: unknown) => {
              // the wallet estimates first: a root no longer accepted reverts there, before anything is sent
              throw (
                staleRootError(err) ?? lost(writeError(err, ref, "withdraw")));
            });
        }
        updateActivity(id, { txHash, feeWei: fee });
        step({ stage: "pending", txHash, crowd, announcedOut, message: `Waiting for confirmation on ${name}` });
        const receipt = await waitForReceipt(ref, txHash);
        if (receipt.status !== "success") throw new Error("Withdrawal transaction reverted");
        updateActivity(id, { status: "confirmed" });
        step({ stage: "confirmed", txHash, crowd, announcedOut, message: `Withdrawal confirmed on ${name}` });
      } catch (err) {
        const msg = errorMessage(err);
        updateActivity(id, { status: "failed", error: msg });
        step({ stage: "failed", error: msg });
        throw err;
      } finally {
        end();
        // its outcome is in the log: a lock asked for meanwhile happens now (the sync below needs no key)
        finishOp(opened);
      }
      await sync({ poolKey: ref.key });
    },
    [opPool, requireReady, begin, end, finishOp, addActivity, updateActivity, sync, api],
  );

  const ragequit = useCallback(
    async (note: Note, key?: PoolKey) => {
      const ref = opPool(key);
      const { notes: n, opened } = requireReady(ref);
      if (note.spent) throw new Error("This note is already spent");
      if (!n.list.some(x => x.commitment === note.commitment)) throw new Error(`That note is not in the ${ref.network.name} pool`);
      const name = ref.network.name;
      const at = { chainId: ref.chainId, pool: ref.pool };
      const id = newId();
      begin(opened);
      try {
        addActivity({ id, kind: "ragequit", status: "pending", createdAt: Date.now(), updatedAt: Date.now(), amountWei: note.value, via: "self", ...at });
        // the wallet switches first, then the depositor is checked on that same network
        setOp({ kind: "ragequit", stage: "awaiting_wallet", message: walletPrompt(ref, "exit"), ...at });
        const wallet = await requireWallet(ref, "exit");
        setOp({ kind: "ragequit", stage: "preparing", message: `Checking the depositor on ${name}`, ...at });
        const depositor = await publicClientFor(ref.chainId).readContract({
          address: ref.pool,
          abi: PRIVACY_POOL_ABI,
          functionName: "depositors",
          args: [note.label],
        });
        if (depositor.toLowerCase() !== wallet.account.address.toLowerCase()) {
          throw new Error(`Ragequit must be sent from the original depositor (${depositor})`);
        }
        setOp({ kind: "ragequit", stage: "downloading", message: "Loading proving artifacts", ...at });
        const artifacts = await loadArtifacts("commitment", progress =>
          setOp(o => (o.stage === "downloading" ? { ...o, progress } : o)),
          ref.artifacts,
        );
        setOp({ kind: "ragequit", stage: "proving", message: "Generating ownership proof", ...at });
        const result = await proveCommitment(
          { value: note.value, label: note.label, nullifier: note.nullifier, secret: note.secret },
          artifacts,
        );
        const ps = result.publicSignals;
        if (ps[COMMITMENT_PUBLIC_SIGNALS.commitment] !== note.commitment || ps[COMMITMENT_PUBLIC_SIGNALS.nullifierHash] !== note.nullifierHash) {
          throw new Error("Prover returned unexpected public signals; aborting");
        }
        setOp({ kind: "ragequit", stage: "awaiting_wallet", message: `Confirm the exit on ${name} in your wallet`, ...at });
        const txHash = await wallet
          .writeContract({
            address: ref.pool,
            abi: PRIVACY_POOL_ABI,
            functionName: "ragequit",
            args: [result.proof, ps as unknown as readonly [bigint, bigint, bigint, bigint]],
            account: wallet.account,
            chain: ref.network.chain,
          })
          .catch((err: unknown) => {
            throw writeError(err, ref, "exit");
          });
        updateActivity(id, { txHash });
        setOp({ kind: "ragequit", stage: "pending", txHash, message: `Waiting for confirmation on ${name}`, ...at });
        const receipt = await waitForReceipt(ref, txHash);
        if (receipt.status !== "success") throw new Error("Ragequit transaction reverted");
        updateActivity(id, { status: "confirmed" });
        setOp({ kind: "ragequit", stage: "confirmed", txHash, message: `Exit confirmed on ${name}`, ...at });
      } catch (err) {
        const msg = errorMessage(err);
        updateActivity(id, { status: "failed", error: msg });
        setOp({ kind: "ragequit", stage: "failed", error: msg, ...at });
        throw err;
      } finally {
        end();
        finishOp(opened);
      }
      await sync({ poolKey: ref.key });
    },
    [opPool, requireReady, begin, end, finishOp, addActivity, updateActivity, sync],
  );

  // ── views ──
  const viewCache = useRef(new WeakMap<PoolSlot, PoolView>());
  const pools = useMemo<PoolView[]>(
    () =>
      PRIVACY_POOLS.map(ref => {
        const slot = slots[ref.key];
        let view = viewCache.current.get(slot);
        if (!view) {
          view = { ref, state: slot.state, notes: slot.notes, spendable: spendableNotes(slot.notes.list), balance: privateBalance(slot.notes.list) };
          viewCache.current.set(slot, view);
        }
        return view;
      }),
    [slots],
  );
  const networks = useMemo<NetworkView[]>(
    () =>
      PRIVACY_NETWORKS.map(n => ({
        network: n.network,
        pool: n.pool ? (pools.find(v => v.ref.key === n.pool!.key) ?? null) : null,
        problem: n.problem,
      })),
    [pools],
  );
  const activeView = activePool ? (pools.find(v => v.ref.key === activePool.key) ?? null) : null;

  // The same set object while its members stay the same, so consumers' memos hold across syncs.
  const depositorsRef = useRef<ReadonlySet<string>>(new Set());
  const ownDepositors = useMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>();
    for (const v of pools) {
      if (v.notes.list.length === 0) continue;
      const labels = new Set(v.notes.list.map(n => n.label));
      for (const e of v.state.events) if (e.kind === "deposit" && labels.has(e.label)) set.add(e.depositor.toLowerCase());
    }
    const prev = depositorsRef.current;
    if (prev.size === set.size && [...set].every(a => prev.has(a))) return prev;
    depositorsRef.current = set;
    return set;
  }, [pools]);

  const publishEligibilityRoot = useCallback(async (): Promise<Hex | null> => {
    const ref = opPool();
    if (ref.chainId !== 1 || ref.protocol !== "hylsia-pp-v2-eth") throw new Error("Wallet publication is available for the Ethereum native ETH pool.");
    if (busyRef.current) throw new Error("Wait for the current transaction to finish.");
    busyRef.current = true;
    setBusy(true);
    try {
      await syncPool(ref, true);
      const state = slotsRef.current[ref.key].state;
      if (state.status !== "ready" || !state.historyVerified || !state.inSync) throw new Error("Sync the complete pool history before publishing.");
      const answer = await utils.client.privacy.asp.status.query();
      const status = answer.pools.find(entry => entry.chainId === ref.chainId && entry.pool.toLowerCase() === ref.pool.toLowerCase());
      if (!status?.screening) throw new Error("The screening policy is unavailable. Nothing was sent.");
      const hash = await publishWalletRoot({ ref, events: state.events, screening: status.screening, client: publicClientFor(ref.chainId), getWallet: () => requireWallet(ref, "withdraw") });
      if (hash) {
        const receipt = await waitForReceipt(ref, hash);
        if (receipt.status !== "success") throw new Error("The root publication reverted.");
        await syncPool(ref, true);
        await utils.privacy.asp.status.invalidate();
      }
      return hash;
    } finally { end(); }
  }, [opPool, syncPool, utils, end]);

  const value = useMemo<PrivacyContextValue>(
    () => ({
      configured,
      pool: activeView?.state ?? emptyPool,
      vault,
      keys,
      notes: activeView?.notes ?? EMPTY_NOTES,
      spendable: activeView?.spendable ?? NO_NOTES,
      balance: activeView?.balance ?? 0n,
      networks,
      pools,
      activePool,
      setActivePool,
      busy,
      ownDepositors,
      // The log pairs deposits with withdrawal recipients: shown only while the vault is unlocked.
      activity: vault.status === "unlocked" ? activity : NO_ACTIVITY,
      activityNotice: vault.status === "unlocked" ? activityNotice : NO_NOTICE,
      discardSetAsideLog,
      op,
      sync,
      createVault,
      unlock,
      lock,
      lockPending: vault.status === "unlocked" && lockPending,
      exportBackup,
      verifyBackup,
      importBackup,
      forgetVault,
      deposit,
      withdraw,
      ragequit,
      resetOp,
      publishEligibilityRoot,
    }),
    [
      configured, activeView, vault, keys, networks, pools, activePool, setActivePool, busy, ownDepositors, activity,
      activityNotice, discardSetAsideLog, op, sync, createVault, unlock, lock, lockPending, exportBackup, verifyBackup,
      importBackup, forgetVault, deposit, withdraw, ragequit, resetOp, publishEligibilityRoot,
    ],
  );

  return (
    <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
  );
}

export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error("usePrivacy must be used inside <PrivacyProvider>");
  return ctx;
}
