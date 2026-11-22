/**
 * Pure checks on pool deployment records, for scripts/privacy/sync-deployments.ts, scripts/privacy/deploy.ts and
 * scripts/privacy/build-circuits.ts. Tested in server/privacy/deploymentRecords.test.ts.
 *
 * A record is contracts/deployments/<chainId>.json, written by contracts/script/Deploy.s.sol on `--broadcast` only.
 * It reaches the app (shared/privacy/deployments.ts) only when every check here passes; one bad record stops the
 * sync and nothing is written. Records made on anvil for a public chain id go to contracts/deployments/local/, which
 * is never read.
 *
 * Nothing here touches the network or the file system: the scripts read, these functions decide.
 */
import { getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import { PROTOCOL_VERSION } from "../../shared/privacy/constants";
import { V2_ETH_PROTOCOL } from "../../shared/privacy/protocols";
import { computeScope } from "../../shared/privacy/context";
import type { PoolDeployment } from "../../shared/privacy/deploymentTypes";
import { isAnvilDefaultAccount, networkById, type NetworkInfo } from "../../shared/privacy/networks";

/** The nine fields every record carries (Deploy.s.sol writes them all). */
export const REQUIRED_FIELDS = [
  "chainId",
  "pool",
  "withdrawVerifier",
  "commitmentVerifier",
  "owner",
  "aspPostman",
  "scope",
  "minDepositWei",
  "deployBlock",
] as const;

const ADDRESS_FIELDS = ["pool", "withdrawVerifier", "commitmentVerifier", "owner", "aspPostman"] as const;
const DECIMAL_FIELDS = ["scope", "minDepositWei", "deployBlock"] as const;
const LIBRARY_NAMES = ["PoseidonT3", "PoseidonT4"] as const;

const isDecimal = (v: unknown): v is string => typeof v === "string" && /^\d+$/.test(v);
const label = (n: NetworkInfo | null, chainId: number) => (n ? `${n.name} (${chainId})` : `chain ${chainId}`);

// ─── one record ───────────────────────────────────────────────────────────────

export type RecordCheck =
  | { kind: "ok"; record: PoolDeployment }
  /** a local chain without --include-local: left out, not an error */
  | { kind: "skipped"; reason: string }
  | { kind: "invalid"; problems: string[] };

/**
 * Validates one record read from `<deployments>/<fileName>`:
 *   - the file name is `<chainId>.json` and names a network Hylsia is built for;
 *   - every required field is present and well-formed; addresses are checksummed;
 *   - `scope === computeScope(pool, chainId)` (a record copied from another chain or pool fails here);
 *   - on a public network: no anvil default account as deployer, owner or postman (the record was made on a local
 *     chain), and a deploy block above 0.
 * Local chains (31337, 31338) are skipped unless `includeLocal`.
 */
export function checkRecord(fileName: string, raw: unknown, o: { includeLocal: boolean }): RecordCheck {
  const m = /^(\d+)\.json$/.exec(fileName);
  if (!m) return { kind: "invalid", problems: [`${fileName}: a record file is named <chainId>.json`] };
  const fileId = Number(m[1]);
  const network = networkById(fileId);
  if (!network) return { kind: "invalid", problems: [`${fileName}: Hylsia is not built for network ${fileId}`] };
  if (network.kind === "local" && !o.includeLocal) {
    return { kind: "skipped", reason: `${fileName}: ${label(network, fileId)} is served only with --include-local` };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { kind: "invalid", problems: [`${fileName}: not a JSON object`] };
  }
  const r = raw as Record<string, unknown>;
  const problems: string[] = [];
  const at = (msg: string) => problems.push(`${fileName}: ${msg}`);

  for (const f of REQUIRED_FIELDS) if (r[f] === undefined || r[f] === null || r[f] === "") at(`${f} is missing`);
  const chainId = typeof r.chainId === "number" ? r.chainId : isDecimal(r.chainId) ? Number(r.chainId) : NaN;
  if (r.chainId !== undefined && !Number.isSafeInteger(chainId)) at("chainId is not a chain id");
  else if (Number.isSafeInteger(chainId) && chainId !== fileId) at(`the file name says chain ${fileId}, the record says ${chainId}`);

  const addressFields: string[] = [...ADDRESS_FIELDS, ...(r.deployer !== undefined ? ["deployer"] : [])];
  for (const f of addressFields) {
    const v = r[f];
    if (v === undefined || v === null || v === "") continue; // reported as missing
    if (typeof v !== "string" || !isAddress(v, { strict: false })) at(`${f} is not an address`);
    else if (getAddress(v) !== v) at(`${f} is not checksummed (expected ${getAddress(v)})`);
  }
  for (const f of DECIMAL_FIELDS) if (r[f] !== undefined && r[f] !== "" && !isDecimal(r[f])) at(`${f} must be a decimal string`);
  if (r.protocol !== undefined && r.protocol !== PROTOCOL_VERSION && r.protocol !== V2_ETH_PROTOCOL) at(`protocol is ${String(r.protocol)}; unsupported public deployment protocol`);
  if (r.protocol === V2_ETH_PROTOCOL) {
    for (const field of ["releaseId", "artifactManifestSha256"])
      if (typeof r[field] !== "string" || !/^[0-9a-f]{64}$/.test(r[field] as string)) at(`${field} must pin the exact v2 release`);
    const pins = r.vkeySha256 as Record<string, unknown> | undefined;
    if (!pins || [pins.withdraw, pins.commitment].some(v => typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v))) at("v2 requires both verification-key pins");
  }
  if (problems.length > 0) return { kind: "invalid", problems };

  const pool = r.pool as Address;
  if (BigInt(r.scope as string) !== computeScope(pool, fileId)) {
    at(`scope is not computeScope(pool, ${fileId}): the record was made for another pool or chain`);
  }
  if (network.kind !== "local") {
    const anvil = (["deployer", "owner", "aspPostman"] as const).filter((f) => isAnvilDefaultAccount(r[f] as string | undefined));
    if (anvil.length > 0) {
      at(`${anvil.join(", ")} ${anvil.length === 1 ? "is an anvil default account" : "are anvil default accounts"}: the record was made on a local chain, not on ${network.name}`);
    }
    if (BigInt(r.deployBlock as string) === 0n) at(`deployBlock is 0: a record for ${network.name} names the block the pool was deployed in`);
  }
  if (problems.length > 0) return { kind: "invalid", problems };

  const record: PoolDeployment = {
    chainId: fileId,
    pool,
    withdrawVerifier: r.withdrawVerifier as Address,
    commitmentVerifier: r.commitmentVerifier as Address,
    owner: r.owner as Address,
    aspPostman: r.aspPostman as Address,
    scope: r.scope as string,
    minDepositWei: r.minDepositWei as string,
    deployBlock: r.deployBlock as string,
  };
  if (r.protocol !== undefined) record.protocol = r.protocol as string;
  if (r.deployer !== undefined) record.deployer = r.deployer as Address;
  if (r.protocol === V2_ETH_PROTOCOL) {
    record.releaseId = r.releaseId as string;
    record.artifactManifestSha256 = r.artifactManifestSha256 as string;
    record.vkeySha256 = r.vkeySha256 as PoolDeployment["vkeySha256"];
    for (const key of ["libraries", "txHashes", "poolReceiptBlock", "verifierCodeHash"] as const)
      if (r[key] !== undefined) (record as unknown as Record<string, unknown>)[key] = r[key];
  }
  return { kind: "ok", record };
}

