/**
 * Two-network end-to-end acceptance on two local anvils ("Tahap 2 — Prototipe lokal"), with the association set's
 * screening policy v1 (Phase 4).
 *
 * Hylsia is built for Robinhood Chain Testnet, and its code serves any list of networks side by side. So chain A runs
 * with Robinhood Chain Testnet's chain id (46630) and chain B is Local chain B (31338). Both are anvils on 127.0.0.1:
 * nothing here talks to a public network. Both pools are deployed by the same anvil key at the same nonce, so they
 * share ONE address on purpose: everything must keep them apart by (chainId, pool), never by the address alone.
 *
 * It drives the code the browser and the server use: the server modules in multi mode (PRIVACY_CHAIN_IDS), and the
 * device's side from shared/privacy and client/src/privacy/publicData.ts (note discovery from public events, the
 * association-set proof built and checked on the device, the label-free publish request decided from the operator's
 * input-less status answer, the note states the vault shows, Groth16 proofs from the served artifacts in client/public/zk).
 *
 *   setup      two anvils with different genesis times; Deploy.s.sol on each (records in contracts/deployments/local/,
 *              broadcast logs in a temp dir); same pool address, different SCOPE; verifier code = the compiled code;
 *              the public records untouched; the server modules for both chains (inclusion delay 0 on both, an empty
 *              exclusion list in a temp file); one vault with a v2 backup
 *   chain A    the full scenario: deposit → publish → association-set proof on the device (one fixed order of calls,
 *              whatever the note) → relayed withdrawal → change note → recovery → self-relayed withdrawal → a deposit not
 *              in the current root waits → one label-free publish request for every pool → lagging device (the
 *              current root's record from privacy.asp.set; a crafted record and a hole refused) → ragequit
 *   chain B    no root yet → deposit → one publish for every pool (B published, A current) → relayed withdrawal at
 *              B's fee → restore from the same v2 backup (A's notes on A, B's on B, none across)
 *   negatives  a chain-A proof relayed to B (local BAD_REQUEST, nothing sent; ContextMismatch on B); a chain-A
 *              ragequit on B (NotDepositor); publish isolation; the server's per-chain views; a withdrawal on A while
 *              only B is behind; a pending publish (one transaction; the device waits on B's own client); a wallet on B
 *              asked to send A's deposit (ChainMismatchError, nothing sent)
 *   funding    on B, a relayer and a publisher without testnet ETH: the quote, the pool's services and the publish say
 *              so, a relayed withdrawal is refused before anything is sent; once funded, the periodic publisher's tick
 *              posts the root once and then nothing
 *   screening  on A, with an inclusion delay of 3600 s (anvil time travel) and the operator's exclusion list:
 *              1. the delay: deposits wait; at +3599 s still waiting, at +3600 s the tick posts the recipe root;
 *              2. a deposit listed before it is screened: announced, never admitted, EXCLUDED on the device, ragequit;
 *              3. a removal after inclusion: announced (the app holds back, no public-exit advice; an edited answer holds
 *                 it back too; one that announces every member but one, with a root due, leaves a crowd of 1 that the
 *                 app asks about before any request, and its rootDue sends nothing, on either network; one that leaves 9 gets the
 *                 small-set question first), then a new root without it; the 16-root window measured: older roots that
 *                 hold it stay known (the relayer refuses them, a direct call still passes) through 2 natural roots,
 *                 then the opt-in eviction burst (13 re-posts) closes it, per post; the in-flight proof fails with
 *                 UnknownASPRoot and is made again; a proof made after the removal survives the burst;
 *              4. the exclusion lifted: held while the list is younger than 30 s, held by the vault until the periodic
 *                 publisher's root re-admits it, then withdrawn;
 *              5. an invalid list pauses publishing (policy_error, nothing sent); the same requests for every note;
 *              6. roots from another publisher: a list that is no subsequence, an open-policy root after screened ones,
 *                 the same root with a record that does not match it: refused on the device, repaired by the server;
 *              7. a root that drops 10 of 21 members nobody announced, posted right after the device's publish
 *                 request: the withdrawal stops for every note alike (SET_CHANGED); the next attempt gets the shrink
 *                 question before any request, still after the operator re-posts the small root 15 times and after 16
 *                 roots that verify nowhere (neither hides the larger root);
 *              8. a root of a newer policy: the device says reload, the server pauses; everything left exits
 *   end        both pool balances are 0; no exclusion note and no key appeared in any answer or log line; the two
 *              records in contracts/deployments/local/ are removed again
 *
 * Prints the gas each deposit, relayed withdrawal, ragequit and root post used (anvil receipts), and the window
 * measurement (roots, blocks, seconds, gas min/avg/max and the cost at 0.01 gwei).
 *
 * Prereqs: foundry (anvil + forge) on PATH and the served artifacts in client/public/zk, as they are: this script
 * proves with them and deploys the verifiers in contracts/src/verifiers, and never rebuilds either.
 * Usage:   npm run zk:e2e      (ports: E2E_ANVIL_PORT_A, default 8547; E2E_ANVIL_PORT_B, default 8548)
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  BaseError,
  ChainMismatchError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  keccak256,
  parseEther,
  toHex,
  zeroAddress,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvilKey } from "./anvilKeys";
import { PRIVACY_POOL_ABI } from "../../shared/privacy/abi";
import type { ASPScreening, ASPStatusAnswer, ASPStatusEntry, PublishResult } from "../../shared/privacy/api";
import {
  AssociationProofError,
  associationSetLabels,
  buildAssociationProof,
  buildAssociationSet,
  prefixSizes,
  publishedASPRoots,
  resolveAssociationProof,
  SMALL_ASSOCIATION_SET,
  type AssociationProof,
  type AssociationProofInput,
  type PublicPoolState,
  type RootRecordAnswer,
  type WithdrawalQuestion,
} from "../../shared/privacy/associationSet";
import { getPrivacyChain } from "../../shared/privacy/chains";
import { ASP_ROOT_HISTORY_SIZE } from "../../shared/privacy/constants";
import { computeContext, computeScope, type WithdrawalRequest } from "../../shared/privacy/context";
import { buildStateTree, discoverNotes, fetchPoolEvents, privateBalance, spendableNotes } from "../../shared/privacy/indexer";
import { MerkleTree, type MerkleProof } from "../../shared/privacy/merkleTree";
import { networkById, pickPoolEntry, samePool } from "../../shared/privacy/networks";
import { computePrecommitment, deriveMasterKeys, deriveNoteSecrets, type MasterKeys, type Note } from "../../shared/privacy/notes";
import { proveCommitment, proveWithdraw } from "../../shared/privacy/prover";
import {
  announcedExclusions,
  checkRoot,
  depositOf,
  depositsInLeafOrder,
  formatRecipe,
  parseRecipe,
  publishDue,
  publishDueAcross,
  recipeLabels,
  rootRecordOf,
  setRoot,
  SHRINK_ALARM_ROOTS,
  type RecipeV1,
} from "../../shared/privacy/screening";
import { WITHDRAW_PUBLIC_SIGNALS, type ASPRootUpdatedEvent, type PoolEvent } from "../../shared/privacy/types";
import { encodeSnapshot, parseSnapshot, SNAPSHOT_FORMAT, SNAPSHOT_VERSION, treeEventsOf, verifySnapshotAgainstChain, type PoolSnapshot } from "../../shared/privacy/snapshot";
import { decryptSeed, encryptSeedV2, generateSeed } from "../../shared/privacy/vault";
// the vault's own pure selectors (what the Notes, Withdraw and My notes views show), on this run's public data
import { activeASPStatus, activePoolActivity, noteScreening, offersPublicExit, statusRecord, withdrawHold, type NoteScreening } from "../../client/src/privacy/publicData";
import { forgeChildEnv } from "./deploymentRecords";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CONTRACTS = path.join(ROOT, "contracts");
const CHAIN_A = 46630; // Robinhood Chain Testnet's id, on a local anvil
const CHAIN_B = 31338; // Local chain B, a second anvil
/** another workflow's anvil */
const RESERVED_PORTS = new Set([8617]);
const PASSWORD = "e2e-password-123";
const FEE_BPS_A = 100;
const FEE_BPS_B = 50;
const MIN_FEE_B = parseEther("0.001");
/** the screening section's inclusion delay on A: Robinhood Chain Testnet's default (the rest of the run uses 0) */
const DELAY_A = 3600;
/** gas limit of a deposit sent while blocks are held (one block for several deposits; one uses about 0.99 M) */
const DEPOSIT_GAS = 1_300_000n;
/** 0.01 gwei, the testnet's gas price for the cost figures */
const PRICE_001_GWEI = 10_000_000n;
/** written as the `note` of every exclusion entry: it must never appear in an answer or a log line */
const SENTINEL = `e2e-sentinel-note-${randomBytes(6).toString("hex")}`;

// anvil default accounts #0-#4: public test keys, derived at run time from anvil's public mnemonic (anvilKeys.ts)
const KEYS = {
  deployer: anvilKey(0), // also the postman on both pools
  alice: anvilKey(1),
  relayer: anvilKey(2), // one relayer for both networks
  bob: anvilKey(3),
  carol: anvilKey(4), // the other depositors' wallet in the screening section
} as const;
const ALICE = privateKeyToAccount(KEYS.alice).address;
const BOB = privateKeyToAccount(KEYS.bob).address;
const RELAYER = privateKeyToAccount(KEYS.relayer).address;
const POSTMAN = privateKeyToAccount(KEYS.deployer).address;
// fresh recipients, never used before
const RECIPIENT = {
  a1: "0x00000000000000000000000000000000000000a1",
  a2: "0x00000000000000000000000000000000000000a2",
  a3: "0x00000000000000000000000000000000000000a3",
  a4: "0x00000000000000000000000000000000000000a4",
  a5: "0x00000000000000000000000000000000000000a5",
  a6: "0x00000000000000000000000000000000000000a6",
  a7: "0x00000000000000000000000000000000000000a7",
  a8: "0x00000000000000000000000000000000000000a8",
  b1: "0x00000000000000000000000000000000000000b1",
  b2: "0x00000000000000000000000000000000000000b2",
  b3: "0x00000000000000000000000000000000000000b3",
} as const satisfies Record<string, Address>;

const step = (msg: string) => console.log(`\n▶ ${msg}`);
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const eth = (v: bigint) => `${formatEther(v)} ETH`;
const sig6 = (s: readonly bigint[]) => s as unknown as readonly [bigint, bigint, bigint, bigint, bigint, bigint];
const sig4 = (s: readonly bigint[]) => s as unknown as readonly [bigint, bigint, bigint, bigint];

function envPort(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  const p = raw ? Number(raw) : fallback;
  if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error(`${name}: "${raw}" is not a port`);
  if (RESERVED_PORTS.has(p)) throw new Error(`${name}: port ${p} belongs to another workflow; pick another`);
  return p;
}

/** The e2e talks to 127.0.0.1 only. */
function assertLocalRpc(url: string) {
  const u = new URL(url);
  if (u.protocol !== "http:" || u.hostname !== "127.0.0.1") throw new Error(`refusing RPC ${u.host}: the e2e talks to 127.0.0.1 only`);
}

// ─── anvils ───────────────────────────────────────────────────────────────────

const anvils: ChildProcess[] = [];
function stopAnvils() {
  for (const p of anvils.splice(0)) if (p.exitCode === null && p.signalCode === null) p.kill("SIGTERM");
}
for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.once(signal, () => {
    stopAnvils();
    removeLocalRecords();
    process.exit(code);
  });
}

function portAnswers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (v: boolean) => {
      socket.destroy();
      resolve(v);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1_000, () => done(false));
  });
}

async function startAnvil(port: number, chainId: number, genesisTimestamp: number): Promise<string> {
  if (await portAnswers(port)) throw new Error(`port ${port} already answers; stop that process or set another E2E_ANVIL_PORT_*`);
  const rpc = `http://127.0.0.1:${port}`;
  assertLocalRpc(rpc);
  const proc = spawn(
    "anvil",
    ["--host", "127.0.0.1", "--port", String(port), "--chain-id", String(chainId), "--timestamp", String(genesisTimestamp), "--block-time", "1", "--silent"],
    { stdio: "ignore" },
  );
  proc.on("error", (err) => console.error(`anvil on :${port}: ${err.message}`));
  anvils.push(proc);
  return rpc;
}

async function waitForChain(client: PublicClient, chainId: number) {
  for (let i = 0; i < 100; i++) {
    let id: number;
    try {
      id = await client.getChainId();
    } catch {
      await sleep(100);
      continue;
    }
    assert(id === chainId, `eth_chainId is ${id}, expected ${chainId}`);
    return;
  }
  throw new Error(`the anvil for chain ${chainId} did not start`);
}

/** anvil's own methods (interval mining, time travel), on a local RPC only */
async function anvilRpc(c: Ctx, method: string, params: unknown[]) {
  assertLocalRpc(c.rpc);
  await c.pub.request({ method: method as never, params: params as never });
}

/**
 * How the anvil mines: "interval" (a block every second, as started), "auto" (a block per transaction, and on
 * evm_mine: block times are then set exactly with evm_setNextBlockTimestamp) or "held" (no block until evm_mine).
 */
async function setMining(c: Ctx, mode: "interval" | "auto" | "held") {
  if (mode === "interval") {
    await anvilRpc(c, "evm_setAutomine", [false]);
    await anvilRpc(c, "evm_setIntervalMining", [1]);
    return;
  }
  await anvilRpc(c, "evm_setIntervalMining", [0]);
  await anvilRpc(c, "evm_setAutomine", [mode === "auto"]);
}

/** Mine one block with exactly this block time (unix seconds). */
async function mineAt(c: Ctx, time: number) {
  await anvilRpc(c, "evm_setNextBlockTimestamp", [toHex(time)]);
  await anvilRpc(c, "evm_mine", []);
}

/** The head block's time (unix seconds). */
const headTime = async (c: Ctx) => Number((await c.pub.getBlock({ blockTag: "latest" })).timestamp);

// ─── deployment ───────────────────────────────────────────────────────────────

interface DeploymentRecord {
  chainId: number;
  protocol?: string;
  deployer?: Address;
  pool: Address;
  withdrawVerifier: Address;
  commitmentVerifier: Address;
  owner: Address;
  aspPostman: Address;
  scope: string;
  minDepositWei: string;
  deployBlock: string;
}

/**
 * The records and the project's broadcast logs for both ids (46630's is the live pool's record): they must not change
 * (sha256, or "absent"). sync-deployments merges contracts/broadcast/Deploy.s.sol/<id>/run-latest.json, so an anvil run
 * must never land there.
 */
const publicOutputs = () =>
  [CHAIN_A, CHAIN_B]
    .flatMap((id) => [path.join(CONTRACTS, "deployments", `${id}.json`), path.join(CONTRACTS, "broadcast", "Deploy.s.sol", String(id), "run-latest.json")])
    .map((file) => (fs.existsSync(file) ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "absent"))
    .join(",");

/** The records this run wrote in contracts/deployments/local/ (removed at the end: their anvils are gone). */
const localRecords: string[] = [];
function removeLocalRecords() {
  for (const file of localRecords.splice(0)) fs.rmSync(file, { force: true });
  const dir = path.join(CONTRACTS, "deployments", "local");
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // absent, or not empty: leave it
  }
}

function deploy(chainId: number, rpc: string, broadcastDir: string): DeploymentRecord {
  assertLocalRpc(rpc);
  const out = `deployments/local/${chainId}.json`;
  fs.rmSync(path.join(CONTRACTS, out), { force: true });
  localRecords.push(path.join(CONTRACTS, out));
  // forge's own overrides (FOUNDRY_* / DAPP_*, e.g. FOUNDRY_LIBRARIES) never reach the deployment; then this run's outputs
  const env: NodeJS.ProcessEnv = {
    ...forgeChildEnv(process.env),
    PRIVACY_DEPLOYER_PRIVATE_KEY: KEYS.deployer,
    PRIVACY_POOL_OWNER: "",
    PRIVACY_ASP_POSTMAN: "",
    PRIVACY_MIN_DEPOSIT_WEI: "",
    PRIVACY_DEPLOYMENT_OUT: out,
    FOUNDRY_BROADCAST: broadcastDir,
  };
  execFileSync("forge", ["script", "script/Deploy.s.sol:Deploy", "--rpc-url", rpc, "--broadcast", "--silent"], { cwd: CONTRACTS, stdio: "inherit", env });
  return JSON.parse(fs.readFileSync(path.join(CONTRACTS, out), "utf8")) as DeploymentRecord;
}

const compiledCode = (contract: string): Hex =>
  JSON.parse(fs.readFileSync(path.join(CONTRACTS, "out", `${contract}.sol`, `${contract}.json`), "utf8")).deployedBytecode.object as Hex;

function loadArtifacts(name: "withdraw" | "commitment") {
  // Same integrity rule the browser enforces (sha256 against the manifest).
  const dir = path.join(ROOT, "client", "public", "zk");
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const read = (entry: { path: string; sha256: string }) => {
    const bytes = fs.readFileSync(path.join(dir, entry.path));
    assert(createHash("sha256").update(bytes).digest("hex") === entry.sha256, `integrity of ${entry.path}`);
    return new Uint8Array(bytes);
  };
  return { wasm: read(manifest.circuits[name].wasm), zkey: read(manifest.circuits[name].zkey) };
}

function revertName(err: unknown): string {
  if (err instanceof BaseError) {
    const r = err.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    return r?.data?.errorName ?? err.shortMessage;
  }
  return String(err);
}
async function revertOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "no revert";
  } catch (err) {
    return revertName(err);
  }
}

/** Why the device refused to build an association-set proof: "CODE" or "CODE/detail"; "proved" when it did not refuse. */
async function proofError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "proved";
  } catch (err) {
    if (err instanceof AssociationProofError) return err.detail ? `${err.code}/${err.detail}` : err.code;
    throw err;
  }
}

/** JSON with bigints as decimal text (for the checks that an answer never holds a note or a key) */
const jsonOf = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

const minOf = (xs: readonly bigint[]) => xs.reduce((a, b) => (b < a ? b : a));
const maxOf = (xs: readonly bigint[]) => xs.reduce((a, b) => (b > a ? b : a));
const sumOf = (xs: readonly bigint[]) => xs.reduce((a, b) => a + b, 0n);

// ─── one chain, as the device sees it ─────────────────────────────────────────

interface Ctx {
  chainId: number;
  name: string;
  chain: Chain;
  rpc: string;
  pub: PublicClient;
  pool: Address;
  scope: bigint;
  scanFrom: bigint;
}

function makeCtx(chainId: number, rpc: string): Ctx {
  assertLocalRpc(rpc);
  const chain = getPrivacyChain(chainId);
  // The chain object names the network; the transport is the local anvil (never the chain's public RPC).
  const pub = createPublicClient({ chain, transport: http(rpc), pollingInterval: 200 }) as PublicClient;
  return { chainId, name: networkById(chainId)!.name, chain, rpc, pub, pool: zeroAddress, scope: 0n, scanFrom: 0n };
}

const wallet = (c: Ctx, key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain: c.chain, transport: http(c.rpc), pollingInterval: 200 });
const currentRoot = (c: Ctx) => c.pub.readContract({ address: c.pool, abi: PRIVACY_POOL_ABI, functionName: "currentASPRoot" });
const isKnownRootOf = (c: Ctx) => (root: bigint) => c.pub.readContract({ address: c.pool, abi: PRIVACY_POOL_ABI, functionName: "isKnownASPRoot", args: [root] });
// the newest head (viem caches it for a moment; a block mined on a transaction must be seen at once)
const eventsOf = async (c: Ctx, toBlock?: bigint): Promise<PoolEvent[]> =>
  fetchPoolEvents(c.pub, c.pool, c.scanFrom, toBlock ?? (await c.pub.getBlockNumber({ cacheTime: 0 })));
const deviceState = async (c: Ctx): Promise<PublicPoolState> => ({ events: await eventsOf(c), currentRoot: await currentRoot(c) });
const poolBalance = (c: Ctx) => c.pub.getBalance({ address: c.pool });
const nonceOf = (c: Ctx, address: Address) => c.pub.getTransactionCount({ address, blockTag: "pending" });
/** the pool's root events, oldest first */
const rootEvents = (events: readonly PoolEvent[]) => events.filter((e): e is ASPRootUpdatedEvent => e.kind === "asproot");
/** a deposit's state-tree leaf, from these events */
const leafOf = (events: readonly PoolEvent[], label: bigint) => {
  const d = depositOf(events, label);
  assert(d, "a deposit of these events");
  return d.deposit.leafIndex;
};

async function syncNotes(c: Ctx, k: MasterKeys) {
  const events = await eventsOf(c);
  return { events, tree: buildStateTree(events), ...discoverNotes(k, c.scope, events) };
}
type Synced = Awaited<ReturnType<typeof syncNotes>>;

/** a deposit's first note (the deposit itself), found by its deposit index */
function noteAt(st: Synced, depositIndex: number): Note {
  const n = st.notes.find((x) => x.depositIndex === depositIndex && x.hop === 0);
  assert(n, `the note of deposit index ${depositIndex}`);
  return n;
}

/** The association-set proof, built the way the browser builds it: from public events on the device. */
async function deviceASPProof(c: Ctx, label: bigint, over: Partial<AssociationProofInput> = {}): Promise<AssociationProof> {
  const events = await eventsOf(c);
  return buildAssociationProof({ label, events, currentRoot: await currentRoot(c), isKnownRoot: isKnownRootOf(c), ...over });
}

async function waitForBlock(c: Ctx, n: bigint) {
  while ((await c.pub.getBlockNumber()) < n) await sleep(200);
}

async function deposit(c: Ctx, k: MasterKeys, from: Hex, depositIndex: number, value: bigint) {
  const w = wallet(c, from);
  const hash = await w.writeContract({
    address: c.pool,
    abi: PRIVACY_POOL_ABI,
    functionName: "deposit",
    args: [computePrecommitment(deriveNoteSecrets(k, c.scope, depositIndex, 0))],
    value,
    chain: c.chain, // the operation's own chain, never the wallet's
    account: w.account,
  });
  const rc = await c.pub.waitForTransactionReceipt({ hash });
  assert(rc.status === "success", `deposit on ${c.name}`);
  return rc;
}

interface BatchDeposit {
  /** the wallet that sends it (the deposit's depositor: only it can ragequit) */
  from: Hex;
  /** the vault whose note it is */
  keys: MasterKeys;
  depositIndex: number;
  value: bigint;
}

/** Several deposits in ONE block with exactly this block time (blocks held while they are sent). Needs "auto" mining. */
async function depositBlock(c: Ctx, items: readonly BatchDeposit[], time: number): Promise<TransactionReceipt[]> {
  const hashes: Hex[] = [];
  const nonces = new Map<Hex, number>();
  await setMining(c, "held");
  try {
    for (const it of items) {
      const w = wallet(c, it.from);
      const nonce = nonces.get(it.from) ?? (await nonceOf(c, w.account.address));
      nonces.set(it.from, nonce + 1);
      hashes.push(
        await w.writeContract({
          address: c.pool,
          abi: PRIVACY_POOL_ABI,
          functionName: "deposit",
          args: [computePrecommitment(deriveNoteSecrets(it.keys, c.scope, it.depositIndex, 0))],
          value: it.value,
          chain: c.chain,
          account: w.account,
          nonce,
          gas: DEPOSIT_GAS,
        }),
      );
    }
    await mineAt(c, time);
  } finally {
    await setMining(c, "auto");
  }
  const rcs = await Promise.all(hashes.map((hash) => c.pub.waitForTransactionReceipt({ hash })));
  assert(rcs.every((rc) => rc.status === "success" && rc.blockNumber === rcs[0].blockNumber), `${items.length} deposits in one block on ${c.name}`);
  return rcs;
}

/** A root posted with the postman key outside this server's publisher (another publisher, or the operator by hand). */
async function postRoot(c: Ctx, root: bigint, cid: string): Promise<TransactionReceipt> {
  const w = wallet(c, KEYS.deployer);
  const hash = await w.writeContract({ address: c.pool, abi: PRIVACY_POOL_ABI, functionName: "updateASPRoot", args: [root, cid], chain: c.chain, account: w.account });
  const rc = await c.pub.waitForTransactionReceipt({ hash });
  assert(rc.status === "success", `a root posted by hand on ${c.name}`);
  return rc;
}

/**
 * The Phase 3 device rule, as an older tab still open would apply it: the largest root among the current one and the
 * last 16 posted that is the root of a prefix of the deposits, holds the label and is known to the contract.
 */
async function phase3Proof(c: Ctx, label: bigint): Promise<MerkleProof & { size: number }> {
  const events = await eventsOf(c);
  const own = buildAssociationSet(associationSetLabels(events));
  const index = own.labels.indexOf(label);
  assert(index !== -1, "the older rule finds the deposit in its own events");
  const sizes = prefixSizes(own);
  let best: { root: bigint; size: number } | null = null;
  for (const root of new Set([await currentRoot(c), ...publishedASPRoots(events).slice(0, ASP_ROOT_HISTORY_SIZE)])) {
    const size = sizes.get(root);
    if (size === undefined || size <= index || !(await isKnownRootOf(c)(root))) continue;
    if (!best || size > best.size) best = { root, size };
  }
  assert(best, "the older rule finds a known prefix root that holds the deposit");
  const proof = own.tree.proof(index, best.size);
  assert(proof.root === best.root && MerkleTree.verify(proof), "the older rule's proof verifies");
  return { ...proof, size: best.size };
}

function byChain(results: readonly PublishResult[], chainId: number): PublishResult {
  const r = results.find((x) => x.chainId === chainId);
  assert(r, `a publish result for chain ${chainId}`);
  return r;
}