// ─── the broadcast log ────────────────────────────────────────────────────────

interface BroadcastTx {
  hash?: string;
  transactionType?: string;
  contractName?: string | null;
  contractAddress?: string | null;
}
interface BroadcastReceipt {
  transactionHash?: string;
  status?: string;
  blockNumber?: string;
}
interface BroadcastLog {
  chain?: number;
  transactions?: BroadcastTx[];
  receipts?: BroadcastReceipt[];
  /** "<source path>:<Name>:<address>" */
  libraries?: string[];
}

const sameAddress = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();

/**
 * Merges `libraries`, `txHashes` and `poolReceiptBlock` from forge's broadcast log
 * (contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json) into the record. The log must describe this record's
 * deployment (same chain, same pool and verifiers) and every receipt must have status 0x1.
 */
export function mergeBroadcast(record: PoolDeployment, raw: unknown): { record: PoolDeployment; problems: string[] } {
  const name = label(networkById(record.chainId), record.chainId);
  const fail = (msg: string) => ({ record, problems: [`broadcast log for ${name}: ${msg}`] });
  if (typeof raw !== "object" || raw === null) return fail("not a JSON object");
  const log = raw as BroadcastLog;
  if (log.chain !== undefined && log.chain !== record.chainId) return fail(`it is for chain ${log.chain}`);
  const txs = Array.isArray(log.transactions) ? log.transactions : [];
  const receipts = Array.isArray(log.receipts) ? log.receipts : [];
  const created = (contract: string) => txs.find((t) => t.contractName === contract && /^CREATE2?$/.test(t.transactionType ?? ""));
  const names = record.protocol === V2_ETH_PROTOCOL
    ? ["PrivacyPoolV2ETH", "WithdrawVerifierV2ETH", "CommitmentVerifierV2ETH"] as const
    : ["PrivacyPool", "WithdrawVerifier", "CommitmentVerifier"] as const;

  const problems: string[] = [];
  for (const [contract, address] of [
    [names[0], record.pool],
    [names[1], record.withdrawVerifier],
    [names[2], record.commitmentVerifier],
  ] as const) {
    const tx = created(contract);
    if (!tx) problems.push(`no ${contract} deployment in it`);
    else if (!sameAddress(tx.contractAddress, address)) problems.push(`its ${contract} is ${tx.contractAddress}, the record says ${address}: it describes another deployment`);
  }
  if (problems.length > 0) return { record, problems: problems.map((p) => `broadcast log for ${name}: ${p}`) };

  // Receipts are matched by transaction hash (forge's receipt list is not in transaction order).
  const receiptOf = (hash: string | undefined) => receipts.find((x) => sameAddress(x.transactionHash, hash));
  const txHashes: Record<string, Hex> = {};
  for (const tx of txs) {
    if (!tx.contractName || !/^CREATE2?$/.test(tx.transactionType ?? "") || typeof tx.hash !== "string") continue;
    const rc = receiptOf(tx.hash);
    if (!rc) problems.push(`no receipt for the ${tx.contractName} deployment (${tx.hash}); wait for it, then sync again`);
    else if (rc.status !== "0x1") problems.push(`the ${tx.contractName} deployment (${tx.hash}) has status ${rc.status ?? "unknown"}`);
    txHashes[tx.contractName] = tx.hash.toLowerCase() as Hex;
  }
  const poolRc = receiptOf(created(names[0])!.hash);
  const poolBlock = poolRc && typeof poolRc.blockNumber === "string" && /^0x[0-9a-fA-F]+$/.test(poolRc.blockNumber) ? BigInt(poolRc.blockNumber) : null;
  if (poolRc && poolBlock === null) problems.push("the pool's receipt has no block number");
  if (poolBlock !== null && poolBlock < BigInt(record.deployBlock)) {
    problems.push(`the pool was deployed in block ${poolBlock}, before the record's deploy block ${record.deployBlock}`);
  }

  const libraries: NonNullable<PoolDeployment["libraries"]> = [];
  for (const libName of LIBRARY_NAMES) {
    const fromList = (log.libraries ?? []).map((s) => s.split(":")).find((parts) => parts.length >= 3 && parts.at(-2) === libName)?.at(-1);
    const address = fromList ?? created(libName)?.contractAddress ?? null;
    if (address && isAddress(address, { strict: false })) libraries.push({ name: libName, address: getAddress(address) });
    else problems.push(`no ${libName} library address in it`);
  }
  if (problems.length > 0) return { record, problems: problems.map((p) => `broadcast log for ${name}: ${p}`) };
  return { record: { ...record, libraries, txHashes, poolReceiptBlock: poolBlock!.toString() }, problems: [] };
}

// ─── verifying keys ───────────────────────────────────────────────────────────

export interface VkeyPin {
  withdraw: string;
  commitment: string;
}

/** The sha256 of the verifying keys served in client/public/zk (manifest.json). */
export function vkeyPinFromManifest(raw: unknown): VkeyPin {
  const circuits = (raw as { circuits?: Record<string, { vkey?: { sha256?: unknown } }> } | null)?.circuits;
  const pick = (name: "withdraw" | "commitment") => {
    const v = circuits?.[name]?.vkey?.sha256;
    if (typeof v !== "string" || !/^[0-9a-f]{64}$/.test(v)) throw new Error(`client/public/zk/manifest.json has no sha256 for the ${name} verifying key`);
    return v;
  };
  return { withdraw: pick("withdraw"), commitment: pick("commitment") };
}

export const DRIFT_MESSAGE = "the served proving keys no longer match the deployed verifiers";

/**
 * Pins the served verifying keys into the record. When the pool was synced before (same chain and pool in the
 * current generated file) with other keys, the served artifacts changed since its deployment: refuse. A code hash
 * checked on-chain earlier is carried over.
 */
export function pinRecord(record: PoolDeployment, pin: VkeyPin, previous: PoolDeployment | undefined): { record: PoolDeployment; problems: string[] } {
  const same = !!previous && previous.chainId === record.chainId && sameAddress(previous.pool, record.pool);
  if (same && previous!.vkeySha256 && (previous!.vkeySha256.withdraw !== pin.withdraw || previous!.vkeySha256.commitment !== pin.commitment)) {
    const name = label(networkById(record.chainId), record.chainId);
    return {
      record,
      problems: [
        `${name}: ${DRIFT_MESSAGE}: client/public/zk serves other verifying keys than when this pool was synced. Restore the artifacts it was deployed with (never run zk:build between deployments), or deploy a new pool with --replace.`,
      ],
    };
  }
  const out: PoolDeployment = { ...record, vkeySha256: { ...pin } };
  if (same && previous!.verifierCodeHash && !out.verifierCodeHash) out.verifierCodeHash = { ...previous!.verifierCodeHash };
  return { record: out, problems: [] };
}