/** every line printed during the run (this script's and the server modules'): checked for notes and keys at the end */
const printed: string[] = [];
for (const m of ["log", "info", "warn", "error"] as const) {
  const original = console[m].bind(console);
  console[m] = (...args: unknown[]) => {
    printed.push(args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ""}` : typeof a === "string" ? a : jsonOf(a))).join(" "));
    original(...args);
  };
}

async function main() {
  const started = Date.now();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hylsia-e2e-"));
  try {
    // ── setup ──────────────────────────────────────────────────────────────────
    const portA = envPort("E2E_ANVIL_PORT_A", 8547);
    const portB = envPort("E2E_ANVIL_PORT_B", 8548);
    assert(portA !== portB, "E2E_ANVIL_PORT_A and E2E_ANVIL_PORT_B differ");

    step(`starting two anvils: ${networkById(CHAIN_A)!.name}'s id on :${portA}, ${networkById(CHAIN_B)!.name}'s id on :${portB}`);
    // Different genesis times, both in the past (deadlines are wall-clock), so the two chains' block times differ.
    const rpcA = await startAnvil(portA, CHAIN_A, 1_700_000_000);
    const rpcB = await startAnvil(portB, CHAIN_B, 1_750_000_000);
    const A = makeCtx(CHAIN_A, rpcA);
    const B = makeCtx(CHAIN_B, rpcB);
    const CTXS = [A, B];
    await Promise.all(CTXS.map((c) => waitForChain(c.pub, c.chainId)));
    ok(`eth_chainId ${CHAIN_A} on :${portA}, ${CHAIN_B} on :${portB}`);

    step("deploying the verifiers and the pool on both chains (Deploy.s.sol, anvil key 0)");
    const publicBefore = publicOutputs();
    const broadcastDir = path.join(tmp, "broadcast");
    const recordA = deploy(CHAIN_A, rpcA, broadcastDir);
    const recordB = deploy(CHAIN_B, rpcB, broadcastDir);
    assert(publicOutputs() === publicBefore, `contracts/deployments/${CHAIN_A}.json and ${CHAIN_B}.json (and their broadcast logs) are untouched`);
    for (const id of [CHAIN_A, CHAIN_B]) {
      assert(fs.existsSync(path.join(broadcastDir, "Deploy.s.sol", String(id), "run-latest.json")), `chain ${id}: the broadcast log went to the temp dir`);
    }
    for (const [c, r] of [[A, recordA], [B, recordB]] as const) {
      assert(r.chainId === c.chainId && r.protocol === "hylsia-pp-v1" && r.deployer === POSTMAN, `${c.name}: the record names its chain, protocol and deployer`);
      c.pool = r.pool;
      c.scope = await c.pub.readContract({ address: c.pool, abi: PRIVACY_POOL_ABI, functionName: "SCOPE" });
      assert(c.scope === computeScope(c.pool, c.chainId) && c.scope.toString() === r.scope, `${c.name}: on-chain SCOPE == computeScope(pool, chainId) == the record`);
      c.scanFrom = BigInt(r.deployBlock) > 5n ? BigInt(r.deployBlock) - 5n : 0n;
      for (const [contract, address] of [["WithdrawVerifier", r.withdrawVerifier], ["CommitmentVerifier", r.commitmentVerifier]] as const) {
        const code = await c.pub.getCode({ address });
        assert(code && keccak256(code) === keccak256(compiledCode(contract)), `${c.name}: ${contract} code == the compiled code`);
      }
    }
    assert(A.pool === B.pool, "the same pool address on both chains (same deployer, same nonce)");
    assert(A.scope !== B.scope, "different SCOPE on each chain");
    ok(`pool ${A.pool} on both chains; SCOPE ${A.scope.toString().slice(0, 10)}… vs ${B.scope.toString().slice(0, 10)}…; public records untouched`);

    // Configure the server modules exactly like a two-network deployment, then import them. The operator's exclusion
    // list is a file in the temp dir, empty at first; the inclusion delay is 0 on both chains until the screening
    // section (Robinhood Chain Testnet's default, 3600 s, would hold every deposit of the scenario below for an hour).
    const exclusionsFile = path.join(tmp, "asp-exclusions.json");
    fs.writeFileSync(exclusionsFile, JSON.stringify({ format: "hylsia-asp-exclusions", version: 1, comment: "e2e: empty at setup", entries: [] }, null, 2));
    for (const k of Object.keys(process.env)) if (k.startsWith("PRIVACY_") || k.startsWith("VITE_PRIVACY_")) delete process.env[k];
    Object.assign(process.env, {
      PRIVACY_ASP_EXCLUSIONS_FILE: exclusionsFile,
      [`PRIVACY_ASP_INCLUSION_DELAY_SECONDS_${CHAIN_A}`]: "0",
      [`PRIVACY_ASP_INCLUSION_DELAY_SECONDS_${CHAIN_B}`]: "0",
      PRIVACY_CHAIN_IDS: `${CHAIN_A},${CHAIN_B}`,
      [`PRIVACY_RPC_URL_${CHAIN_A}`]: rpcA,
      [`PRIVACY_POOL_ADDRESS_${CHAIN_A}`]: A.pool,
      [`PRIVACY_POOL_DEPLOY_BLOCK_${CHAIN_A}`]: String(A.scanFrom),
      [`PRIVACY_RPC_URL_${CHAIN_B}`]: rpcB,
      [`PRIVACY_POOL_ADDRESS_${CHAIN_B}`]: B.pool,
      [`PRIVACY_POOL_DEPLOY_BLOCK_${CHAIN_B}`]: String(B.scanFrom),
      PRIVACY_RELAYER_PRIVATE_KEY: KEYS.relayer,
      PRIVACY_ASP_POSTMAN_PRIVATE_KEY: KEYS.deployer,
      PRIVACY_QUOTE_TTL_SECONDS: "900",
      [`PRIVACY_RELAYER_FEE_BPS_${CHAIN_A}`]: String(FEE_BPS_A),
      [`PRIVACY_RELAYER_MIN_FEE_WEI_${CHAIN_A}`]: "0",
      [`PRIVACY_ASP_CONFIRMATIONS_${CHAIN_A}`]: "1",
      [`PRIVACY_RELAYER_FEE_BPS_${CHAIN_B}`]: String(FEE_BPS_B),
      [`PRIVACY_RELAYER_MIN_FEE_WEI_${CHAIN_B}`]: MIN_FEE_B.toString(),
      [`PRIVACY_ASP_CONFIRMATIONS_${CHAIN_B}`]: "2",
    });
    const config = await import("../../server/privacy/config");
    const asp = await import("../../server/privacy/asp");
    const relayer = await import("../../server/privacy/relayer");
    const pools = await import("../../server/privacy/pools");
    const funding = await import("../../server/privacy/funding");
    const autoPublish = await import("../../server/privacy/autoPublish");
    const exclusions = await import("../../server/privacy/exclusions");
    const evict = await import("../../server/privacy/evict");
    const cfg = config.privacyConfig();
    assert(cfg.mode === "multi" && cfg.chains.map((c) => c.chainId).join() === `${CHAIN_A},${CHAIN_B}`, "the server serves both chains in multi mode");
    for (const c of cfg.chains) {
      assertLocalRpc(c.rpcUrl);
      assert(c.pool === A.pool && c.problems.length === 0, `${c.network.name}: pool configured without problems (${c.problems.join(", ")})`);
      assert(c.aspInclusionDelaySeconds === 0, `${c.network.name}: inclusion delay 0 for this run (${c.aspInclusionDelaySeconds})`);
    }
    assert(cfg.aspExclusions.kind === "file" && cfg.aspExclusions.path === exclusionsFile, "the exclusion list is the temp file");
    for (const w of [...cfg.warnings, ...cfg.chains.flatMap((c) => c.warnings)]) console.log(`  (config warning) ${w}`);
    const boot: string[] = [];
    config.logPrivacyConfigSummary((line) => boot.push(line));
    assert(boot.filter((l) => l.includes("inclusion delay 0 s (right away)")).length === 2, "the boot summary names each network's inclusion delay");
    assert(boot.some((l) => l.includes("exclusion list (") && l.includes(": 0 entries")), "the boot summary names the exclusion list's state");
    ok("server modules: multi mode, both pools on 127.0.0.1, one relayer key, one postman key; inclusion delay 0; an empty exclusion list");

    /**
     * The operator edits the exclusion list. The server re-reads a list at most once a second; this read makes it see
     * the edit now. A list counts from its file's modification time, and a root that admits an excluded deposit again
     * waits until the list is 30 s old (server/privacy/asp.ts, the settle rule): `settled` dates the file 2 minutes back,
     * as if it had been saved earlier.
     */
    type ListEntry = { label?: string; depositor?: string; reason: string; chainId?: number; note?: string; added?: string };
    function writeExclusions(list: readonly ListEntry[] | string, o: { settled?: boolean; comment?: string } = {}) {
      const text = typeof list === "string" ? list : JSON.stringify({ format: "hylsia-asp-exclusions", version: 1, comment: o.comment ?? "e2e", entries: list }, null, 2);
      fs.writeFileSync(exclusionsFile, text);
      if (o.settled !== false) {
        const t = Date.now() / 1000 - 120;
        fs.utimesSync(exclusionsFile, t, t);
      }
      const state = exclusions.readExclusions(config.privacyConfig().aspExclusions, { force: true });
      assert(state.status === (typeof list === "string" ? "invalid" : "ok"), `the exclusion list reads as ${state.status}`);
    }

    /** privacy.asp.status as a device fetches it (input-less, every pool), computed now rather than from the 15 s memo */
    const statusAnswer = async (): Promise<ASPStatusAnswer> => ({
      pools: await Promise.all(CTXS.map((c) => asp.getASPStatus(c.chainId, { fresh: true }))),
      unavailable: [],
    });
    const statusOf = async (c: Ctx): Promise<ASPStatusEntry & { screening: ASPScreening }> => {
      const entry = await asp.getASPStatus(c.chainId, { fresh: true });
      assert(entry.screening, `${c.name}: the status carries its screening block`);
      return entry as ASPStatusEntry & { screening: ASPScreening };
    };
    /** the pool's screening block as the vault reads it (same chain AND address, fresh), or null */
    const screeningIn = (answer: ASPStatusAnswer, c: Ctx) => activeASPStatus(answer, false, c, Date.now(), Date.now()).screening;

    /**
     * What the vault shows for these notes (Notes, Withdraw, My notes): client/src/privacy/publicData.ts noteScreening,
     * from public answers every visitor gets (privacy.asp.status, privacy.poolActivity for the deposit times, matched by
     * transaction hash) and this device's own events. `edit` changes the status answer first (an answer that differs
     * for one visitor).
     */
    async function noteStates(c: Ctx, labels: readonly bigint[], edit?: (s: ASPScreening) => ASPScreening): Promise<NoteScreening[]> {
      const answer = await statusAnswer();
      if (edit) answer.pools = answer.pools.map((e) => (samePool(e, c) && e.screening ? { ...e, screening: edit(e.screening) } : e));
      const status = activeASPStatus(answer, false, c, Date.now(), Date.now());
      pools.resetPoolCaches(); // the activity list is memoized for 5 s
      const activity = activePoolActivity(await pools.getPoolActivity(), false, c, Date.now(), Date.now());
      const pool = { scope: c.scope, events: await eventsOf(c), aspRoot: await currentRoot(c) };
      return labels.map((label) => {
        const s = noteScreening({ label, chainId: c.chainId, pool, status, activity });
        assert(s, "a note screening for a pool this device has read");
        return s;
      });
    }

    step("alice creates one vault: one seed, one v2 backup for both networks");
    const seed = generateSeed();
    const backup = await encryptSeedV2(seed, PASSWORD);
    const keys = deriveMasterKeys(seed);
    const backupText = JSON.stringify(backup);
    assert(backup.version === 2 && !("chainId" in backup) && !("pool" in backup), "the v2 backup carries no chain or pool");
    assert(!backupText.toLowerCase().includes(A.pool.slice(2).toLowerCase()), "the pool address is nowhere in the backup file");
    ok(`backup v2, fingerprint ${backup.fingerprint.slice(0, 8)}…`);

    const withdrawArtifacts = loadArtifacts("withdraw");
    const commitmentArtifacts = loadArtifacts("commitment");

    async function proveSpend(c: Ctx, st: Synced, note: Note, aspProof: MerkleProof, w: WithdrawalRequest, amount: bigint) {
      const sp = st.tree.proof(note.leafIndex);
      const next = deriveNoteSecrets(keys, c.scope, note.depositIndex, note.hop + 1);
      return proveWithdraw(
        {
          withdrawnValue: amount,
          stateRoot: sp.root,
          ASPRoot: aspProof.root,
          context: computeContext(c.scope, w),
          label: note.label,
          existingValue: note.value,
          existingNullifier: note.nullifier,
          existingSecret: note.secret,
          newNullifier: next.nullifier,
          newSecret: next.secret,
          stateSiblings: sp.siblings,
          stateIndex: sp.index,
          ASPSiblings: aspProof.siblings,
          ASPIndex: aspProof.index,
        },
        withdrawArtifacts,
      );
    }

    /**
     * A private withdrawal proved for the relayer of the note's own chain, at that chain's fee (not sent yet). Anyone
     * can also send it to the pool directly and pay the gas: the contract does not check who sends it.
     */
    async function relayedProof(c: Ctx, st: Synced, note: Note, aspProof: MerkleProof, amount: bigint, recipient: Address) {
      const quote = await relayer.getQuote(c.chainId);
      assert(
        quote.available && quote.relayer && quote.chainId === c.chainId && quote.pool !== null && samePool({ chainId: quote.chainId, pool: quote.pool }, c),
        `${c.name}: a relayer quote for this pool`,
      );
      const fee = relayer.computeFee(amount, c.chainId);
      const w: WithdrawalRequest = { recipient, relayer: quote.relayer, fee, deadline: BigInt(quote.expiresAt) };
      const t0 = Date.now();
      const r = await proveSpend(c, st, note, aspProof, w, amount);
      return { w, r, fee, amount, recipient, proveMs: Date.now() - t0 };
    }
    type RelayedProof = Awaited<ReturnType<typeof relayedProof>>;

    /** Send a relayed proof through the relayer; the recipient gets amount - fee. */
    async function sendRelayed(c: Ctx, p: RelayedProof) {
      const before = await c.pub.getBalance({ address: p.recipient });
      const sent = await relayer.relayWithdrawal({ chainId: c.chainId, withdrawal: p.w, proof: p.r.proof, pubSignals: p.r.publicSignals });
      assert(sent.chainId === c.chainId, "the relayer answers for the proof's own chain");
      const rc = await c.pub.waitForTransactionReceipt({ hash: sent.txHash });
      assert(rc.status === "success", `${c.name}: relayed withdrawal succeeded`);
      assert((await c.pub.getBalance({ address: p.recipient })) - before === p.amount - p.fee, `${c.name}: recipient received amount - fee`);
      return { ...p, txHash: sent.txHash, gasUsed: rc.gasUsed };
    }

    /** A private withdrawal through the relayer of the note's own chain, at that chain's fee. */
    async function relayedWithdrawal(c: Ctx, st: Synced, note: Note, aspProof: MerkleProof, amount: bigint, recipient: Address) {
      return sendRelayed(c, await relayedProof(c, st, note, aspProof, amount, recipient));
    }

    /** The relayer's answer to a proof it refuses: its message (nothing is sent). */
    async function relayRefusal(c: Ctx, p: RelayedProof): Promise<string> {
      const nonce = await nonceOf(c, RELAYER);
      let message = "sent";
      try {
        await relayer.relayWithdrawal({ chainId: c.chainId, withdrawal: p.w, proof: p.r.proof, pubSignals: p.r.publicSignals });
      } catch (err) {
        message = String((err as Error)?.message ?? err);
      }
      assert((await nonceOf(c, RELAYER)) === nonce, `${c.name}: the relayer sent nothing`);
      return message;
    }

    /** The same withdrawal sent straight to the pool (a client paying its own gas): "no revert", or the pool's error. */
    const simulateWithdraw = (c: Ctx, p: RelayedProof) =>
      revertOf(c.pub.simulateContract({ address: c.pool, abi: PRIVACY_POOL_ABI, functionName: "withdraw", args: [p.w, p.r.proof, sig6(p.r.publicSignals)], account: BOB }));

    /** The public exit: a ragequit by the deposit's own depositor (the commitment proof is made here, on the device). */
    async function ragequit(c: Ctx, note: Note, from: Hex) {
      const rq = await proveCommitment({ value: note.value, label: note.label, nullifier: note.nullifier, secret: note.secret }, commitmentArtifacts);
      const w = wallet(c, from);
      const hash = await w.writeContract({ address: c.pool, abi: PRIVACY_POOL_ABI, functionName: "ragequit", args: [rq.proof, sig4(rq.publicSignals)], chain: c.chain, account: w.account });
      const rc = await c.pub.waitForTransactionReceipt({ hash });
      assert(rc.status === "success", `${c.name}: ragequit by its depositor`);
      return rc;
    }

    /** privacy.asp.set as a device asks it (input-less, every pool), reduced to this pool's { root, cid } */
    let recordRequests = 0;
    const recordOf =
      (c: Ctx) =>
      async (...args: unknown[]): Promise<RootRecordAnswer | null> => {
        assert(args.length === 0, "the record request takes no input");
        recordRequests++;
        const e = pickPoolEntry((await asp.getPublicAssociationSets()).sets, c);
        return e && typeof e.root === "bigint" ? { root: e.root, cid: typeof e.cid === "string" ? e.cid : null } : null;
      };

    // A private withdrawal as PrivacyProvider.withdraw makes it: sync every pool and read the input-less
    // privacy.asp.status answer every visitor fetches; decide, from public data only, whether a root is due on any pool
    // (publishDueAcross: the operator's rootDue, else the open policy's rule, and never while some pool's answer has
    // announcements that alone shrink its root sharply: never a note or a label); then resolveAssociationProof
    // (shared/privacy/associationSet.ts): the current root checked
    // on the device and the note found in it, the app's questions about the crowd (answered here by `answer`, default
    // "go on"), and only then ONE input-less request for every pool, awaited, with this pool's answer read (published:
    // its root; pending: wait for its transaction on this pool's own client); the root checked again (SET_CHANGED when it
    // drops a deposit of the crowd); the proof; at most one more question. `seq` records, in order, every request the
    // operator sees (the publish request, the record request) and every question.
    let publishRequests = 0;
    const questionText = (q: WithdrawalQuestion) =>
      `question ${q.kind === "shrink" ? `shrink/${q.alarm.basis} ${q.alarm.from}->${q.alarm.to}` : `small ${q.crowd}`}${q.beforeRequest ? " before any request" : ""}`;
    async function deviceAssociationProof(
      target: Ctx,
      label: bigint,
      o: {
        afterPublish?: () => Promise<void>;
        /** the status answer as one visitor gets it (it can differ per visitor) */
        editScreening?: (s: ASPScreening | null) => ASPScreening | null;
        /** the person's answer to a question ("Withdraw anyway": true) */
        answer?: (q: WithdrawalQuestion) => boolean;
        /** the crowd the withdraw form showed */
        expectedCrowd?: number | null;
        /** what the operator sees, in order (filled even when the attempt stops) */
        seq?: string[];
        /** record the publish request without sending it to the server */
        dryPublish?: boolean;
      } = {},
    ) {
      const states = await Promise.all(CTXS.map(deviceState));
      const answer = await statusAnswer();
      const i = CTXS.indexOf(target);
      const screenings = CTXS.map((c, k) => (k === i && o.editScreening ? o.editScreening(screeningIn(answer, c)) : screeningIn(answer, c)));
      const due = publishDueAcross(CTXS.map((_, k) => ({ events: states[k].events, currentRoot: states[k].currentRoot, screening: screenings[k] })));
      const screening = screenings[i];
      const seq = o.seq ?? [];
      let results: PublishResult[] = [];
      const proof = await resolveAssociationProof({
        label,
        state: states[i],
        reload: () => deviceState(target),
        isKnownRoot: isKnownRootOf(target),
        record: statusRecord(screening),
        fetchRootRecord: async () => (seq.push("privacy.asp.set"), recordOf(target)()),
        announced: announcedExclusions(screening),
        publishDue: due,
        expectedCrowd: o.expectedCrowd ?? null,
        ask: async (q) => (seq.push(questionText(q)), o.answer ? o.answer(q) : true),
        requestPublish: async () => {
          seq.push("privacy.asp.publish");
          if (o.dryPublish) return null;
          publishRequests++;
          results = (await asp.publishBehindRoots()).results;
          await o.afterPublish?.();
          const entry = results.find((r) => r.pool !== null && samePool({ chainId: r.chainId, pool: r.pool }, target)) ?? null;
          if (!entry || entry.root === null) return null;
          if (entry.status === "published") return BigInt(entry.root);
          if (entry.status === "pending" && entry.txHash) {
            const rc = await target.pub.waitForTransactionReceipt({ hash: entry.txHash, timeout: 120_000 });
            return rc.status === "success" ? BigInt(entry.root) : null;
          }
          return null;
        },
      });
      return { proof, results, behind: due, screening, seq };
    }

    // ── chain A: today's full scenario ──────────────────────────────────────────
    step(`${A.name}: alice deposits 1 ETH (deposit index 0)`);
    const dep0 = await deposit(A, keys, KEYS.alice, 0, parseEther("1"));
    let st = await syncNotes(A, keys);
    assert(st.notes.length === 1 && st.notes[0].value === parseEther("1"), "one note discovered");
    assert(st.tree.root === (await A.pub.readContract({ address: A.pool, abi: PRIVACY_POOL_ABI, functionName: "getLastRoot" })), "local tree root == on-chain root");
    ok(`note discovered from A's events; the local Merkle tree matches A's on-chain root (deposit gas ${dep0.gasUsed})`);

    step("Phase 5: a static event snapshot verifies against its exact on-chain checkpoint; forged data is rejected");
    const checkpoint = await A.pub.getBlock({ blockNumber: await A.pub.getBlockNumber({ cacheTime: 0 }) });
    const poolSnapshot: PoolSnapshot = {
      format: SNAPSHOT_FORMAT, version: SNAPSHOT_VERSION, chainId: A.chainId, pool: A.pool,
      deployBlock: A.scanFrom, toBlock: checkpoint.number, toBlockHash: checkpoint.hash,
      stateRoot: st.tree.root, leafCount: st.tree.leaves.length, createdAt: Number(checkpoint.timestamp), events: treeEventsOf(st.events),
    };
    const snapshotText = encodeSnapshot(poolSnapshot);
    const parsedSnapshot = parseSnapshot(snapshotText, { chainId: A.chainId, pool: A.pool, deployBlock: A.scanFrom });
    assert(parsedSnapshot.ok, "the static snapshot parses and recomputes its deposit commitments");
    assert(await verifySnapshotAgainstChain(parsedSnapshot.snapshot, A.pub, checkpoint.number), "checkpoint hash, chain, scope, root and leaf count match the pool");
    assert(!await verifySnapshotAgainstChain(parsedSnapshot.snapshot, B.pub, checkpoint.number), "the same pool address on another chain cannot authenticate this snapshot");
    assert(!await verifySnapshotAgainstChain({ ...poolSnapshot, toBlockHash: keccak256(toHex("wrong checkpoint")) }, A.pub, checkpoint.number), "a changed checkpoint hash fails");
    const forged = { ...poolSnapshot, events: poolSnapshot.events.map((e) => e.kind === "deposit" ? { ...e, value: e.value + 1n } : e) };
    assert(!parseSnapshot(encodeSnapshot(forged), { chainId: A.chainId, pool: A.pool, deployBlock: A.scanFrom }).ok, "a changed deposit value fails commitment validation");
    const omitted: PoolSnapshot = { ...poolSnapshot, events: [], leafCount: 0, stateRoot: buildStateTree([]).root };
    assert(parseSnapshot(encodeSnapshot(omitted), { chainId: A.chainId, pool: A.pool, deployBlock: A.scanFrom }).ok, "an omitted history is internally consistent");
    assert(!await verifySnapshotAgainstChain(omitted, A.pub, checkpoint.number), "but the on-chain checkpoint rejects it, including an empty-tree claim");
    ok("valid checkpoint accepted; changed value, wrong chain, changed block hash and omitted history refused");

    step(`${A.name}: the publisher posts the association-set root (server module, chain ${CHAIN_A})`);
    const pub = await asp.publishASPRoot(CHAIN_A);
    assert(pub.chainId === CHAIN_A && pub.status === "published" && pub.txHash, `root published on A (${pub.status})`);
    const status = await asp.getASPStatus(CHAIN_A);
    assert(status.chainId === CHAIN_A && status.onChainIsCurrent && status.memberCount === 1 && status.confirmations === 1, "A's set status is current");
    assert((await currentRoot(B)) === 0n, "nothing was posted on B");
    const firstPost = await A.pub.getTransactionReceipt({ hash: pub.txHash });
    ok(`A's root ${status.onChainRoot.slice(0, 12)}… tx ${pub.txHash} (the pool's first root: gas ${firstPost.gasUsed}); B untouched`);

    step(`${A.name}: withdraw 0.4 ETH to a fresh address through the relayer (proof made locally)`);
    const note0 = st.notes[0];
    const aspProof = await deviceASPProof(A, note0.label);
    assert(MerkleTree.verify(aspProof), "association-set proof built on the device verifies");
    assert(aspProof.root.toString() === status.onChainRoot && aspProof.source === "device", "device-built root == the root the server published");
    assert(aspProof.recipe.version === 1 && aspProof.recipe.considered === 1 && aspProof.recipe.excludedLeaves.length === 0 && aspProof.shrink === null, "the root's record is the screening recipe (n=1, none excluded)");
    // Every external call comes before anything about the label, in one fixed order: isKnownASPRoot(the current root),
    // then, only when this device's events lack that root's event, the input-less privacy.asp.set record. So a note
    // whose deposit this device's events do not hold is refused (NOT_MEMBER) after exactly the calls a held note makes,
    // and a device that holds no event at all cannot check the root (UNVERIFIED_ROOT): it asked the record once, with
    // no input, and nothing about the label.
    const recorder = (log: string[]): Partial<AssociationProofInput> => ({
      isKnownRoot: async (root) => (log.push(`isKnownASPRoot(${root})`), isKnownRootOf(A)(root)),
      fetchRootRecord: async () => (log.push("privacy.asp.set()"), recordOf(A)()),
    });
    const heldCalls: string[] = [];
    const strangerCalls: string[] = [];
    const blindCalls: string[] = [];
    await deviceASPProof(A, note0.label, recorder(heldCalls));
    const stranger = await proofError(deviceASPProof(A, 0xabcdefn, recorder(strangerCalls))); // no deposit of this pool has this label
    const blind = await proofError(deviceASPProof(A, note0.label, { events: [], ...recorder(blindCalls) }));
    assert(heldCalls.join() === `isKnownASPRoot(${aspProof.root})` && strangerCalls.join() === heldCalls.join(), `the same calls for a held note and a stranger (${strangerCalls.join()})`);
    assert(stranger === "NOT_MEMBER" && blind === "UNVERIFIED_ROOT/missing_deposits" && blindCalls.join() === `${heldCalls.join()},privacy.asp.set()`, `refused: ${stranger}, ${blind} (${blindCalls.join()})`);
    ok("one order of calls whatever the note: isKnownASPRoot(current root), then the label; a device without the events refuses after one input-less record request");
    const w1 = await relayedWithdrawal(A, st, note0, aspProof, parseEther("0.4"), RECIPIENT.a1);
    assert(w1.r.publicSignals[WITHDRAW_PUBLIC_SIGNALS.existingNullifierHash] === note0.nullifierHash, "public nullifier hash");
    assert(w1.fee === (parseEther("0.4") * BigInt(FEE_BPS_A)) / 10_000n, "A's fee is A's 100 bps");
    ok(`proof in ${(w1.proveMs / 1000).toFixed(1)}s; relayed tx ${w1.txHash} (gas ${w1.gasUsed}); recipient got ${eth(parseEther("0.4") - w1.fee)}, fee ${eth(w1.fee)}`);

    step(`${A.name}: replaying the proof / tampering the recipient is rejected`);
    for (const [what, w, expected] of [
      ["replay", w1.w, "NullifierAlreadySpent"],
      ["tampered recipient", { ...w1.w, recipient: RECIPIENT.a2 }, "ContextMismatch"],
    ] as const) {
      const name = await revertOf(
        A.pub.simulateContract({ address: A.pool, abi: PRIVACY_POOL_ABI, functionName: "withdraw", args: [w, w1.r.proof, sig6(w1.r.publicSignals)], account: RELAYER }),
      );
      assert(name === expected, `${what} → ${name}`);
      ok(`${what} rejected with ${name}`);
    }

    step(`${A.name}: the change note is discovered; recovery from the v2 backup alone on a "new device"`);
    st = await syncNotes(A, keys);
    assert(st.notes.length === 2 && st.notes[0].spent && st.notes[1].value === parseEther("0.6") && !st.notes[1].spent, "change note 0.6 ETH");
    const afterSnapshot = await fetchPoolEvents(A.pub, A.pool, poolSnapshot.toBlock + 1n, await A.pub.getBlockNumber({ cacheTime: 0 }));
    const bootstrappedEvents = [...parsedSnapshot.snapshot.events, ...afterSnapshot];
    assert(buildStateTree(bootstrappedEvents).root === st.tree.root, "snapshot plus RPC tail yields the full scan's current root");
    assert(privateBalance(discoverNotes(keys, A.scope, bootstrappedEvents).notes) === parseEther("0.6"), "snapshot plus RPC tail recovers the same change note");
    const restoredKeys = deriveMasterKeys(await decryptSeed(backup, PASSWORD)); // v2: no chain or pool context
    const restored = discoverNotes(restoredKeys, A.scope, await eventsOf(A));
    assert(privateBalance(restored.notes) === parseEther("0.6") && spendableNotes(restored.notes).length === 1, "restored balance 0.6 ETH");
    assert(restored.nextDepositIndex === 1, "next deposit index after restore");
    ok("backup decrypts, notes rebuilt from A's chain, balance 0.6 ETH");

    step(`${A.name}: spend the change note in full, self-relayed by bob's wallet (fee 0)`);
    const change = st.notes[1];
    const w2: WithdrawalRequest = { recipient: RECIPIENT.a2, relayer: zeroAddress, fee: 0n, deadline: 0n };
    const r2 = await proveSpend(A, st, change, await deviceASPProof(A, change.label), w2, change.value); // a change note keeps its deposit's label
    const bobA = wallet(A, KEYS.bob);
    let hash = await bobA.writeContract({ address: A.pool, abi: PRIVACY_POOL_ABI, functionName: "withdraw", args: [w2, r2.proof, sig6(r2.publicSignals)], chain: A.chain, account: bobA.account });
    await A.pub.waitForTransactionReceipt({ hash });
    assert((await A.pub.getBalance({ address: RECIPIENT.a2 })) === parseEther("0.6"), "recipient got 0.6 ETH");
    st = await syncNotes(A, keys);
    assert(privateBalance(st.notes) === 0n && st.notes.length === 3 && st.notes[2].value === 0n, "zero-value tail note, balance 0");
    ok("full withdrawal of the change note; A's private balance is 0");

    step(`${A.name}: deposit 0.5 ETH (index 1); one label-free publish request for every pool; ragequit`);
    const dep1 = await deposit(A, keys, KEYS.alice, 1, parseEther("0.5"));
    st = await syncNotes(A, keys);
    const note1 = st.notes.find((n) => n.depositIndex === 1)!;
    assert(note1 && !note1.spent, "deposit 1 discovered");
    // Fail closed: the current root does not include this deposit yet (it holds deposit 0 only), so the device refuses
    // to build a proof for it; only the current root is ever proved against.
    const refused = await proofError(deviceASPProof(A, note1.label));
    assert(refused === "WAITING", `the device refuses to prove a deposit the current root does not include (${refused})`);
    ok("the device refuses a private withdrawal while the current root does not include the deposit (WAITING)");

    // The browser path: the operator's status answer (input-less, the same for every visitor) says a root is due on A,
    // so the device sends ONE input-less request for every pool, the same any withdrawal on either network would send
    // now. Here an OLD deposit (deposit 0) is being proved: it asks exactly as a new one would. B has no deposit, so B
    // answers "empty".
    assert(asp.publishBehindRoots.length === 0, "the publish request takes no input");
    let before = publishRequests;
    const via = await deviceAssociationProof(A, note0.label);
    assert(publishRequests === before + 1, "one publish request");
    // the root on-chain holds deposit 0 alone, so the small-set question comes first: the request for a newer root
    // would come from that one deposit (round 2: every question before any request the operator sees)
    assert(via.seq.join(" | ") === "question small 1 before any request | privacy.asp.publish", `the order: ${via.seq.join(" | ")}`);
    assert(byChain(via.results, CHAIN_A).status === "published" && byChain(via.results, CHAIN_B).status === "empty", "A published, B empty");
    assert(via.proof.size === 2 && via.proof.root === (await currentRoot(A)), `proof against the full set (size ${via.proof.size})`);
    before = publishRequests;
    await deviceAssociationProof(A, note0.label);
    assert(publishRequests === before, "no publish request once every pool's root covers its deposits");
    ok(`root due → one request for every pool → proof against all ${via.proof.size} deposits on A; none once current`);

    // A device whose log RPC is behind lacks the current root's ASPRootUpdated event: it asks the input-less
    // privacy.asp.set once for the current root's record ({ root, cid }) and uses it only because its own events
    // rebuild that cid to the root on-chain. A crafted record is refused, and so is a record of another root: the device
    // never falls back to an older root. Events with a hole (a deposit missing) cannot check the root; one re-sync heals it.
    const viaEvent = rootEvents(await eventsOf(A)).at(-1)!;
    assert(viaEvent.root === via.proof.root && viaEvent.blockNumber > dep1.blockNumber, "the root event comes after deposit 1");
    const lagEvents = await eventsOf(A, viaEvent.blockNumber - 1n);
    assert(lagEvents.some((e) => e.kind === "deposit" && e.label === note1.label) && !rootEvents(lagEvents).some((e) => e.root === via.proof.root), "the lagging events hold deposit 1 but not its root's event");
    before = recordRequests;
    const lagging = await deviceASPProof(A, note0.label, { events: lagEvents, fetchRootRecord: recordOf(A) });
    assert(lagging.root === via.proof.root && lagging.source === "full-set" && lagging.size === 2 && recordRequests === before + 1, "a lagging device rebuilds the same root from the record, asked once");
    const viaRecipe = parseRecipe(viaEvent.cid) as RecipeV1;
    assert(viaRecipe && viaRecipe.version === 1 && viaRecipe.considered === 2, `the root's recipe (${viaEvent.cid})`);
    const craftedRecord = await proofError(
      deviceASPProof(A, note0.label, { events: lagEvents, fetchRootRecord: async () => ({ root: via.proof.root, cid: formatRecipe({ ...viaRecipe, considered: 1 }) }) }),
    );
    const firstRoot = rootEvents(lagEvents)[0];
    const otherRecord = await proofError(deviceASPProof(A, note0.label, { events: lagEvents, fetchRootRecord: async () => ({ root: firstRoot.root, cid: firstRoot.cid }) }));
    assert(craftedRecord === "UNVERIFIED_ROOT/root" && otherRecord === "UNVERIFIED_ROOT/no_record", `crafted record ${craftedRecord}; another root's record ${otherRecord}`);
    const holeEvents = (await eventsOf(A)).filter((e) => !(e.kind === "deposit" && e.label === note1.label));
    const hole = await proofError(deviceASPProof(A, note0.label, { events: holeEvents }));
    let reloads = 0;
    const healed = await resolveAssociationProof({
      label: note0.label,
      state: { events: holeEvents, currentRoot: via.proof.root },
      reload: async () => (reloads++, deviceState(A)),
      isKnownRoot: isKnownRootOf(A),
      publishDue: false,
    });
    assert(hole === "UNVERIFIED_ROOT/missing_deposits" && healed.root === via.proof.root && healed.size === 2 && reloads === 1, `a hole: ${hole}; healed after ${reloads} re-sync`);
    ok("lagging device: the record rebuilds the same root; a crafted record and another root's record are refused; a hole heals with one re-sync");

    const rq = await proveCommitment({ value: note1.value, label: note1.label, nullifier: note1.nullifier, secret: note1.secret }, commitmentArtifacts);
    const bobRagequit = await revertOf(
      A.pub.simulateContract({ address: A.pool, abi: PRIVACY_POOL_ABI, functionName: "ragequit", args: [rq.proof, sig4(rq.publicSignals)], account: bobA.account }),
    );
    assert(bobRagequit === "NotDepositor", `non-depositor ragequit rejected (${bobRagequit})`);
    const aliceA = wallet(A, KEYS.alice);
    const aliceBefore = await A.pub.getBalance({ address: ALICE });
    hash = await aliceA.writeContract({ address: A.pool, abi: PRIVACY_POOL_ABI, functionName: "ragequit", args: [rq.proof, sig4(rq.publicSignals)], chain: A.chain, account: aliceA.account });
    const rcq = await A.pub.waitForTransactionReceipt({ hash });
    const aliceAfter = await A.pub.getBalance({ address: ALICE });
    assert(aliceAfter + rcq.gasUsed * rcq.effectiveGasPrice - aliceBefore === parseEther("0.5"), "alice got 0.5 ETH back");
    st = await syncNotes(A, keys);
    assert(st.notes.find((n) => n.depositIndex === 1)!.spentBy?.kind === "ragequit", "ragequit reflected in discovery");
    assert((await poolBalance(A)) === 0n, "A's pool balance is 0");
    ok(`ragequit returned the deposit to its depositor (gas ${rcq.gasUsed}); a non-depositor is rejected; A's pool holds 0`);

    // ── chain B ─────────────────────────────────────────────────────────────────
    step(`${B.name}: alice deposits 1 ETH (deposit index 0 on B, independent of A)`);
    const depB0 = await deposit(B, keys, KEYS.alice, 0, parseEther("1"));
    // no root on B yet: the device refuses before anything else (NO_PUBLISHED_ROOT), and asks nothing about the deposit
    const noRootB = await proofError(deviceASPProof(B, discoverNotes(keys, B.scope, await eventsOf(B)).notes[0].label));
    assert(noRootB === "NO_PUBLISHED_ROOT", `B has no root yet (${noRootB})`);
    await waitForBlock(B, depB0.blockNumber + 1n); // B admits a deposit after 2 confirmations
    const rootABefore = await currentRoot(A);
    const both = await asp.publishBehindRoots();
    assert(both.results.map((r) => r.chainId).join() === `${CHAIN_A},${CHAIN_B}`, "one result per pool, in registry order");
    assert(byChain(both.results, CHAIN_A).status === "current" && byChain(both.results, CHAIN_B).status === "published", "B published, A reported current");
    assert((await currentRoot(A)) === rootABefore, "a publish on B leaves A's currentASPRoot unchanged");
    const statusB = await asp.getASPStatus(CHAIN_B);
    assert(statusB.chainId === CHAIN_B && statusB.memberCount === 1 && statusB.confirmations === 2 && statusB.onChainIsCurrent, "B's set counts only B's deposit");
    ok("one publish for every pool: B published, A current and unchanged; B's set holds B's deposit only");

    step(`${B.name}: withdraw 0.1 ETH through the relayer at B's fee`);
    let stB = await syncNotes(B, keys);
    assert(stB.notes.length === 1 && stB.notes[0].value === parseEther("1"), "one note on B");
    const aspB = await deviceASPProof(B, stB.notes[0].label);
    assert(aspB.root === (await currentRoot(B)) && aspB.size === 1, "B's proof uses B's own root");
    assert(relayer.computeFee(parseEther("0.1"), CHAIN_B) === MIN_FEE_B, "B's minimum fee applies (50 bps of 0.1 ETH is less)");
    const wB = await relayedWithdrawal(B, stB, stB.notes[0], aspB, parseEther("0.1"), RECIPIENT.b1);
    ok(`relayed tx ${wB.txHash} on B (gas ${wB.gasUsed}); fee ${eth(wB.fee)} (B's minimum); B's first deposit used ${depB0.gasUsed} gas`);

    step("restore from the same v2 backup: A's notes on A, B's on B, none across");
    const k2 = deriveMasterKeys(await decryptSeed(backup, PASSWORD));
    const [evA, evB] = await Promise.all([eventsOf(A), eventsOf(B)]);
    const onA = discoverNotes(k2, A.scope, evA);
    const onB = discoverNotes(k2, B.scope, evB);
    assert(onA.notes.length === 4 && privateBalance(onA.notes) === 0n && onA.nextDepositIndex === 2, "A's four notes, balance 0");
    assert(onB.notes.length === 2 && privateBalance(onB.notes) === parseEther("0.9") && onB.nextDepositIndex === 1, "B's two notes, balance 0.9 ETH");
    assert(discoverNotes(k2, A.scope, evB).notes.length === 0 && discoverNotes(k2, B.scope, evA).notes.length === 0, "no note is discovered across chains");
    ok("one seed: 4 notes on A (0 ETH), 2 on B (0.9 ETH), 0 across");

    // ── cross-chain negatives ───────────────────────────────────────────────────
    step("negative: a chain-A proof relayed to B");
    const relayerNonceB = await B.pub.getTransactionCount({ address: RELAYER, blockTag: "pending" });
    let crossErr: unknown = null;
    try {
      await relayer.relayWithdrawal({ chainId: CHAIN_B, withdrawal: w1.w, proof: w1.r.proof, pubSignals: w1.r.publicSignals });
    } catch (err) {
      crossErr = err;
    }
    const crossCode = (crossErr as { code?: string } | null)?.code;
    const crossMessage = String((crossErr as Error | null)?.message ?? crossErr);
    assert(crossCode === "BAD_REQUEST" && /different pool/.test(crossMessage), `a local BAD_REQUEST (${crossCode}: ${crossMessage})`);
    assert((await B.pub.getTransactionCount({ address: RELAYER, blockTag: "pending" })) === relayerNonceB, "B's relayer sent nothing");
    const onBDirect = await revertOf(
      B.pub.simulateContract({ address: B.pool, abi: PRIVACY_POOL_ABI, functionName: "withdraw", args: [w1.w, w1.r.proof, sig6(w1.r.publicSignals)], account: RELAYER }),
    );
    assert(onBDirect === "ContextMismatch", `simulated directly on B: ${onBDirect}`);
    ok(`relay refused before any transaction ("${crossMessage}"); on B's contract: ContextMismatch`);

    step("negative: a chain-A ragequit proof on B, from the same depositor");
    const rqOnB = await revertOf(
      B.pub.simulateContract({ address: B.pool, abi: PRIVACY_POOL_ABI, functionName: "ragequit", args: [rq.proof, sig4(rq.publicSignals)], account: ALICE }),
    );
    assert(rqOnB === "NotDepositor", `ragequit on B: ${rqOnB}`);
    ok("rejected with NotDepositor: A's label is not a deposit on B");

    step("the server's views keep the two pools apart");
    asp.resetASPCache();
    pools.resetPoolCaches();
    const list = await pools.listPools("24h");
    assert(list.unavailable.length === 0 && list.pools.length === 2, "two pools listed, none unavailable");
    assert(list.networks.map((n) => n.chainId).join() === `${CHAIN_A},${CHAIN_B}`, "both networks, Robinhood Chain Testnet first");
    const sA = list.pools.find((p) => p.chainId === CHAIN_A)!;
    const sB = list.pools.find((p) => p.chainId === CHAIN_B)!;
    assert(sA.pool === sB.pool, "the same pool address in both entries");
    assert(sA.scope !== sB.scope && sA.leafCount !== sB.leafCount && sA.tvl !== sB.tvl, "different scope, leaf count and tvl");
    assert(sA.tvl === 0n && sB.tvl === parseEther("0.9"), "each tvl is its own chain's balance");
    const [dA, dB] = await Promise.all([pools.getPoolDetail(CHAIN_A, A.pool, "7d"), pools.getPoolDetail(CHAIN_B, B.pool, "7d")]);
    assert(dA.pool.chainId === CHAIN_A && dB.pool.chainId === CHAIN_B && dA.pool.scope !== dB.pool.scope, "the two pool pages differ");
    const txA = new Set(dA.activity.map((a) => a.txHash));
    assert(dB.activity.every((a) => !txA.has(a.txHash)) && dA.activity.length !== dB.activity.length, "each page lists its own chain's activity");
    const act = await pools.getPoolActivity();
    assert(act.unavailable.length === 0 && act.pools.length === 2 && act.pools.every((e) => e.pool === A.pool), "two activity lists, same pool address");
    const nows: number[] = [];
    for (const c of CTXS) {
      const e = act.pools.find((x) => x.chainId === c.chainId)!;
      const head = await c.pub.getBlock();
      assert(Math.abs(e.now - Number(head.timestamp)) <= 30, `${c.name}: now is its own chain's head time (${e.now} vs ${head.timestamp})`);
      nows.push(e.now);
      const own = (await eventsOf(c)).filter((ev) => ev.kind === "deposit");
      const listed = e.activity.filter((a) => a.kind === "deposit");
      assert(listed.length === own.length && listed.every((d) => own.some((o) => o.txHash === d.txHash)), `${c.name}: only its own deposits`);
      for (const a of e.activity) {
        const b = await c.pub.getBlock({ blockNumber: a.blockNumber });
        assert(Number(b.timestamp) === a.timestamp, `${c.name}: block times from its own chain`);
      }
      const summary = list.pools.find((p) => p.chainId === c.chainId)!;
      const set = await asp.getASPStatus(c.chainId);
      assert(
        summary.aspMembers === set.memberCount && summary.aspRootMembers === set.memberCount && summary.deposits === own.length,
        `${c.name}: pool size matches its own set (${summary.aspRootMembers}/${summary.aspMembers} vs ${set.memberCount})`,
      );
    }
    assert(Math.abs(nows[0] - nows[1]) > 1_000_000, "the two chains' clocks differ (so do their genesis times)");
    const { quotes } = await relayer.getQuotes();
    const qA = quotes.find((q) => q.chainId === CHAIN_A)!;
    const qB = quotes.find((q) => q.chainId === CHAIN_B)!;
    assert(qA.available && qB.available && qA.relayer === RELAYER && qB.relayer === RELAYER, "one relayer, available on both");
    assert(qA.feeBps === FEE_BPS_A && qA.minFeeWei === "0" && qB.feeBps === FEE_BPS_B && qB.minFeeWei === MIN_FEE_B.toString(), "each chain's own fees");
    ok(`pools: 2 entries (A ${sA.aspRootMembers} / B ${sB.aspRootMembers} in the set); details, activity, now and quotes per chain`);

    step("a withdrawal on A while only B's root is behind: one publish request for every pool");
    await deposit(A, keys, KEYS.alice, 2, parseEther("0.3"));
    assert((await asp.publishASPRoot(CHAIN_A)).status === "published", "A current again");
    const depB1 = await deposit(B, keys, KEYS.alice, 1, parseEther("0.2"));
    await waitForBlock(B, depB1.blockNumber + 1n);
    const rootA = await currentRoot(A);
    const rootB = await currentRoot(B);
    st = await syncNotes(A, keys);
    const note2 = st.notes.find((n) => n.depositIndex === 2 && !n.spent)!;
    before = publishRequests;
    const any = await deviceAssociationProof(A, note2.label);
    assert(any.behind && publishRequests === before + 1, "one publish request");
    assert(byChain(any.results, CHAIN_A).status === "current" && byChain(any.results, CHAIN_B).status === "published", "A current, B published");
    assert((await currentRoot(B)) !== rootB, "B's root advanced");
    assert((await currentRoot(A)) === rootA && any.proof.root === rootA && any.proof.size === 3, "A's proof is made against A's own root, unaffected");
    const w11 = await relayedWithdrawal(A, st, note2, any.proof, note2.value, RECIPIENT.a3);
    assert((await poolBalance(A)) === 0n, "A's pool balance is 0 again");
    ok(`B behind, A current: one request, B's root advanced, A's withdrawal went through (tx ${w11.txHash})`);

    step(`${B.name}: a publish that has not confirmed yet: pending, one transaction; the device waits on B's own client`);
    const depB2 = await deposit(B, keys, KEYS.alice, 2, parseEther("0.25"));
    await waitForBlock(B, depB2.blockNumber + 1n);
    process.env[`PRIVACY_ASP_RECEIPT_WAIT_MS_${CHAIN_B}`] = "1";
    config.resetPrivacyConfig();
    let held = true;
    const release = async () => {
      if (!held) return;
      held = false;
      await anvilRpc(B, "evm_setIntervalMining", [1]);
    };
    await anvilRpc(B, "evm_setIntervalMining", [0]); // hold B's blocks: the post stays in the mempool
    try {
      const postmanNonce = await B.pub.getTransactionCount({ address: POSTMAN, blockTag: "pending" });
      const p1 = await asp.publishASPRoot(CHAIN_B);
      assert(p1.status === "pending" && p1.txHash, `the publish answers pending with its transaction (${p1.status})`);
      const p2 = await asp.publishASPRoot(CHAIN_B);
      assert(p2.status === "pending" && p2.txHash === p1.txHash, "a repeat call returns the same transaction");
      // the periodic publisher meanwhile: it reports the post in flight as waiting (never as a post of its own)
      const tick = await autoPublish.autoPublishTick(CHAIN_B);
      assert(tick.outcome === "waiting" && !tick.txHash, `a periodic tick while the post is in flight waits and sends nothing (${tick.outcome}: ${tick.detail})`);
      assert((await B.pub.getTransactionCount({ address: POSTMAN, blockTag: "pending" })) === postmanNonce + 1, "one transaction sent, not two");
      stB = await syncNotes(B, keys);
      // a member of B's current root withdraws (deposit 1): only a member starts a withdrawal, and deposit 2 joins with
      // the root this post brings
      const noteB1 = stB.notes.find((n) => n.depositIndex === 1 && !n.spent)!;
      const dev = await deviceAssociationProof(B, noteB1.label, { afterPublish: release });
      const entryB = byChain(dev.results, CHAIN_B);
      assert(entryB.status === "pending" && entryB.txHash === p1.txHash, "the device's request finds the same pending transaction");
      assert(dev.proof.root === BigInt(entryB.root!) && dev.proof.root === (await currentRoot(B)), "the device waited on B's client, then proved against the new root");
      assert((await B.pub.getTransactionCount({ address: POSTMAN })) === postmanNonce + 1, "still one transaction");
      stB = await syncNotes(B, keys);
      const w12 = await relayedWithdrawal(B, stB, noteB1, dev.proof, noteB1.value, RECIPIENT.b2);
      ok(`pending ${p1.txHash.slice(0, 12)}… answered twice, sent once; the device waited, proved and withdrew (tx ${w12.txHash})`);
    } finally {
      await release();
      delete process.env[`PRIVACY_ASP_RECEIPT_WAIT_MS_${CHAIN_B}`];
      config.resetPrivacyConfig();
    }

    step(`${B.name}: a relayer and a publisher without testnet ETH say so and send nothing; once funded, the periodic publisher posts the root once`);
    {
      const depB3 = await deposit(B, keys, KEYS.alice, 3, parseEther("0.15"));
      await waitForBlock(B, depB3.blockNumber + 1n); // B admits a deposit after 2 confirmations: B's root is behind now
      const kept = { relayer: await B.pub.getBalance({ address: RELAYER }), postman: await B.pub.getBalance({ address: POSTMAN }) };
      const sentCount = () => Promise.all([RELAYER, POSTMAN].map((address) => B.pub.getTransactionCount({ address, blockTag: "pending" })));
      const sentBefore = await sentCount();
      // both keys run dry on B only (anvil_setBalance, on this local anvil); A keeps its funds
      await anvilRpc(B, "anvil_setBalance", [RELAYER, "0x0"]);
      await anvilRpc(B, "anvil_setBalance", [POSTMAN, "0x0"]);
      funding.forgetFunding(CHAIN_B);
      pools.resetPoolCaches();
      try {
        const gas = await funding.readFunding(CHAIN_B, { fresh: true });
        assert(gas && gas.gasPrice > 0n && gas.relayer?.required === gas.gasPrice * funding.WITHDRAW_GAS * funding.GAS_PRICE_MARGIN, "B's funding read: gas price and one withdrawal's cost");
        const [qA, qB] = await Promise.all([relayer.getQuote(CHAIN_A), relayer.getQuote(CHAIN_B)]);
        assert(!qB.available && qB.reason === "relayer_unfunded" && qB.relayer === RELAYER, `B's quote: relayer_unfunded (${qB.reason})`);
        assert(qA.available && qA.reason === null, "A's relayer is still available");
        let refused: unknown = null;
        try {
          await relayer.relayWithdrawal({ chainId: CHAIN_B, withdrawal: wB.w, proof: wB.r.proof, pubSignals: wB.r.publicSignals });
        } catch (err) {
          refused = err;
        }
        const refusedMessage = String((refused as Error | null)?.message ?? refused);
        assert(
          (refused as { code?: string } | null)?.code === "PRECONDITION_FAILED" && /^The relayer for Local chain B has too little testnet ETH/.test(refusedMessage),
          `a relayed withdrawal on B is refused before anything is sent (${refusedMessage})`,
        );
        const rowB = (await pools.listPools("24h")).pools.find((p) => p.chainId === CHAIN_B)!;
        assert(
          !rowB.relayerAvailable && rowB.relayerBlock === "relayer_unfunded" && !rowB.aspCanPublish && rowB.aspPublishBlock === "publisher_unfunded",
          "privacy.pools: B's relayer and publisher cannot pay",
        );
        const netB = (await pools.getNetworks()).networks.find((n) => n.chainId === CHAIN_B)!;
        assert(netB.configured && netB.available && netB.relayerBlock === "relayer_unfunded" && netB.aspPublishBlock === "publisher_unfunded", "privacy.networks says so too");
        const statusB = await asp.getASPStatus(CHAIN_B, { fresh: true }); // (its answer is otherwise shared for 15 s)
        assert(!statusB.canPublish && statusB.publishBlock === "publisher_unfunded", "privacy.asp.status says so too");
        const unfunded = await asp.publishASPRoot(CHAIN_B);
        assert(unfunded.status === "unfunded" && !unfunded.txHash, `the publish answers unfunded (${unfunded.status})`);
        const paused = await autoPublish.autoPublishTick(CHAIN_B);
        assert(paused.outcome === "unfunded", `the periodic publisher pauses (${paused.outcome}: ${paused.detail})`);
        assert((await sentCount()).join() === sentBefore.join(), "nothing was sent by either key");
      } finally {
        await anvilRpc(B, "anvil_setBalance", [RELAYER, toHex(kept.relayer)]);
        await anvilRpc(B, "anvil_setBalance", [POSTMAN, toHex(kept.postman)]);
        funding.forgetFunding(CHAIN_B);
      }
      // funded again: one tick posts B's root, the next posts nothing
      const rootBefore = await currentRoot(B);
      const t1 = await autoPublish.autoPublishTick(CHAIN_B);
      assert(t1.outcome === "posted" && t1.txHash, `the periodic publisher posts B's root once funded (${t1.outcome}: ${t1.detail})`);
      if (t1.detail === "pending") await B.pub.waitForTransactionReceipt({ hash: t1.txHash });
      const t2 = await autoPublish.autoPublishTick(CHAIN_B);
      assert(t2.outcome === "idle" && t2.detail === "current", `the next tick posts nothing (${t2.outcome}: ${t2.detail})`);
      assert((await currentRoot(B)) !== rootBefore, "B's root advanced");
      assert((await B.pub.getTransactionCount({ address: POSTMAN })) === sentBefore[1] + 1, "one post, not two");
      assert((await relayer.getQuote(CHAIN_B)).available, "B's relayer is available again");
      // deposit 3 leaves by ragequit (the public exit), so both pools end at 0
      stB = await syncNotes(B, keys);
      const noteB3 = stB.notes.find((n) => n.depositIndex === 3 && !n.spent)!;
      assert(noteB3 && noteB3.value === parseEther("0.15"), "deposit 3 on B discovered");
      const rq3 = await proveCommitment({ value: noteB3.value, label: noteB3.label, nullifier: noteB3.nullifier, secret: noteB3.secret }, commitmentArtifacts);
      const aliceB3 = wallet(B, KEYS.alice);
      hash = await aliceB3.writeContract({ address: B.pool, abi: PRIVACY_POOL_ABI, functionName: "ragequit", args: [rq3.proof, sig4(rq3.publicSignals)], chain: B.chain, account: aliceB3.account });
      assert((await B.pub.waitForTransactionReceipt({ hash })).status === "success", "B's deposit 3 ragequit");
      ok(`unfunded: quote, pools, networks, asp.status and publish say so, nothing sent; funded: one periodic post (${t1.detail}, tx ${t1.txHash!.slice(0, 12)}…), then none`);
    }

    step("negative: a wallet on B asked to send A's deposit");
    // A browser wallet (MetaMask through wagmi) is a JSON-RPC account: viem reads eth_chainId right before
    // eth_sendTransaction and asserts it against the operation's chain. (A local key signs offline with whatever chain
    // it is given, and anvil accepts a transaction signed for another chain id, so a local key would prove nothing.)
    const wrong = createWalletClient({ account: ALICE, chain: B.chain, transport: http(B.rpc) }); // anvil's unlocked account
    const noncesBefore = await Promise.all(CTXS.map((c) => c.pub.getTransactionCount({ address: ALICE, blockTag: "pending" })));
    let mismatch: unknown = null;
    try {
      await wrong.writeContract({
        address: A.pool,
        abi: PRIVACY_POOL_ABI,
        functionName: "deposit",
        args: [computePrecommitment(deriveNoteSecrets(keys, A.scope, 3, 0))],
        value: parseEther("0.01"),
        chain: A.chain, // the operation's chain; the wallet's RPC is B
        account: wrong.account,
      });
    } catch (err) {
      mismatch = err;
    }
    assert(mismatch instanceof BaseError && !!mismatch.walk((e) => e instanceof ChainMismatchError), `ChainMismatchError (${String(mismatch)})`);
    const noncesAfter = await Promise.all(CTXS.map((c) => c.pub.getTransactionCount({ address: ALICE, blockTag: "pending" })));
    assert(noncesAfter.join() === noncesBefore.join(), "nothing was sent on either chain");
    ok("ChainMismatchError before signing; nothing sent");

    step(`${B.name}: spend the rest (the change note, self-relayed; deposit 2 by ragequit)`);
    stB = await syncNotes(B, keys);
    const changeB = stB.notes.find((n) => n.depositIndex === 0 && !n.spent)!;
    assert(changeB && changeB.value === parseEther("0.9"), "B's change note 0.9 ETH");
    const wChange: WithdrawalRequest = { recipient: RECIPIENT.b3, relayer: zeroAddress, fee: 0n, deadline: 0n };
    const rChange = await proveSpend(B, stB, changeB, await deviceASPProof(B, changeB.label), wChange, changeB.value);
    const bobB = wallet(B, KEYS.bob);
    hash = await bobB.writeContract({ address: B.pool, abi: PRIVACY_POOL_ABI, functionName: "withdraw", args: [wChange, rChange.proof, sig6(rChange.publicSignals)], chain: B.chain, account: bobB.account });
    assert((await B.pub.waitForTransactionReceipt({ hash })).status === "success", "B's change note withdrawn");
    const noteB2 = stB.notes.find((n) => n.depositIndex === 2 && !n.spent)!;
    const rqB = await proveCommitment({ value: noteB2.value, label: noteB2.label, nullifier: noteB2.nullifier, secret: noteB2.secret }, commitmentArtifacts);
    const aliceB = wallet(B, KEYS.alice);
    hash = await aliceB.writeContract({ address: B.pool, abi: PRIVACY_POOL_ABI, functionName: "ragequit", args: [rqB.proof, sig4(rqB.publicSignals)], chain: B.chain, account: aliceB.account });
    assert((await B.pub.waitForTransactionReceipt({ hash })).status === "success", "B's deposit 2 ragequit");
    stB = await syncNotes(B, keys);
    assert(privateBalance(stB.notes) === 0n, "B's private balance is 0");

    // ── screening policy v1 on chain A ──────────────────────────────────────────
    // From here on chain A runs under Robinhood Chain Testnet's own inclusion delay (3600 s) and the operator's
    // exclusion list. Blocks are mined on transactions and on evm_mine only, so block times are exact (anvil time travel).
    // Deposit indexes 3-7 are alice's vault (deposit 5 sent from bob's wallet, so bob is its depositor); carol's wallet
    // makes the other people's deposits, from a vault of their own.
    await setMining(A, "auto");
    const fillerKeys = deriveMasterKeys(generateSeed());
    const filler = (depositIndex: number): BatchDeposit => ({ from: KEYS.carol, keys: fillerKeys, depositIndex, value: parseEther("0.01") });
    const postOf = async (hash: Hex) => {
      const rc = await A.pub.waitForTransactionReceipt({ hash });
      return { block: rc.blockNumber, time: Number((await A.pub.getBlock({ blockNumber: rc.blockNumber })).timestamp), gas: rc.gasUsed };
    };
    const stateText = (n: NoteScreening): string => {
      const s = n.state;
      switch (s.kind) {
        case "in_set":
          return `in_set(${s.size})`;
        case "waiting":
          return `waiting(${s.why}${s.announced ? ",announced" : ""})`;
        case "excluded":
          return `excluded(${s.reason ?? "no reason"}${s.listed ? ",listed" : ""}${s.removed ? ",removed" : ""})`;
        case "removal_announced":
          return `removal_announced(${s.reason ?? "no reason"})`;
        case "unverified":
          return `unverified(${s.problem})`;
        default:
          return s.kind;
      }
    };
    const statesText = (ns: readonly NoteScreening[]) => ns.map(stateText).join(" ");

    step(`${A.name}: screening policy v1: the inclusion delay becomes ${DELAY_A} s (Robinhood Chain Testnet's default); the current root keeps its members`);
    process.env[`PRIVACY_ASP_INCLUSION_DELAY_SECONDS_${CHAIN_A}`] = String(DELAY_A);
    config.resetPrivacyConfig();
    assert(config.chainConfig(CHAIN_A).aspInclusionDelaySeconds === DELAY_A, "A's inclusion delay is 3600 s");
    const R0 = await currentRoot(A);
    let statA = await statusOf(A);
    assert(
      statA.screening.delaySeconds === DELAY_A &&
        statA.screening.current?.status === "verified" &&
        statA.screening.snapshot.considered === 3 &&
        statA.screening.snapshot.memberCount === 3 &&
        !statA.screening.rootDue &&
        statA.onChainRoot === R0.toString(),
      "raising the delay keeps every member (n never decreases): nothing is due",
    );
    ok(`delay ${DELAY_A} s; the current root keeps its 3 members; nothing is due`);

    // 1. the inclusion delay
    step(`${A.name}: deposits 3 and 4 by alice, and her deposit 5 sent from bob's wallet, all in one block: they wait for screening`);
    const tD = (await headTime(A)) + 10;
    const block1 = await depositBlock(
      A,
      [
        { from: KEYS.alice, keys, depositIndex: 3, value: parseEther("0.1") },
        { from: KEYS.alice, keys, depositIndex: 4, value: parseEther("0.2") },
        { from: KEYS.bob, keys, depositIndex: 5, value: parseEther("0.1") },
      ],
      tD,
    );
    st = await syncNotes(A, keys);
    const D3 = noteAt(st, 3);
    const D4 = noteAt(st, 4);
    const D5 = noteAt(st, 5);
    statA = await statusOf(A);
    assert(statA.screening.snapshot.waiting === 3 && statA.screening.snapshot.memberCount === 3 && !statA.screening.rootDue, "3 waiting; nothing due");
    assert((await asp.publishASPRoot(CHAIN_A)).status === "current", "a publish sends nothing");
    let ns = await noteStates(A, [D3.label, D4.label, D5.label]);
    assert(
      statesText(ns) === "waiting(delay) waiting(delay) waiting(delay)" && ns.every((n) => n.eligibleAt === tD + DELAY_A && withdrawHold(n) === "delay"),
      `the vault: waiting for screening until t+${DELAY_A}, held back (${statesText(ns)})`,
    );
    before = publishRequests;
    const early = await proofError(deviceAssociationProof(A, D3.label));
    assert(early === "WAITING" && publishRequests === before, `a withdrawal now: WAITING, and no publish request (${early})`);
    ok(`3 deposits in block ${block1[0].blockNumber} at t=${tD}: "waiting for screening" until t+${DELAY_A}; the form holds them; the device refuses (WAITING) and asks nothing`);

    step(`${A.name}: at t+${DELAY_A - 1} s they still wait; at t+${DELAY_A} s (equality joins) a root is due and the periodic publisher's tick posts it`);
    await mineAt(A, tD + DELAY_A - 1);
    statA = await statusOf(A);
    ns = await noteStates(A, [D3.label]);
    assert(statA.screening.snapshot.waiting === 3 && !statA.screening.rootDue && statesText(ns) === "waiting(delay)", "still waiting one second before");
    await mineAt(A, tD + DELAY_A);
    statA = await statusOf(A);
    ns = await noteStates(A, [D3.label]);
    assert(statA.screening.rootDue && statA.screening.snapshot.considered === 6 && statA.screening.snapshot.memberCount === 6 && statA.screening.snapshot.waiting === 0, "eligible: a root of 6 is due");
    // held all the same: only a member of the root on-chain starts a private withdrawal (no answer can unhold a note)
    assert(statesText(ns) === "waiting(next_root)" && withdrawHold(ns[0]) === "next_root", `the vault: joins with the next root, held until then (${statesText(ns)})`);
    const tick1 = await autoPublish.autoPublishTick(CHAIN_A);
    assert(tick1.outcome === "posted" && tick1.txHash, `the tick posts (${tick1.outcome}: ${tick1.detail})`);
    const R1 = await currentRoot(A);
    let evS = await eventsOf(A);
    const cid1 = rootEvents(evS).at(-1)!.cid;
    assert(new RegExp(`^hylsia-asp:v1;n=6;x=;asOf=\\d+;t=${tD + DELAY_A};delay=${DELAY_A};conf=1$`).test(cid1), `the root's recipe (${cid1})`);
    assert(R1 === setRoot(depositsInLeafOrder(evS).slice(0, 6).map((d) => d.label)), "the root of the first 6 deposits");
    ns = await noteStates(A, [D3.label, D4.label, D5.label]);
    assert(statesText(ns) === "in_set(6) in_set(6) in_set(6)", `in the set (${statesText(ns)})`);
    ok(`posted ${cid1} (gas ${(await postOf(tick1.txHash!)).gas}); deposits 3-5 are in the set of 6`);

    // 2. a deposit listed before it is screened
    step(`${A.name}: a deposit listed before it is screened never joins: alice's deposit 6 is on the exclusion list (reason test); 8 of carol's in the same block`);
    const tE = (await headTime(A)) + 10;
    await depositBlock(A, [{ from: KEYS.alice, keys, depositIndex: 6, value: parseEther("0.05") }, ...[0, 1, 2, 3, 4, 5, 6, 7].map(filler)], tE);
    st = await syncNotes(A, keys);
    const D6 = noteAt(st, 6);
    const entryD6: ListEntry = { label: D6.label.toString(), reason: "test", chainId: CHAIN_A, note: SENTINEL, added: "2026-11-18" };
    writeExclusions([entryD6]);
    statA = await statusOf(A);
    const ann6 = statA.screening.excluded.find((e) => e.label === D6.label.toString());
    assert(ann6 && ann6.reason === "test" && !ann6.considered && statA.screening.snapshot.waiting === 8 && !statA.screening.rootDue, "announced at once, not considered yet; 8 others wait");
    ns = await noteStates(A, [D6.label]);
    assert(
      statesText(ns) === "waiting(delay,announced)" && withdrawHold(ns[0]) === "announced" && !offersPublicExit(D6, ns[0]),
      `the vault holds it back without public-exit advice: an announcement is not on-chain (${statesText(ns)})`,
    );
    const w6 = await proofError(deviceAssociationProof(A, D6.label));
    assert(w6 === "WAITING/announced", `the device: ${w6}`);
    await mineAt(A, tE + DELAY_A);
    const tick2 = await autoPublish.autoPublishTick(CHAIN_A);
    assert(tick2.outcome === "posted" && tick2.txHash, `the tick posts (${tick2.outcome}: ${tick2.detail})`);
    const R2 = await currentRoot(A);
    evS = await eventsOf(A);
    const cid2 = rootEvents(evS).at(-1)!.cid;
    const leafD6 = leafOf(evS, D6.label);
    const recipe2 = parseRecipe(cid2);
    assert(recipe2?.version === 1 && recipe2.considered === 15 && recipe2.excludedLeaves.join() === String(leafD6), `n=15, x = deposit 6's leaf (${cid2})`);
    assert(R2 === setRoot(depositsInLeafOrder(evS).slice(0, 15).filter((d) => d.label !== D6.label).map((d) => d.label)), "the root leaves deposit 6 out");
    ns = await noteStates(A, [D6.label]);
    assert(
      statesText(ns) === "excluded(test,listed)" && offersPublicExit(D6, ns[0]) && withdrawHold(ns[0]) === "excluded" && ns[0].depositor === ALICE.toLowerCase(),
      `the vault: "Excluded: use the public exit", from alice's address (${statesText(ns)})`,
    );
    const e6 = await proofError(deviceAssociationProof(A, D6.label));
    assert(e6 === "EXCLUDED", `the device: ${e6}`);
    const alice6 = await A.pub.getBalance({ address: ALICE });
    const rq6 = await ragequit(A, D6, KEYS.alice);
    assert((await A.pub.getBalance({ address: ALICE })) + rq6.gasUsed * rq6.effectiveGasPrice - alice6 === D6.value, "the public exit returned deposit 6 to alice");
    st = await syncNotes(A, keys);
    ns = await noteStates(A, [D6.label]);
    assert(!offersPublicExit(noteAt(st, 6), ns[0]), "a spent note gets no public-exit callout");
    ok(`announced, never admitted (root ${cid2}); the device refuses (EXCLUDED); ragequit returned ${eth(D6.value)} (gas ${rq6.gasUsed})`);

    // 3. a removal after inclusion, and the 16-root window
    step(`${A.name}: an in-flight withdrawal: deposit 4's proof against the current root R2 (which holds deposit 5), made before any exclusion of deposit 5`);
    const p1 = await relayedProof(A, st, D4, await deviceASPProof(A, D4.label), D4.value, RECIPIENT.a4);
    assert(p1.r.publicSignals[WITHDRAW_PUBLIC_SIGNALS.ASPRoot] === R2 && (await simulateWithdraw(A, p1)) === "no revert", "proved against R2; the pool would take it");
    ok(`proved in ${(p1.proveMs / 1000).toFixed(1)}s against R2`);

    step(`${A.name}: the operator lists bob's depositing address (reason test): announced at once; the app holds deposit 5 back, with no public-exit advice`);
    const entryBob: ListEntry = { depositor: BOB, reason: "test", chainId: CHAIN_A, note: SENTINEL, added: "2026-11-18" };
    writeExclusions([entryD6, entryBob]);
    statA = await statusOf(A);
    const ann5 = statA.screening.excluded.find((e) => e.label === D5.label.toString());
    assert(ann5 && ann5.considered && ann5.reason === "test" && statA.screening.rootDue, "deposit 5 announced (in the next root's x); a root is due");
    ns = await noteStates(A, [D5.label]);
    assert(
      statesText(ns) === "removal_announced(test)" && withdrawHold(ns[0]) === "removal_announced" && !offersPublicExit(D5, ns[0]),
      `the vault: removal announced, held back, no public exit (${statesText(ns)})`,
    );
    const announcedNow = announcedExclusions(statA.screening);
    const held5 = await proofError(deviceASPProof(A, D5.label, { announced: announcedNow }));
    assert(held5 === "REMOVAL_ANNOUNCED", `the device fails closed while the root still holds it (${held5})`);
    // An answer edited for one visitor (it announces deposit 4, which the list does not name) can only hold this app
    // back: it never marks the deposit excluded nor points at the public exit, which would name its depositor.
    const editedFor4 = (s: ASPScreening): ASPScreening => ({
      ...s,
      excluded: [...s.excluded, { leafIndex: leafOf(evS, D4.label), label: D4.label.toString(), reason: "fraud", considered: true }],
    });
    ns = await noteStates(A, [D4.label], editedFor4);
    const edited4 = await proofError(deviceASPProof(A, D4.label, { announced: announcedExclusions(editedFor4(statA.screening)) }));
    const honest4 = await proofError(deviceASPProof(A, D4.label, { announced: announcedNow }));
    assert(statesText(ns) === "removal_announced(fraud)" && !offersPublicExit(D4, ns[0]) && edited4 === "REMOVAL_ANNOUNCED" && honest4 === "proved", "an edited answer holds the app back");
    // An answer for one visitor alone that announces every member but deposit 4, next to rootDue, as an honest server
    // sends it while a removal waits (review round 2, finding privacy-1): the app holds back every other note, so any
    // request from this visitor's app could only be about deposit 4. The app counts that crowd, 1, and asks before the
    // operator sees any request: no request for a newer root goes out before the answer, and none for this answer at
    // all (its announcements alone shrink the root sharply, so its rootDue is not followed).
    const r2Members = recipeLabels(evS, recipe2!)!;
    const announceMembers = (s: ASPScreening, labels: readonly bigint[]): ASPScreening => ({
      ...s,
      excluded: [...s.excluded, ...labels.map((l) => ({ leafIndex: leafOf(evS, l), label: l.toString(), reason: "fraud" as const, considered: true }))],
    });
    const allBut4 = announceMembers(statA.screening, r2Members.filter((l) => l !== D4.label && l !== D5.label));
    ns = await noteStates(A, [D3.label, D4.label], () => allBut4);
    assert(withdrawHold(ns[0]) === "removal_announced" && withdrawHold(ns[1]) === null, `every note but deposit 4 is held (${statesText(ns)})`);
    assert(allBut4.rootDue, "the edited answer says a root is due");
    const relayerBefore = await nonceOf(A, RELAYER);
    const postmanBefore = await nonceOf(A, POSTMAN);
    before = publishRequests;
    const oracleSeq: string[] = [];
    const oracle = await proofError(deviceAssociationProof(A, D4.label, { editScreening: () => allBut4, answer: () => false, seq: oracleSeq }));
    assert(
      oracle === "DECLINED" && oracleSeq.join(" | ") === `question shrink/current ${r2Members.length}->1 before any request` && publishRequests === before,
      `an all-but-one answer with a root due: ${oracle}; ${oracleSeq.join(" | ")}`,
    );
    assert(
      !publishDue({ events: evS, currentRoot: R2, screening: allBut4 }) && publishDue({ events: evS, currentRoot: R2, screening: statA.screening }),
      "its rootDue is not followed (the honest answer's is)",
    );
    // One answer covers every network: the same answer saying that B's root is due sends no request either (review
    // round 3), while the honest answer for A does.
    const answerNow = await statusAnswer();
    const statesNow = await Promise.all(CTXS.map(deviceState));
    const bDue = (s: ASPScreening | null): ASPScreening | null => (s ? { ...s, rootDue: true } : s);
    const across = (forA: ASPScreening) =>
      CTXS.map((c, k) => ({ events: statesNow[k].events, currentRoot: statesNow[k].currentRoot, screening: c === A ? forA : bDue(screeningIn(answerNow, c)) }));
    assert(!publishDueAcross(across(allBut4)) && publishDueAcross(across(statA.screening)), "an answer that shrinks A's root sharply sends no request on any network");
    // fewer announcements, no sharp drop, but a crowd below 10: the small-set question, again before any request
    const fewerSeq: string[] = [];
    const leave9 = announceMembers(statA.screening, r2Members.filter((l) => l !== D4.label && l !== D5.label).slice(0, r2Members.length - 10));
    const fewer = await proofError(deviceAssociationProof(A, D4.label, { editScreening: () => leave9, answer: () => false, seq: fewerSeq }));
    assert(
      fewer === "DECLINED" && fewerSeq.join(" | ") === "question small 9 before any request" && publishRequests === before && publishDue({ events: evS, currentRoot: R2, screening: leave9 }),
      `a crowd of 9 by announcements: ${fewer}; ${fewerSeq.join(" | ")}`,
    );
    assert((await nonceOf(A, RELAYER)) === relayerBefore && (await nonceOf(A, POSTMAN)) === postmanBefore, "nothing reached the relayer or the publisher");
    // no exclusion note anywhere in the public answers or the boot summary (the list holds two entries with notes now)
    const answers = jsonOf([await asp.getASPStatuses(), await asp.getPublicAssociationSets(), await pools.listPools("24h"), await pools.getPoolActivity(), await pools.getNetworks()]);
    const boot2: string[] = [];
    config.logPrivacyConfigSummary((line) => boot2.push(line));
    assert(answers.includes(D5.label.toString()) && !answers.includes(SENTINEL) && boot2.some((l) => l.includes(": 2 entries")) && !boot2.join("\n").includes(SENTINEL), "the answers list the excluded deposits, never a note");
    ok(
      `announced: held back without public-exit advice (REMOVAL_ANNOUNCED); an edited answer holds the app back; an all-but-one answer with a root due leaves a crowd of 1 that the app asks about before any request (${r2Members.length} → 1, and its rootDue sends nothing, on either network), and one that leaves 9 gets the small-set question first; no note in any answer`,
    );

    step(`${A.name}: the periodic publisher's tick posts the removal root R_rm: deposit 5 is out, its leaf listed in the root's record`);
    const tick3 = await autoPublish.autoPublishTick(CHAIN_A);
    assert(tick3.outcome === "posted" && tick3.txHash, `the tick posts (${tick3.outcome}: ${tick3.detail})`);
    const Rrm = await currentRoot(A);
    const rmPost = await postOf(tick3.txHash!);
    evS = await eventsOf(A);
    const rmCid = rootEvents(evS).at(-1)!.cid;
    const leafD5 = leafOf(evS, D5.label);
    const rmRecipe = parseRecipe(rmCid);
    assert(rmRecipe?.considered === 15 && rmRecipe.excludedLeaves.join() === [leafD5, leafD6].sort((a, b) => a - b).join(), `x = deposits 5 and 6 (${rmCid})`);
    assert(Rrm === setRoot(depositsInLeafOrder(evS).slice(0, 15).filter((d) => d.label !== D5.label && d.label !== D6.label).map((d) => d.label)), "R_rm leaves deposits 5 and 6 out");
    ns = await noteStates(A, [D5.label]);
    assert(
      statesText(ns) === "excluded(test,listed,removed)" && offersPublicExit(D5, ns[0]) && withdrawHold(ns[0]) === "excluded" && ns[0].depositor === BOB.toLowerCase(),
      `the vault: excluded after it had been in the set; the public exit pays bob's address (${statesText(ns)})`,
    );
    before = publishRequests;
    const e5 = await proofError(deviceAssociationProof(A, D5.label));
    assert(e5 === "EXCLUDED" && publishRequests === before, `the device: ${e5}, no publish request`);
    // its public exit works from bob's address only (simulated: deposit 5 leaves privately later, once its exclusion is lifted)
    const rq5 = await proveCommitment({ value: D5.value, label: D5.label, nullifier: D5.nullifier, secret: D5.secret }, commitmentArtifacts);
    const rq5Args = [rq5.proof, sig4(rq5.publicSignals)] as const;
    const rq5Bob = await revertOf(A.pub.simulateContract({ address: A.pool, abi: PRIVACY_POOL_ABI, functionName: "ragequit", args: rq5Args, account: BOB }));
    const rq5Alice = await revertOf(A.pub.simulateContract({ address: A.pool, abi: PRIVACY_POOL_ABI, functionName: "ragequit", args: rq5Args, account: ALICE }));
    assert(rq5Bob === "no revert" && rq5Alice === "NotDepositor", `ragequit from bob: ${rq5Bob}; from alice: ${rq5Alice}`);
    ok(`R_rm posted (${rmCid}, gas ${rmPost.gas}); deposit 5: excluded after inclusion; the device refuses (EXCLUDED); its public exit works from bob's wallet`);

    step(`${A.name}: the window is open: older roots that hold deposit 5 are still known; the relayer refuses proofs against them, a client paying its own gas is not stopped`);
    // a Phase 3 tab still open picks the largest known prefix root that holds the deposit: R1 (R2 is no prefix: deposit 6 is left out of it)
    const old5 = await phase3Proof(A, D5.label);
    assert(old5.root === R1 && old5.size === 6, "the older rule proves deposit 5 against R1");
    const p2 = await relayedProof(A, st, D5, old5, D5.value, RECIPIENT.a5);
    const refused2 = await relayRefusal(A, p2);
    const refused1 = await relayRefusal(A, p1);
    assert(refused2 === relayer.ASP_ROOT_REFUSED && refused1 === relayer.ASP_ROOT_REFUSED, `the relayer refuses both before simulating (${refused2} | ${refused1})`);
    assert((await simulateWithdraw(A, p2)) === "no revert" && (await simulateWithdraw(A, p1)) === "no revert", "sent straight to the pool, both still pass");
    assert((await isKnownRootOf(A)(R1)) && (await isKnownRootOf(A)(R2)), "R1 and R2 are known");
    // a withdrawal proved now by the app is against the current root R_rm (deposit 3)
    const p3 = await relayedProof(A, st, D3, await deviceASPProof(A, D3.label), D3.value, RECIPIENT.a6);
    assert(p3.r.publicSignals[WITHDRAW_PUBLIC_SIGNALS.ASPRoot] === Rrm, "the app proves against R_rm");
    ok(`relayer: "${refused2}"; direct: both pass (deposit 5 against R1, deposit 4 against R2); a new proof uses R_rm`);

    step(`${A.name}: two natural roots: a deposit of carol's joins after the delay, twice (each one tick); the older roots stay known`);
    const natural: { root: bigint; block: bigint; time: number; gas: bigint }[] = [];
    for (const k of [8, 9]) {
      const t = (await headTime(A)) + 10;
      await depositBlock(A, [filler(k)], t);
      await mineAt(A, t + DELAY_A);
      const tick = await autoPublish.autoPublishTick(CHAIN_A);
      assert(tick.outcome === "posted" && tick.txHash, `the tick posts (${tick.outcome}: ${tick.detail})`);
      natural.push({ root: await currentRoot(A), ...(await postOf(tick.txHash!)) });
      const still = [await isKnownRootOf(A)(R1), await isKnownRootOf(A)(R2), (await simulateWithdraw(A, p1)) === "no revert", (await simulateWithdraw(A, p2)) === "no revert"];
      assert(still.every(Boolean), `after natural root ${natural.length}: R1 and R2 known, both old proofs pass (${still.join()})`);
    }
    const [N1, N2] = natural.map((n) => n.root);
    ok(`N1 (block ${natural[0].block}, t0+${natural[0].time - rmPost.time} s) and N2 (block ${natural[1].block}, t0+${natural[1].time - rmPost.time} s); R1 and R2 still known`);

    step(`${A.name}: npm run zk:asp:publish -- --evict, the plan (from the contract's ring): 13 re-posts of the current root; the preview sends nothing`);
    const postmanNonce = await nonceOf(A, POSTMAN);
    const plan = await evict.planEviction(CHAIN_A);
    assert(
      plan.blockers.length === 0 && plan.postsNeeded === 13 && plan.currentRoot === N2 && plan.offending.map((o) => `${o.root}@${o.distance}`).join() === `${R2}@3,${R1}@4`,
      `the plan: ${plan.postsNeeded} posts; offending ${plan.offending.map((o) => `d${o.distance}`).join()}; blockers ${plan.blockers.join("; ")}`,
    );
    const preview = await evict.evictExcludedRoots(CHAIN_A, { send: false });
    assert(preview.posts.length === 0 && !preview.evicted && (await nonceOf(A, POSTMAN)) === postmanNonce, "the preview sends nothing");
    ok(`ring: ${plan.ring.map((e) => `d${e.distance}${e.taint === "holds" ? " (holds an excluded deposit)" : ""}`).join(", ")}; ${plan.postsNeeded} posts, about ${formatEther(plan.costWei)} ETH with the margin`);

    step(`${A.name}: --evict --yes, the burst (an opt-in operator command, never automatic), checked after every post`);
    const perPost: { k: number; block: bigint; gas: bigint; r1: boolean; r2: boolean; p1: string; p2: string }[] = [];
    let checkMs = 0;
    const burst = await evict.evictExcludedRoots(CHAIN_A, {
      send: true,
      onPost: async (k, post) => {
        const t0 = Date.now();
        const [r1, r2, s1, s2] = await Promise.all([isKnownRootOf(A)(R1), isKnownRootOf(A)(R2), simulateWithdraw(A, p1), simulateWithdraw(A, p2)]);
        perPost.push({ k, block: post.block, gas: post.gasUsed, r1, r2, p1: s1, p2: s2 });
        checkMs += Date.now() - t0;
      },
    });
    assert(burst.evicted && burst.posts.length === 13 && perPost.length === 13, `evicted with ${burst.posts.length} posts`);
    for (const p of perPost) {
      assert(p.r1 === (p.k <= 11) && p.r2 === (p.k <= 12), `after burst post ${p.k}: R1 ${p.r1 ? "known" : "gone"}, R2 ${p.r2 ? "known" : "gone"}`);
      assert(p.p2 === (p.k <= 11 ? "no revert" : "UnknownASPRoot") && p.p1 === (p.k <= 12 ? "no revert" : "UnknownASPRoot"), `after burst post ${p.k}: deposit 4's proof ${p.p1}, deposit 5's ${p.p2}`);
    }
    assert((await currentRoot(A)) === N2 && (await isKnownRootOf(A)(Rrm)) && (await isKnownRootOf(A)(N1)), "the current root is N2; R_rm and N1 are still known");
    assert((await nonceOf(A, POSTMAN)) === postmanNonce + 13, "13 transactions");
    evS = await eventsOf(A);
    const lastRoots = rootEvents(evS);
    assert(lastRoots.slice(-14).every((e) => e.root === N2 && e.cid === lastRoots.at(-14)!.cid), "every re-post carries N2 and N2's own record");
    // a device that read the chain before the removal still holds R2 as the current root: unknown now, it refuses
    const stale = await proofError(buildAssociationProof({ label: D4.label, events: evS, currentRoot: R2, isKnownRoot: isKnownRootOf(A) }));
    assert(stale === "ROOT_NOT_KNOWN", `a stale current root: ${stale}`);
    // a proof made after the removal root survives the burst (the burst only kills proofs against the offending roots)
    assert((await simulateWithdraw(A, p3)) === "no revert", "deposit 3's proof against R_rm still passes");
    const w3 = await sendRelayed(A, p3);
    // the in-flight proof of deposit 4 is made again, against the current root, and goes through
    st = await syncNotes(A, keys);
    const again = await deviceAssociationProof(A, D4.label);
    assert(again.proof.root === N2 && !again.behind, "made again against the current root N2");
    const w4 = await relayedWithdrawal(A, st, noteAt(st, 4), again.proof, D4.value, RECIPIENT.a7);
    const lastR1 = Math.max(...perPost.filter((p) => p.r1).map((p) => p.k));
    const lastR2 = Math.max(...perPost.filter((p) => p.r2).map((p) => p.k));
    ok(`R1 gone after burst post ${lastR1 + 1}, R2 after post ${lastR2 + 1}; the old proofs then revert UnknownASPRoot; deposit 3 (proved against R_rm) relayed (tx ${w3.txHash.slice(0, 12)}…); deposit 4 proved again and relayed (tx ${w4.txHash.slice(0, 12)}…)`);

    const burstGas = burst.posts.map((p) => p.gasUsed);
    const burstTimes = await Promise.all([burst.posts[0].block, burst.posts.at(-1)!.block].map(async (b) => Number((await A.pub.getBlock({ blockNumber: b })).timestamp)));
    const allAfterRm = [...natural.map((n) => n.gas), ...burstGas];
    const gasLine = (xs: readonly bigint[]) =>
      `gas min ${minOf(xs)}, avg ${sumOf(xs) / BigInt(xs.length)}, max ${maxOf(xs)}, total ${sumOf(xs)} (${formatEther(sumOf(xs) * PRICE_001_GWEI)} ETH at 0.01 gwei)`;
    console.log(`\n  ── the 16-root window, measured on ${A.name}'s anvil (anvil gas: no parent-chain data fee) ──`);
    console.log(`  R1 (n=6) and R2 (n=15) hold deposit 5; R_rm removes it: block ${rmPost.block}, chain time t0=${rmPost.time}, gas ${rmPost.gas}`);
    natural.forEach((n, i) => console.log(`  natural root N${i + 1}: block ${n.block}, t0+${n.time - rmPost.time} s (one deposit joined after the ${DELAY_A} s delay), gas ${n.gas}`));
    console.log(
      `  eviction burst: ${burst.posts.length} re-posts of N2 in blocks ${burst.posts[0].block}-${burst.posts.at(-1)!.block} (chain time ${burstTimes[1] - burstTimes[0]} s), ${Math.max(0, burst.ms - checkMs)} ms wall clock without this run's per-post checks (anvil, a block per transaction); ${gasLine(burstGas)}`,
    );
    console.log(`  known after each burst post: R1 ${perPost.map((p) => (p.r1 ? "y" : "n")).join("")}, R2 ${perPost.map((p) => (p.r2 ? "y" : "n")).join("")}`);
    console.log(`  gas of each burst post (a never-written ring slot costs more than an overwritten one): ${burstGas.join(", ")}`);
    console.log(`  R2, the last root holding deposit 5, stayed known through ${2 + lastR2} posts after R_rm and was gone after the ${2 + lastR2 + 1}th; R1 after the ${2 + lastR1 + 1}th`);
    console.log(`  the ${allAfterRm.length} posts after R_rm: ${gasLine(allAfterRm)}`);

    // 4. the exclusion lifted
    step(`${A.name}: the operator lifts bob's exclusion: held while the list is younger than 30 s; then the periodic publisher posts the root that re-admits deposit 5, and it is withdrawn`);
    writeExclusions([entryD6], { settled: false });
    let snap = await asp.getScreenedSet({ chainId: CHAIN_A, fresh: true });
    assert(snap.settling && !snap.rootDue && snap.readmitted.join() === String(leafD5), `held: settling ${snap.settling}, rootDue ${snap.rootDue}, readmitted ${snap.readmitted.join()}`);
    assert((await asp.publishASPRoot(CHAIN_A)).status === "current" && (await currentRoot(A)) === N2, "a publish sends nothing yet");
    writeExclusions([entryD6], { comment: "e2e: bob's entry removed, saved again later" });
    statA = await statusOf(A);
    ns = await noteStates(A, [D5.label]);
    assert(statA.screening.rootDue && statA.screening.readmitted === 1, "settled: a root is due that admits deposit 5 again");
    // the operator's word alone never starts a private withdrawal: held until the root on-chain holds it again
    assert(ns[0].readmitted && withdrawHold(ns[0]) === "readmitted" && !offersPublicExit(D5, ns[0]), "the vault: being re-admitted, held, no public-exit advice");
    const tick4 = await autoPublish.autoPublishTick(CHAIN_A);
    const Run = await currentRoot(A);
    assert(tick4.outcome === "posted" && Run !== N2, `the tick posts the root that re-admits deposit 5 (${tick4.outcome}: ${tick4.detail})`);
    ns = await noteStates(A, [D5.label]);
    assert(stateText(ns[0]).startsWith("in_set(") && withdrawHold(ns[0]) === null, `the vault: in the set again, no longer held (${statesText(ns)})`);
    before = publishRequests;
    const back = await deviceAssociationProof(A, D5.label);
    assert(publishRequests === before && back.proof.root === Run, "no publish request needed; proved against the root that re-admits it");
    evS = await eventsOf(A);
    assert(parseRecipe(rootEvents(evS).at(-1)!.cid)?.excludedLeaves.join() === String(leafD6), "only deposit 6 stays excluded");
    st = await syncNotes(A, keys);
    const w5 = await relayedWithdrawal(A, st, noteAt(st, 5), back.proof, D5.value, RECIPIENT.a8);
    ok(`deposit 5 re-admitted (${rootEvents(evS).at(-1)!.cid}) and withdrawn privately (tx ${w5.txHash.slice(0, 12)}…)`);

    // 5. the same calls for every note; an invalid list
    step(`${A.name}: four more deposits of carol's in one block; a withdrawal attempt makes the same calls for a note in the set, waiting, excluded or not held`);
    const tF = (await headTime(A)) + 10;
    await depositBlock(A, [10, 11, 12, 13].map(filler), tF);
    evS = await eventsOf(A);
    const waitingLabel = discoverNotes(fillerKeys, A.scope, evS).notes.find((n) => n.depositIndex === 10)!.label;
    statA = await statusOf(A);
    const due5 = publishDue({ events: evS, currentRoot: await currentRoot(A), screening: statA.screening });
    const callsFor = async (label: bigint) => {
      const log: string[] = [];
      const outcome = await proofError(
        resolveAssociationProof({
          label,
          state: await deviceState(A),
          reload: async () => (log.push("re-sync"), deviceState(A)),
          isKnownRoot: async (root) => (log.push(`isKnownASPRoot(${root})`), isKnownRootOf(A)(root)),
          fetchRootRecord: async () => (log.push("privacy.asp.set()"), recordOf(A)()),
          requestPublish: async () => (log.push("privacy.asp.publish()"), null),
          publishDue: due5,
          announced: announcedExclusions(statA.screening),
        }),
      );
      return { outcome, calls: log.join() };
    };
    const recorded: { outcome: string; calls: string }[] = [];
    for (const label of [note0.label, waitingLabel, D6.label, 0xabcdefn]) recorded.push(await callsFor(label));
    assert(recorded.map((r) => r.outcome).join() === "proved,WAITING,EXCLUDED,NOT_MEMBER", `outcomes ${recorded.map((r) => r.outcome).join()}`);
    assert(!due5 && recorded.every((r) => r.calls === recorded[0].calls) && recorded[0].calls === `isKnownASPRoot(${Run})`, `identical calls (${recorded.map((r) => r.calls).join(" | ")})`);
    ok(`in the set, waiting, excluded, not held: ${recorded.map((r) => r.outcome).join(", ")}; every one asked only isKnownASPRoot(current root)`);

    step(`${A.name}: an invalid exclusion list pauses publishing on every network (policy_error): nothing is sent; once fixed, the root goes out`);
    writeExclusions(`{ "format": "hylsia-asp-exclusions", "version": 1, "entries": [ { "label": "${D6.label}", "reason": "test", "note": "${SENTINEL}" }`);
    await mineAt(A, tF + DELAY_A); // carol's four deposits are eligible: a root is due
    statA = await statusOf(A);
    assert(
      !statA.canPublish && statA.publishBlock === "policy_error" && statA.screening.exclusions === "invalid" && statA.screening.rootDue && statA.screening.excluded.some((e) => e.label === D6.label.toString()),
      "status: paused; the last good list still shown",
    );
    const pausedNonce = await nonceOf(A, POSTMAN);
    const paused = await asp.publishASPRoot(CHAIN_A);
    const pausedTick = await autoPublish.autoPublishTick(CHAIN_A);
    pools.resetPoolCaches();
    const rowA = (await pools.listPools("24h")).pools.find((p) => p.chainId === CHAIN_A)!;
    assert(paused.status === "policy_error" && /exclusion list is invalid/.test(asp.policyErrorReason(paused) ?? "") && pausedTick.outcome === "policy_error", `publish ${paused.status}, tick ${pausedTick.outcome}`);
    assert(!rowA.aspCanPublish && rowA.aspPublishBlock === "policy_error" && (await nonceOf(A, POSTMAN)) === pausedNonce, "privacy.pools says so; the postman sent nothing");
    writeExclusions([entryD6], { comment: "e2e: fixed" });
    const fixedPub = await asp.publishASPRoot(CHAIN_A);
    assert(fixedPub.status === "published" && fixedPub.txHash, `fixed: ${fixedPub.status}`);
    const Rbig = await currentRoot(A);
    evS = await eventsOf(A);
    const bigEvent = rootEvents(evS).at(-1)!;
    const bigRecipe = parseRecipe(bigEvent.cid) as RecipeV1;
    const bigLabels = recipeLabels(evS, bigRecipe)!;
    assert(bigRecipe.considered === 21 && bigRecipe.excludedLeaves.join() === String(leafD6) && bigLabels.length === 20 && setRoot(bigLabels) === Rbig, `the root of 20 (${bigEvent.cid})`);
    ok(`invalid: publish, tick and privacy.pools say policy_error, nothing sent ("${asp.policyErrorReason(paused)}"); fixed: ${bigEvent.cid}`);

    // 6. roots from another publisher
    step(`${A.name}: another publisher posts a root whose list is no subsequence of the deposits (two members swapped), with R_big's own record`);
    await postRoot(A, setRoot([bigLabels[1], bigLabels[0], ...bigLabels.slice(2)]), bigEvent.cid);
    const swapped = await proofError(deviceASPProof(A, note0.label));
    statA = await statusOf(A);
    assert(swapped === "UNVERIFIED_ROOT/root" && statA.screening.current?.status === "mismatch" && statA.screening.rootDue, `the device: ${swapped}; the server: ${statA.screening.current?.status}`);
    const flapNonce = await nonceOf(A, POSTMAN);
    const noFlap = await asp.publishASPRoot(CHAIN_A);
    assert(noFlap.status === "published" && noFlap.txHash === fixedPub.txHash && (await nonceOf(A, POSTMAN)) === flapNonce, "within 10 minutes of its own post of R_big, the server does not post it again (two publishers never flap)");
    ok("refused on the device (the list does not hash to the root); the server answers with its earlier post and sends nothing");

    step(`${A.name}: then a root of the older open policy (a prefix of every deposit, deposit 6 included) after the screened roots`);
    evS = await eventsOf(A);
    const allDeposits = depositsInLeafOrder(evS);
    await postRoot(A, setRoot(allDeposits.map((d) => d.label)), `open-testnet-policy:count=${allDeposits.length}:head=${await A.pub.getBlockNumber({ cacheTime: 0 })}`);
    const backwards = await proofError(deviceASPProof(A, note0.label));
    statA = await statusOf(A);
    assert(backwards === "UNVERIFIED_ROOT/version_backwards" && statA.screening.current?.status === "mismatch" && statA.screening.rootDue, `the device: ${backwards}`);
    ok("refused on the device: the policy version went backwards; the server sees a mismatch and a root due");

    step(`${A.name}: after a restart (or 10 minutes) the server posts its screened root again; the device verifies it`);
    asp.resetASPCache();
    const repost = await asp.publishASPRoot(CHAIN_A);
    assert(repost.status === "published" && repost.txHash !== fixedPub.txHash && (await currentRoot(A)) === Rbig, `posted again: ${repost.status}`);
    assert((await proofError(deviceASPProof(A, note0.label))) === "proved", "the device proves against it again");
    ok(`R_big current again (tx ${repost.txHash!.slice(0, 12)}…)`);

    step(`${A.name}: the same root re-posted by hand with a record that does not match it: the server repairs the record once, never twice`);
    const wrongCid = formatRecipe({ ...bigRecipe, excludedLeaves: [] }); // it would count deposit 6 as a member
    await postRoot(A, Rbig, wrongCid);
    const wrongRecord = await proofError(deviceASPProof(A, note0.label));
    snap = await asp.getScreenedSet({ chainId: CHAIN_A, fresh: true });
    assert(wrongRecord === "UNVERIFIED_ROOT/root" && snap.rootDue && snap.repair, `the device: ${wrongRecord}; repair due ${snap.repair}`);
    const repairPub = await asp.publishASPRoot(CHAIN_A);
    evS = await eventsOf(A);
    const repairedRecipe = parseRecipe(rootEvents(evS).at(-1)!.cid);
    assert(
      repairPub.status === "published" && rootEvents(evS).at(-1)!.root === Rbig && repairedRecipe?.considered === 21 && repairedRecipe.excludedLeaves.join() === String(leafD6),
      "the same root again, with its own recipe",
    );
    assert((await proofError(deviceASPProof(A, note0.label))) === "proved", "the device verifies it again");
    await postRoot(A, Rbig, wrongCid);
    snap = await asp.getScreenedSet({ chainId: CHAIN_A, fresh: true });
    const onceNonce = await nonceOf(A, POSTMAN);
    const onlyOnce = await asp.publishASPRoot(CHAIN_A);
    assert(!snap.rootDue && onlyOnce.status === "current" && (await nonceOf(A, POSTMAN)) === onceNonce, "a root value is repaired once per process");
    ok("repaired once; a second bad record of the same root is left (devices refuse it) until the set changes");

    // 7. the shrink alarm, and a root posted in reply that drops members nobody announced
    step(`${A.name}: deposit 7 joins with the server's root of 21; then, right after deposit 7's withdrawal asks for a root, the operator posts one that drops 10 members it never announced`);
    const tG = (await headTime(A)) + 10;
    await depositBlock(A, [{ from: KEYS.alice, keys, depositIndex: 7, value: parseEther("0.1") }], tG);
    await mineAt(A, tG + DELAY_A); // deposit 7 is eligible: a root is due
    // the current root (R_big with the bad record left in step 6) does not verify on the device, so every note is held
    // and no withdrawal asks: the server's own publish (its schedule) posts the next root
    const pub21 = await asp.publishASPRoot(CHAIN_A);
    assert(pub21.status === "published" && pub21.root, `the server posts the root of 21 (${pub21.status})`);
    const root21 = BigInt(pub21.root!);
    evS = await eventsOf(A);
    const members21 = recipeLabels(evS, parseRecipe(rootEvents(evS).at(-1)!.cid)!)!;
    assert(members21.length === 21, `21 members (${members21.length})`);
    st = await syncNotes(A, keys);
    const D7 = noteAt(st, 7);
    // one more of carol's deposits becomes eligible, so a root is due again when deposit 7 withdraws
    const tH = (await headTime(A)) + 10;
    await depositBlock(A, [filler(14)], tH);
    await mineAt(A, tH + DELAY_A);
    let small = { root: 0n, members: 0, dropped: 0 };
    let root22 = 0n;
    const postSmall = async () => {
      const ev = await eventsOf(A);
      root22 = await currentRoot(A); // the honest root the server just posted in reply
      const deposits = depositsInLeafOrder(ev);
      const dropped = new Set(discoverNotes(fillerKeys, A.scope, ev).notes.filter((n) => n.depositIndex < 10).map((n) => n.label));
      const x = deposits.filter((d) => d.label === D6.label || dropped.has(d.label)).map((d) => d.leafIndex);
      const recipe: RecipeV1 = {
        version: 1,
        considered: deposits.length,
        excludedLeaves: x.sort((a, b) => a - b),
        asOfBlock: await A.pub.getBlockNumber({ cacheTime: 0 }),
        asOfTime: await headTime(A),
        delaySeconds: DELAY_A,
        confirmations: 1,
      };
      const labels = recipeLabels(ev, recipe)!;
      small = { root: setRoot(labels), members: labels.length, dropped: members21.filter((l) => !labels.includes(l)).length };
      await postRoot(A, small.root, formatRecipe(recipe));
    };
    before = publishRequests;
    const relayerNonceA = await nonceOf(A, RELAYER);
    const changedSeq: string[] = [];
    const changed = await proofError(deviceAssociationProof(A, D7.label, { afterPublish: postSmall, seq: changedSeq }));
    assert(publishRequests === before + 1 && changedSeq.join(" | ") === "privacy.asp.publish", `the order: ${changedSeq.join(" | ")}`);
    assert(changed === "SET_CHANGED" && small.dropped === 10 && (await currentRoot(A)) === small.root, `the device stops for every note alike: ${changed} (${small.dropped} dropped)`);
    assert((await nonceOf(A, RELAYER)) === relayerNonceA, "nothing reached the relayer");
    ok(`the root posted in reply drops ${small.dropped} of the 21 members, none announced: the withdrawal stops (SET_CHANGED), the same for any note, so the reply singles out no deposit; nothing reached the relayer`);

    step(`${A.name}: the next attempt: the small root is current, and the shrink question comes before any request`);
    before = publishRequests;
    const retrySeq: string[] = [];
    const retry = await proofError(deviceAssociationProof(A, D7.label, { answer: () => false, seq: retrySeq }));
    const shrunk = await deviceASPProof(A, D7.label);
    const alarm = shrunk.shrink;
    assert(shrunk.root === small.root && shrunk.size === small.members && shrunk.size >= SMALL_ASSOCIATION_SET, `proved in the small root of ${shrunk.size}: no small-set question would come`);
    assert(
      alarm && alarm.basis === "history" && alarm.largerRoot === root22 && alarm.from === 22 && alarm.to === small.members && alarm.removed === 10 && alarm.unexplained === 10,
      `the shrink alarm (${jsonOf(alarm)})`,
    );
    assert(retry === "DECLINED" && publishRequests === before && retrySeq.join(" | ") === `question shrink/history 22->${small.members} before any request`, `the order: ${retry}; ${retrySeq.join(" | ")}`);
    assert((await nonceOf(A, RELAYER)) === relayerNonceA, "nothing reached the relayer");
    ok(`the shrink question (${alarm.from} → ${alarm.to}, ${alarm.removed} removed, ${alarm.unexplained} with no reason from the operator) comes before any request; "Don't send" sends nothing`);

    step(`${A.name}: the operator then re-posts the small root ${ASP_ROOT_HISTORY_SIZE - 1} times (a burst), then posts ${SHRINK_ALARM_ROOTS} different roots that verify nowhere and the small root again: the alarm still asks`);
    const smallCid = rootEvents(await eventsOf(A)).at(-1)!.cid;
    assert((await isKnownRootOf(A)(root22)) && (await isKnownRootOf(A)(root21)), "the larger roots are in the contract's ring before the burst");
    for (let k = 0; k < ASP_ROOT_HISTORY_SIZE - 1; k++) await postRoot(A, small.root, smallCid);
    assert(!(await isKnownRootOf(A)(root22)) && !(await isKnownRootOf(A)(root21)), "the larger roots are no longer in the contract's ring");
    const afterBurst = await deviceASPProof(A, D7.label);
    assert(
      afterBurst.root === small.root && afterBurst.shrink?.from === 22 && afterBurst.shrink.to === small.members && afterBurst.shrink.basis === "history",
      `after the burst: ${jsonOf(afterBurst.shrink)}`,
    );
    // review round 2, finding privacy-3: values that verify nowhere never count toward the alarm's 16 roots
    for (let k = 0; k < SHRINK_ALARM_ROOTS; k++) await postRoot(A, 987_654_321n + BigInt(k) * 7_777n, "x");
    await postRoot(A, small.root, smallCid);
    const afterGarbage = await deviceASPProof(A, D7.label);
    assert(
      afterGarbage.root === small.root && afterGarbage.shrink?.from === 22 && afterGarbage.shrink.to === small.members && afterGarbage.shrink.basis === "history",
      `after ${SHRINK_ALARM_ROOTS} roots that verify nowhere: ${jsonOf(afterGarbage.shrink)}`,
    );
    ok(`the alarm compares with the pool's last 16 different roots that verify in the device's own events, not the contract's ring: still 22 → ${small.members} after copies of the small root and after ${SHRINK_ALARM_ROOTS} garbage roots`);

    // 8. a newer policy on-chain, and everything left leaves by the public exit
    step(`${A.name}: a root of a newer screening policy (v2) on-chain: the device says the app is out of date; the server pauses (it never posts below the chain's version)`);
    await postRoot(A, setRoot([note0.label]), `hylsia-asp:v2;n=22;x=;asOf=1;t=1;delay=${DELAY_A};conf=1`);
    const outdated = await proofError(deviceASPProof(A, D7.label));
    ns = await noteStates(A, [D7.label]);
    statA = await statusOf(A);
    const v2Nonce = await nonceOf(A, POSTMAN);
    const v2Paused = await asp.publishASPRoot(CHAIN_A);
    assert(outdated === "UNVERIFIED_ROOT/outdated" && withdrawHold(ns[0]) === "outdated" && !statA.canPublish && statA.publishBlock === "policy_error", `the device: ${outdated}; the server: ${statA.publishBlock}`);
    assert(v2Paused.status === "policy_error" && /version 2/.test(asp.policyErrorReason(v2Paused) ?? "") && (await nonceOf(A, POSTMAN)) === v2Nonce, `publish ${v2Paused.status}: nothing sent`);
    ok(`the device: reload the page; the server: "${asp.policyErrorReason(v2Paused)}"`);

    step(`${A.name}: everything left leaves by the public exit: deposit 7 (alice) and carol's 15 deposits`);
    st = await syncNotes(A, keys);
    await ragequit(A, noteAt(st, 7), KEYS.alice);
    const carolNotes = discoverNotes(fillerKeys, A.scope, await eventsOf(A)).notes.filter((n) => !n.spent);
    assert(carolNotes.length === 15, `carol's 15 notes (${carolNotes.length})`);
    const exitGas: bigint[] = [];
    for (const n of carolNotes) exitGas.push((await ragequit(A, n, KEYS.carol)).gasUsed);
    st = await syncNotes(A, keys);
    assert(privateBalance(st.notes) === 0n && (await poolBalance(A)) === 0n, "A's pool holds 0 again");
    await setMining(A, "interval");
    ok(`16 ragequits (carol's ${gasLine(exitGas)})`);

    // no exclusion note and no key in anything printed (this script's lines and the server modules' logs)
    const everything = printed.join("\n");
    assert(!everything.includes(SENTINEL), "no exclusion note was ever printed or logged");
    for (const k of Object.values(KEYS)) assert(!everything.toLowerCase().includes(k.slice(2).toLowerCase()), "no key was ever printed or logged");

    for (const c of CTXS) assert((await poolBalance(c)) === 0n, `${c.name}: pool balance is 0 (value conserved)`);
    ok("both pools hold 0; no exclusion note and no key in any answer or log line");
    console.log(`\n✅ two-network e2e passed in ${((Date.now() - started) / 1000).toFixed(0)}s (${networkById(CHAIN_A)!.name} and ${networkById(CHAIN_B)!.name} ids on two local anvils)`);
  } finally {
    stopAnvils();
    fs.rmSync(tmp, { recursive: true, force: true });
    removeLocalRecords();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n❌", err);
    process.exit(1);
  });