// ─── on-chain facts (sync-deployments --check-onchain) ────────────────────────

export interface OnchainFacts {
  rpcHost: string;
  rpcChainId: number;
  poolCode: Hex | undefined;
  scope: bigint | null;
  verifierCode: { withdraw: Hex | undefined; commitment: Hex | undefined };
  /** deployedBytecode.object of the compiled verifiers (contracts/out) */
  compiled: { withdraw: Hex; commitment: Hex };
}

/** Compares what the chain holds with the record and the compiled verifiers. */
export function checkOnchainFacts(record: PoolDeployment, f: OnchainFacts): { problems: string[]; verifierCodeHash: NonNullable<PoolDeployment["verifierCodeHash"]> | null } {
  const name = label(networkById(record.chainId), record.chainId);
  const problems: string[] = [];
  if (f.rpcChainId !== record.chainId) {
    return { problems: [`${name}: the RPC at ${f.rpcHost} is chain ${f.rpcChainId}, not ${record.chainId}`], verifierCodeHash: null };
  }
  if (!f.poolCode || f.poolCode === "0x") {
    return { problems: [`${name}: no contract at ${record.pool}: the record does not describe a deployed pool`], verifierCodeHash: null };
  }
  if (f.scope === null || f.scope !== BigInt(record.scope)) {
    problems.push(`${name}: SCOPE() at ${record.pool} is ${f.scope ?? "unreadable"}, the record says ${record.scope}`);
  }
  const hashes = { withdraw: f.verifierCode.withdraw, commitment: f.verifierCode.commitment };
  for (const kind of ["withdraw", "commitment"] as const) {
    const code = hashes[kind];
    if (!code || code === "0x" || keccak256(code) !== keccak256(f.compiled[kind])) {
      problems.push(`${name}: ${DRIFT_MESSAGE} (the ${kind} verifier's code differs from contracts/src/verifiers)`);
    }
  }
  if (problems.length > 0) return { problems, verifierCodeHash: null };
  return { problems, verifierCodeHash: { withdraw: keccak256(hashes.withdraw!), commitment: keccak256(hashes.commitment!) } };
}

// ─── the generated file ───────────────────────────────────────────────────────

const HEADER = `// AUTO-GENERATED by scripts/privacy/sync-deployments.ts — do not edit by hand.
// Run \`npm run zk:deployments:sync\` to (re)generate. The record type lives in ./deploymentTypes.
import type { PoolDeployment } from "./deploymentTypes";

`;

const KEY_ORDER: readonly (keyof PoolDeployment)[] = [
  ...REQUIRED_FIELDS,
  "protocol",
  "deployer",
  "libraries",
  "txHashes",
  "poolReceiptBlock",
  "vkeySha256",
  "verifierCodeHash",
  "releaseId",
  "artifactManifestSha256",
];

const propertyName = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

/** A TypeScript literal; an object of plain values stays on one line while it fits in 100 columns. */
function literal(v: unknown, indent: string): string {
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  const inner = `${indent}  `;
  if (Array.isArray(v)) return `[\n${v.map((x) => `${inner}${literal(x, inner)},`).join("\n")}\n${indent}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    const flat = `{ ${entries.map(([k, x]) => `${propertyName(k)}: ${literal(x, inner)}`).join(", ")} }`;
    if (entries.every(([, x]) => typeof x !== "object") && indent.length + flat.length <= 100) return flat;
    return `{\n${entries.map(([k, x]) => `${inner}${propertyName(k)}: ${literal(x, inner)},`).join("\n")}\n${indent}}`;
  }
  throw new Error(`cannot write ${String(v)} into the deployments file`);
}

/** shared/privacy/deployments.ts for these records. With none, it is byte-identical to the hand-made empty file. */
export function renderDeployments(records: readonly PoolDeployment[]): string {
  if (records.length === 0) return `${HEADER}export const DEPLOYMENTS: Record<number, PoolDeployment> = {};\n`;
  const body = [...records]
    .sort((a, b) => a.chainId - b.chainId)
    .map((d) => {
      const fields = KEY_ORDER.filter((k) => d[k] !== undefined).map((k) => `    ${k}: ${literal(d[k], "    ")},`);
      return `  ${d.chainId}: {\n${fields.join("\n")}\n  },`;
    })
    .join("\n");
  return `${HEADER}export const DEPLOYMENTS: Record<number, PoolDeployment> = {\n${body}\n};\n`;
}

// ─── deploy and build guards ──────────────────────────────────────────────────

/** Variables that would point forge at another RPC, chain or verifier, or move the record the sync reads. */
export const FORGE_STRIPPED_ENV = ["ETH_RPC_URL", "CHAIN", "CHAIN_ID", "VERIFIER", "VERIFIER_URL", "PRIVACY_DEPLOYMENT_OUT"] as const;
const FORGE_CONFIG_VARIABLE = /^(FOUNDRY|DAPP)_/;

/**
 * The environment forge runs in for a deployment: the caller's, without FORGE_STRIPPED_ENV and without any FOUNDRY_* or
 * DAPP_* variable. forge reads each of those as an override of contracts/foundry.toml, and several change the code it
 * deploys: FOUNDRY_LIBRARIES (or DAPP_LIBRARIES) links the pool against whatever Poseidon addresses it names instead of
 * deploying the libraries; FOUNDRY_PROFILE, FOUNDRY_OPTIMIZER_RUNS, FOUNDRY_SOLC_VERSION and the like change the
 * bytecode, and with it the CREATE2 library addresses. A deployment uses the checked-in build only when none of them
 * is set. A caller adds its own outputs (e2e: FOUNDRY_BROADCAST, PRIVACY_DEPLOYMENT_OUT) afterwards.
 */
export function forgeChildEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> {
  const stripped = new Set<string>(FORGE_STRIPPED_ENV);
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) {
    if (FORGE_CONFIG_VARIABLE.test(name) || stripped.has(name)) continue;
    out[name] = value;
  }
  return out;
}

/** 127.0.0.0/8, ::1, the unspecified addresses (which reach this machine), and IPv4-mapped forms of them. */
export function isLoopbackAddress(address: string): boolean {
  const a = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const v4 = a.startsWith("::ffff:") ? a.slice(7) : a;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return v4.startsWith("127.") || v4 === "0.0.0.0";
  if (/^::ffff:(7f[0-9a-f]{2}|0{1,4}):[0-9a-f]{1,4}$/.test(a)) return a.startsWith("::ffff:7f") || /^::ffff:0{1,4}:0{1,4}$/.test(a);
  return a === "::1" || a === "::" || /^0{1,4}(:0{1,4}){6}:0{0,3}1$/.test(a) || /^(0{1,4}:){7}0{1,4}$/.test(a);
}

/** localhost names, before any DNS lookup */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  return h === "localhost" || h.endsWith(".localhost") || isLoopbackAddress(h);
}

/**
 * Why scripts/privacy/deploy.ts must not run forge, or null. Checked before anything is sent:
 *   - a loopback RPC is a local chain (use `npm run zk:deploy:local` or `npm run zk:e2e`);
 *   - the RPC answers another chain id;
 *   - a record exists for this network and --replace is not given;
 *   - another public network's pool (when the registry holds more than one) was synced with other verifying keys
 *     than the ones served now (every network from one build), or was never synced, so its keys are unknown.
 */
export function deployRefusal(o: {
  network: NetworkInfo;
  rpcHost: string;
  rpcIsLoopback: boolean;
  rpcChainId: number | null;
  recordExists: boolean;
  replace: boolean;
  served: VkeyPin;
  /** the generated DEPLOYMENTS (shared/privacy/deployments.ts) */
  deployments: Readonly<Record<number, PoolDeployment>>;
}): string | null {
  const { network } = o;
  if (o.rpcIsLoopback) {
    return `refusing ${o.rpcHost}: a loopback RPC is a local chain. Use npm run zk:deploy:local or npm run zk:e2e for local chains.`;
  }
  if (o.rpcChainId !== network.chainId) {
    return `refusing ${o.rpcHost}: it answers chain ${o.rpcChainId ?? "?"}, not ${network.name} (${network.chainId})`;
  }
  if (o.recordExists && !o.replace) {
    return `contracts/deployments/${network.chainId}.json already records a pool on ${network.name}. Pass --replace to deploy a new one (the app then serves the new pool; notes in the old one stay there).`;
  }
  for (const [id, d] of Object.entries(o.deployments)) {
    const other = networkById(Number(id));
    if (!other || other.kind === "local" || other.chainId === network.chainId) continue;
    if (!d.vkeySha256) {
      return `${other.name}'s pool has no pinned verifying keys. Run npm run zk:deployments:sync first, so every network is known to use the same build.`;
    }
    if (d.vkeySha256.withdraw !== o.served.withdraw || d.vkeySha256.commitment !== o.served.commitment) {
      return `verifying-key drift: ${other.name}'s pool was deployed with other verifying keys than client/public/zk serves now. Deploy every network from one build (never run zk:build between deployments).`;
    }
  }
  return null;
}

/**
 * After `forge script --broadcast` failed. Deploy.s.sol writes its record while the script runs, which is BEFORE forge
 * sends anything, so a broadcast that fails (no wallet, out of gas, RPC error) can leave a record of a pool that never
 * reached the chain, and a broadcast whose explorer verification fails leaves a real pool that was never synced.
 *   - nothing_written: the record file is unchanged (or absent);
 *   - phantom: the record names a pool with no code on-chain; restore the previous record, or remove a new one;
 *   - deployed: the pool is on-chain, so forge failed after the deployment (usually the verification): sync it;
 *   - unknown: the record changed but the chain could not be asked; keep it (the on-chain sync check decides later).
 */
export type FailedBroadcastAction =
  | { kind: "nothing_written" }
  | { kind: "phantom"; restore: "previous" | "remove" }
  | { kind: "deployed" }
  | { kind: "unknown" };

export function failedBroadcastAction(
  recordBefore: string | null,
  recordAfter: string | null,
  poolOnchain: "code" | "empty" | "unreachable",
): FailedBroadcastAction {
  if (recordAfter === null || recordAfter === recordBefore) return { kind: "nothing_written" };
  if (poolOnchain === "empty") return { kind: "phantom", restore: recordBefore === null ? "remove" : "previous" };
  if (poolOnchain === "code") return { kind: "deployed" };
  return { kind: "unknown" };
}

/** The pool address in a record's text, or null when the text is not a record with a valid pool address. */
export function recordPool(text: string | null): Address | null {
  if (text === null) return null;
  try {
    const pool = (JSON.parse(text) as { pool?: unknown } | null)?.pool;
    return typeof pool === "string" && isAddress(pool, { strict: false }) ? getAddress(pool) : null;
  } catch {
    return null;
  }
}

/** The public networks that have a record, from the file names in contracts/deployments/ and the generated ids. */
export function publicRecordIds(fileNames: readonly string[], generatedIds: readonly number[] = []): number[] {
  const fromFiles = fileNames.map((f) => /^(\d+)\.json$/.exec(f)).filter((m): m is RegExpExecArray => !!m).map((m) => Number(m[1]));
  const ids = [...new Set([...fromFiles, ...generatedIds])];
  return ids
    .filter((id) => {
      const network = networkById(id);
      return network !== null && network.kind !== "local";
    })
    .sort((a, b) => a - b);
}
