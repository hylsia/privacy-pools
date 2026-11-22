// server/_core/serverless.ts
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// server/_core/trpc.ts
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;

// server/privacy/router.ts
import { TRPCError as TRPCError5 } from "@trpc/server";
import { isAddress as isAddress2 } from "viem";
import { z } from "zod";

// shared/privacy/constants.ts
import { keccak256, toBytes } from "viem";
var SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
var TREE_DEPTH = 20;
var ASP_ROOT_HISTORY_SIZE = 16;
var MAX_VALUE = (1n << 128n) - 1n;
var ZERO_VALUE = BigInt(keccak256(toBytes("hylsia.privacy-pool.v1.zero"))) % SNARK_SCALAR_FIELD;
var NATIVE_ASSET = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
var PROTOCOL_VERSION = "hylsia-pp-v1";
var ROBINHOOD_MAINNET = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Robinhood Chain Explorer", url: "https://robinhoodchain.blockscout.com" }
  },
  testnet: false
};
var ROBINHOOD_TESTNET = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Robinhood Chain Testnet Explorer", url: "https://explorer.testnet.chain.robinhood.com" }
  },
  testnet: true
};
var ANVIL_CHAIN = {
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true
};
var ANVIL_CHAIN_B = {
  id: 31338,
  name: "Anvil B",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8546"] } },
  testnet: true
};

// shared/privacy/networks.ts
import { getAddress, isAddress, zeroAddress } from "viem";

// shared/privacy/chains.ts
import { defineChain } from "viem";
import { mainnet } from "viem/chains";
var robinhoodTestnet = defineChain({ ...ROBINHOOD_TESTNET });
var robinhoodMainnet = defineChain({ ...ROBINHOOD_MAINNET });
var ethereumMainnet = defineChain({
  ...mainnet,
  rpcUrls: { default: { http: ["https://ethereum-rpc.publicnode.com"] } }
});
var anvil = defineChain({ ...ANVIL_CHAIN });
var anvilB = defineChain({ ...ANVIL_CHAIN_B });
var ORDERED = [
  robinhoodTestnet,
  robinhoodMainnet,
  ethereumMainnet,
  anvil,
  anvilB
];
var PRIVACY_CHAINS = Object.fromEntries(ORDERED.map((c) => [c.id, c]));
var SUPPORTED_CHAIN_IDS = ORDERED.map((c) => c.id);

// shared/privacy/context.ts
import { encodeAbiParameters, encodePacked, keccak256 as keccak2562 } from "viem";
function computeScope(pool, chainId2, asset = NATIVE_ASSET) {
  const h = keccak2562(encodePacked(["address", "uint256", "address"], [pool, BigInt(chainId2), asset]));
  return BigInt(h) % SNARK_SCALAR_FIELD;
}
function computeContext(scope, w) {
  const h = keccak2562(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" }
      ],
      [scope, w.recipient, w.relayer, w.fee, w.deadline]
    )
  );
  return BigInt(h) % SNARK_SCALAR_FIELD;
}

// shared/privacy/protocols.ts
var V2_PROTOCOL = "hylsia-pp-v2-candidate";
var V2_ETH_PROTOCOL = "hylsia-pp-v2-eth";
var isV2Protocol = (value) => value === V2_PROTOCOL || value === V2_ETH_PROTOCOL;
var PRIVACY_PROTOCOLS = Object.freeze({
  [PROTOCOL_VERSION]: Object.freeze({
    id: PROTOCOL_VERSION,
    artifactBase: "/zk",
    candidate: false
  }),
  [V2_PROTOCOL]: Object.freeze({
    id: V2_PROTOCOL,
    artifactBase: "/zk-v2-dev",
    candidate: true
  }),
  [V2_ETH_PROTOCOL]: Object.freeze({
    id: V2_ETH_PROTOCOL,
    artifactBase: "/zk-v2-eth",
    candidate: false
  })
});
function protocolDefinition(protocol) {
  if (!Object.hasOwn(PRIVACY_PROTOCOLS, protocol))
    throw new Error(`Unsupported privacy protocol: ${String(protocol)}`);
  return PRIVACY_PROTOCOLS[protocol];
}
function readPrivacyProtocol(value, variable = "PRIVACY_PROTOCOL") {
  const id = value?.trim() || PROTOCOL_VERSION;
  if (!Object.hasOwn(PRIVACY_PROTOCOLS, id))
    throw new Error(`${variable}: unsupported privacy protocol`);
  return id;
}

// shared/privacy/mainnetTargets.ts
var MAINNET_TARGETS = Object.freeze({
  "ethereum-mainnet": Object.freeze({
    slug: "ethereum-mainnet",
    chainId: 1,
    chain: ethereumMainnet,
    verifierApi: "https://eth.blockscout.com/api/"
  }),
  "robinhood-mainnet": Object.freeze({
    slug: "robinhood-mainnet",
    chainId: 4663,
    chain: robinhoodMainnet,
    verifierApi: "https://robinhoodchain.blockscout.com/api/"
  })
});
var isMainnetChainId = (value) => value === 1 || value === 4663;

// shared/privacy/mainnetRelease.ts
var REVIEWED_MAINNET_RELEASES = Object.freeze([]);
var MAINNET_RELEASE_BLOCKERS = [
  "H-01: cross-profile/device note reuse can strand deposited funds",
  "Active Groth16 proving keys use a local development trusted setup",
  "Mainnet security review and production wallet/service validation are incomplete"
];
function mainnetReleaseRefusal(chain, binding) {
  if (chain.testnet === true) return null;
  if (isMainnetChainId(chain.id) && binding?.protocol === V2_ETH_PROTOCOL && REVIEWED_MAINNET_RELEASES.some(
    (r) => r.chainId === chain.id && r.protocol === binding.protocol && r.releaseId === binding.releaseId && r.artifactManifestSha256 === binding.artifactManifestSha256 && !!r.reviewEvidence
  ))
    return null;
  return `Mainnet release blocked: ${MAINNET_RELEASE_BLOCKERS.join("; ")}. Native ETH v2 requires an exact independently reviewed release binding. See docs/privacy-pools/mainnet-migration.md.`;
}

// shared/privacy/networks.ts
var network = (n) => Object.freeze(n);
var NETWORKS = Object.freeze([
  network({
    chainId: 46630,
    slug: "robinhood-testnet",
    name: "Robinhood Chain Testnet",
    shortName: "Robinhood Chain Testnet",
    kind: "l2",
    chain: robinhoodTestnet,
    defaultRpcUrl: "https://rpc.testnet.chain.robinhood.com",
    explorer: { url: "https://explorer.testnet.chain.robinhood.com", name: "Robinhood Chain Testnet Explorer" },
    faucet: { url: "https://faucet.testnet.chain.robinhood.com", display: "faucet.testnet.chain.robinhood.com", hint: null },
    walletDocsUrl: "https://docs.robinhood.com/chain/add-network-to-wallet",
    walletHint: null,
    mark: "robinhood",
    aspConfirmations: 1,
    // one hour, so that a deposit can be checked against the exclusion list before it can leave privately
    aspInclusionDelaySeconds: 3600,
    reorgWindow: 20,
    // about 420,000 blocks a day; the public RPC answers eth_getLogs for 100,000 blocks at most ("only 100000 are
    // allowed for this request", measured 2026-11-17), so a cold scan of a month-old pool is ~130 calls, not ~630
    logChunk: 100000n,
    minLogChunk: 500n
  }),
  network({
    chainId: 4663,
    slug: "robinhood-mainnet",
    name: "Robinhood Chain",
    shortName: "Robinhood Chain",
    kind: "l2",
    chain: robinhoodMainnet,
    defaultRpcUrl: robinhoodMainnet.rpcUrls.default.http[0],
    explorer: { url: "https://robinhoodchain.blockscout.com", name: "Robinhood Chain Explorer" },
    faucet: null,
    walletDocsUrl: "https://docs.robinhood.com/chain/add-network-to-wallet/",
    walletHint: "Mainnet migration in preparation; no pool is deployed by this build.",
    mark: "robinhood",
    aspConfirmations: 1,
    aspInclusionDelaySeconds: 3600,
    reorgWindow: 20,
    // Conservative initial scan span; provider limits are not assumed equal to testnet's.
    logChunk: 10000n,
    minLogChunk: 500n
  }),
  network({
    chainId: 1,
    slug: "ethereum-mainnet",
    name: "Ethereum",
    shortName: "Ethereum",
    kind: "l1",
    chain: ethereumMainnet,
    defaultRpcUrl: ethereumMainnet.rpcUrls.default.http[0],
    explorer: { url: "https://etherscan.io", name: "Etherscan" },
    faucet: null,
    walletDocsUrl: "https://ethereum.org/wallets/",
    walletHint: "Mainnet preparation; no native ETH pool is recorded by this build.",
    mark: "monogram",
    aspConfirmations: 12,
    aspInclusionDelaySeconds: 3600,
    reorgWindow: 64,
    logChunk: 1000n,
    minLogChunk: 100n
  }),
  network({
    chainId: 31337,
    slug: "local-a",
    name: "Local chain A",
    shortName: "Local A",
    kind: "local",
    chain: anvil,
    defaultRpcUrl: "http://127.0.0.1:8545",
    explorer: null,
    faucet: null,
    walletDocsUrl: null,
    walletHint: null,
    mark: "monogram",
    aspConfirmations: 1,
    aspInclusionDelaySeconds: 0,
    reorgWindow: 0,
    logChunk: 20000n,
    minLogChunk: 500n
  }),
  network({
    chainId: 31338,
    slug: "local-b",
    name: "Local chain B",
    shortName: "Local B",
    kind: "local",
    chain: anvilB,
    defaultRpcUrl: "http://127.0.0.1:8546",
    explorer: null,
    faucet: null,
    walletDocsUrl: null,
    walletHint: null,
    mark: "monogram",
    aspConfirmations: 1,
    aspInclusionDelaySeconds: 0,
    reorgWindow: 0,
    logChunk: 20000n,
    minLogChunk: 500n
  })
]);
var PUBLIC_NETWORKS = Object.freeze(NETWORKS.filter((n) => n.kind !== "local"));
var DEFAULT_CHAIN_IDS = Object.freeze([46630]);
function networkById(chainId2) {
  return NETWORKS.find((n) => n.chainId === chainId2) ?? null;
}
var ANVIL_DEFAULT_ACCOUNTS = Object.freeze([
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
  "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
  "0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f",
  "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720"
]);
var ANVIL_ACCOUNT_SET = new Set(ANVIL_DEFAULT_ACCOUNTS.map((a) => a.toLowerCase()));
function isAnvilDefaultAccount(address2) {
  return typeof address2 === "string" && ANVIL_ACCOUNT_SET.has(address2.toLowerCase());
}
function poolKey(chainId2, pool) {
  return `${chainId2}:${pool.toLowerCase()}`;
}
var NETWORK_ENV_VARS = ["PRIVACY_RPC_URL", "PRIVACY_POOL_ADDRESS", "PRIVACY_POOL_DEPLOY_BLOCK", "PRIVACY_EXPLORER_URL"];
function reader(read) {
  return (name) => {
    const v = read(name);
    if (typeof v !== "string") return void 0;
    const t2 = v.trim();
    return t2 === "" ? void 0 : t2;
  };
}
function networkEnv(read, name, chainId2, o) {
  const get = reader(read);
  return get(`${name}_${chainId2}`) ?? (o.fallback === "always" || o.mode === "legacy" ? get(name) : void 0);
}
function parseChainId(text, variable) {
  if (!/^\d+$/.test(text)) throw new Error(`${variable}: "${text}" is not a chain id`);
  const id = Number(text);
  if (!networkById(id)) throw new Error(`${variable}: Hylsia is not built for network ${id} (supported: ${SUPPORTED_CHAIN_IDS.join(", ")})`);
  return id;
}
function parseChainIdList(text) {
  const parts = text.split(",").map((p) => p.trim()).filter((p) => p !== "");
  if (parts.length === 0) throw new Error("PRIVACY_CHAIN_IDS lists no network");
  return [...new Set(parts.map((p) => parseChainId(p, "PRIVACY_CHAIN_IDS")))];
}
function urlHost(url) {
  try {
    return new URL(url).host || "(no host)";
  } catch {
    return "(not a URL)";
  }
}
var isHttpUrl = (v) => {
  try {
    const u = new URL(v);
    return (u.protocol === "http:" || u.protocol === "https:") && u.host !== "";
  } catch {
    return false;
  }
};
var isLoopback = (url) => {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === "localhost" || h === "::1" || h === "[::1]" || /^127(\.\d{1,3}){3}$/.test(h);
  } catch {
    return false;
  }
};
function asPoolAddress(v) {
  if (typeof v !== "string" || !isAddress(v) || v.toLowerCase() === zeroAddress) return null;
  return getAddress(v);
}
function asBlockNumber(v) {
  if (typeof v !== "string" || !/^(\d+|0x[0-9a-fA-F]+)$/.test(v.trim())) return null;
  return BigInt(v.trim());
}
function scopeMatches(record, pool, chainId2) {
  try {
    return BigInt(record.scope) === computeScope(pool, chainId2);
  } catch {
    return false;
  }
}
function resolveOne(network2, get, mode, record, protocol) {
  const id = network2.chainId;
  const own = (name) => get(`${name}_${id}`) ?? (mode === "legacy" ? get(name) : void 0);
  const source = (name) => get(`${name}_${id}`) !== void 0 ? `${name}_${id}` : name;
  const problems = [];
  const warnings = [];
  const rpcEnv = own("PRIVACY_RPC_URL");
  const rpcUrl = rpcEnv ?? network2.defaultRpcUrl;
  if (rpcEnv !== void 0 && !isHttpUrl(rpcEnv)) warnings.push(`${source("PRIVACY_RPC_URL")} is not an http(s) URL`);
  if (network2.kind === "local" && !isLoopback(rpcUrl)) {
    warnings.push(`${network2.name}: RPC host ${urlHost(rpcUrl)} is not a loopback address (local networks are anvil chains on this machine)`);
  }
  let explorer = network2.explorer;
  const explorerEnv = own("PRIVACY_EXPLORER_URL");
  if (explorerEnv !== void 0) {
    if (explorerEnv.toLowerCase() === "none") explorer = null;
    else if (isHttpUrl(explorerEnv)) {
      const url = explorerEnv.replace(/\/+$/, "");
      explorer = network2.explorer?.url === url ? network2.explorer : { url, name: urlHost(url) };
    } else warnings.push(`${source("PRIVACY_EXPLORER_URL")} is neither "none" nor an http(s) URL; the default explorer is used`);
  }
  let pool = null;
  let poolSource = "none";
  const poolEnv = own("PRIVACY_POOL_ADDRESS");
  if (poolEnv !== void 0) {
    poolSource = "env";
    pool = asPoolAddress(poolEnv);
    if (!pool) problems.push("invalid_address");
  } else if (record) {
    poolSource = "deployment";
    pool = asPoolAddress(record.pool);
    if (!pool) problems.push("invalid_address");
  }
  const recordInUse = !!record && !!pool && typeof record.pool === "string" && record.pool.toLowerCase() === pool.toLowerCase();
  if (record && pool && !recordInUse) {
    warnings.push(`${source("PRIVACY_POOL_ADDRESS")} names another pool than the deployment record for ${network2.name}; the record is not used`);
  }
  let deployBlock = null;
  let deployBlockSource = "none";
  const blockEnv = own("PRIVACY_POOL_DEPLOY_BLOCK");
  let envBlock = blockEnv !== void 0 ? asBlockNumber(blockEnv) : null;
  if (blockEnv !== void 0 && envBlock === null) warnings.push(`${source("PRIVACY_POOL_DEPLOY_BLOCK")} is not a block number; it is ignored`);
  if (envBlock === 0n && network2.kind !== "local" && !isLoopback(rpcUrl)) {
    warnings.push(`${source("PRIVACY_POOL_DEPLOY_BLOCK")} is 0 on ${network2.name}; a public pool is never scanned from genesis, so it is ignored`);
    envBlock = null;
  }
  let recordBlock = recordInUse ? asBlockNumber(record.deployBlock) : null;
  if (recordBlock === 0n && network2.kind !== "local") {
    warnings.push(`the deployment record for ${network2.name} gives deploy block 0; it is ignored`);
    recordBlock = null;
  }
  if (pool) {
    if (envBlock !== null) {
      deployBlock = envBlock;
      deployBlockSource = "env";
    } else if (recordBlock !== null) {
      deployBlock = recordBlock;
      deployBlockSource = "deployment";
    } else if (network2.kind === "local") {
      deployBlock = 0n;
      deployBlockSource = "local";
    } else {
      problems.push("missing_deploy_block");
    }
  } else if (blockEnv !== void 0 && poolSource === "none") {
    warnings.push(`${source("PRIVACY_POOL_DEPLOY_BLOCK")} is set, but ${network2.name} has no pool`);
  }
  if (recordInUse) {
    if (network2.kind !== "local" && [record.deployer, record.owner, record.aspPostman].some(isAnvilDefaultAccount)) {
      problems.push("anvil_account_record");
    }
    if (!scopeMatches(record, pool, id)) problems.push("scope_mismatch_record");
    if ((record.protocol ?? PROTOCOL_VERSION) !== protocol) {
      problems.push("protocol_mismatch_record");
      warnings.push(`${network2.name}: deployment protocol ${record.protocol} does not match this runtime's ${protocol}`);
    }
  }
  if (pool && protocol === V2_PROTOCOL && (network2.kind !== "local" || !isLoopback(rpcUrl))) {
    problems.push("candidate_protocol_public");
    warnings.push("The v2 development protocol is available on local loopback chains only");
  }
  if (pool && protocol === V2_ETH_PROTOCOL && (!recordInUse || !/^[0-9a-f]{64}$/.test(record?.releaseId ?? "") || !/^[0-9a-f]{64}$/.test(record?.artifactManifestSha256 ?? "") || !/^[0-9a-f]{64}$/.test(record?.vkeySha256?.withdraw ?? "") || !/^[0-9a-f]{64}$/.test(record?.vkeySha256?.commitment ?? ""))) {
    problems.push("missing_release_binding");
    warnings.push("Native ETH v2 requires a recorded release, manifest digest and both verification-key pins");
  }
  if (pool && mainnetReleaseRefusal(network2.chain, { protocol, ...recordInUse ? { releaseId: record?.releaseId, artifactManifestSha256: record?.artifactManifestSha256 } : {} })) {
    problems.push("mainnet_release_blocked");
    warnings.push(mainnetReleaseRefusal(network2.chain, { protocol, ...recordInUse ? { releaseId: record?.releaseId, artifactManifestSha256: record?.artifactManifestSha256 } : {} }));
  }
  return {
    protocol,
    network: network2,
    rpcUrl,
    rpcSource: rpcEnv !== void 0 ? "env" : "default",
    explorer,
    pool,
    poolSource,
    deployBlock,
    deployBlockSource,
    problems,
    warnings
  };
}
function resolveNetworks(read, deployments) {
  const get = reader(read);
  const protocol = readPrivacyProtocol(get("PRIVACY_PROTOCOL"));
  const warnings = [];
  const list = get("PRIVACY_CHAIN_IDS");
  const single = get("PRIVACY_CHAIN_ID");
  let mode;
  let ids;
  if (list !== void 0) {
    mode = "multi";
    ids = parseChainIdList(list);
    if (single !== void 0) warnings.push("PRIVACY_CHAIN_ID is ignored because PRIVACY_CHAIN_IDS is set");
  } else if (single !== void 0) {
    mode = "legacy";
    ids = [parseChainId(single, "PRIVACY_CHAIN_ID")];
  } else {
    mode = "multi";
    ids = DEFAULT_CHAIN_IDS;
  }
  const served = NETWORKS.filter((n) => ids.includes(n.chainId));
  if (mode === "multi") {
    for (const name of NETWORK_ENV_VARS) {
      if (get(name) !== void 0) {
        warnings.push(`${name} has no network suffix and is ignored; set ${served.map((n) => `${name}_${n.chainId}`).join(" or ")}`);
      }
    }
  }
  for (const n of NETWORKS) {
    if (served.includes(n)) continue;
    const set = NETWORK_ENV_VARS.map((name) => `${name}_${n.chainId}`).filter((name) => get(name) !== void 0);
    if (set.length > 0) warnings.push(`${set.join(", ")} ${set.length === 1 ? "is" : "are"} ignored: ${n.name} (${n.chainId}) is not served`);
  }
  const networks = served.map((n) => resolveOne(n, get, mode, deployments[n.chainId], protocol));
  return { protocol, mode, networks, warnings };
}

// server/privacy/asp.ts
import { TRPCError as TRPCError2 } from "@trpc/server";
import {
  AbiDecodingDataSizeTooSmallError,
  AbiDecodingZeroDataError,
  BaseError as BaseError2,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError
} from "viem";

// shared/privacy/abi.ts
import { parseAbi } from "viem";
var PRIVACY_POOL_ABI = parseAbi([
  // ── views ──
  "function SCOPE() view returns (uint256)",
  "function ASSET() view returns (address)",
  "function TREE_DEPTH() view returns (uint32)",
  "function owner() view returns (address)",
  "function aspPostman() view returns (address)",
  "function dead() view returns (bool)",
  "function minDeposit() view returns (uint256)",
  "function nonce() view returns (uint256)",
  "function nextIndex() view returns (uint32)",
  "function getLastRoot() view returns (uint256)",
  "function isKnownRoot(uint256 root) view returns (bool)",
  "function currentASPRoot() view returns (uint256)",
  "function isKnownASPRoot(uint256 root) view returns (bool)",
  // the association-set root ring: slot i of 16, the slot of the newest post, and the ring's size (public getters)
  "function aspRoots(uint256) view returns (uint256)",
  "function currentASPRootIndex() view returns (uint32)",
  "function ASP_ROOT_HISTORY_SIZE() view returns (uint32)",
  "function nullifierHashes(uint256) view returns (bool)",
  "function commitments(uint256) view returns (bool)",
  "function depositors(uint256 label) view returns (address)",
  "function computeContext((address recipient,address relayer,uint256 fee,uint256 deadline) w) view returns (uint256)",
  // ── user actions ──
  "function deposit(uint256 precommitment) payable returns (uint256 commitment)",
  "function withdraw((address recipient,address relayer,uint256 fee,uint256 deadline) w, (uint256[2] pA,uint256[2][2] pB,uint256[2] pC) proof, uint256[6] pubSignals)",
  "function ragequit((uint256[2] pA,uint256[2][2] pB,uint256[2] pC) proof, uint256[4] pubSignals)",
  // ── admin ──
  "function updateASPRoot(uint256 root, string cid)",
  "function windDown()",
  "function setASPPostman(address postman)",
  "function setMinDeposit(uint256 value)",
  "function transferOwnership(address newOwner)",
  // ── events ──
  "event Deposited(address indexed depositor, uint256 commitment, uint256 label, uint256 value, uint256 precommitment, uint32 leafIndex)",
  "event Withdrawn(address indexed recipient, address indexed relayer, uint256 value, uint256 fee, uint256 spentNullifier, uint256 newCommitment, uint32 leafIndex)",
  "event Ragequit(address indexed ragequitter, uint256 commitment, uint256 label, uint256 value)",
  "event LeafInserted(uint32 indexed leafIndex, uint256 leaf, uint256 root)",
  "event ASPRootUpdated(uint256 indexed root, string cid)",
  "event PoolDied()",
  "event ASPPostmanUpdated(address indexed postman)",
  "event MinDepositUpdated(uint256 value)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  // ── errors ──
  "error PoolIsDead()",
  "error InvalidDepositValue()",
  "error InvalidFieldElement()",
  "error UnknownStateRoot()",
  "error UnknownASPRoot()",
  "error NullifierAlreadySpent()",
  "error InvalidProof()",
  "error ContextMismatch()",
  "error InvalidWithdrawal()",
  "error Expired()",
  "error UnknownCommitment()",
  "error NotDepositor()",
  "error TransferFailed()",
  "error Unauthorized()",
  "error Reentrancy()"
]);

// shared/privacy/v2/abi.ts
import { parseAbi as parseAbi2 } from "viem";
var PRIVACY_POOL_V2_ABI = [
  ...PRIVACY_POOL_ABI.filter(
    (item) => !(item.type === "function" && item.name === "deposit") && !(item.type === "event" && item.name === "Deposited")
  ),
  ...parseAbi2([
    "function PROTOCOL_VERSION() view returns (string)",
    "function deposit(uint256 precommitment, uint256 recoveryNonce) payable returns (uint256 commitment)",
    "event Deposited(address indexed depositor, uint256 commitment, uint256 label, uint256 value, uint256 precommitment, uint256 recoveryNonce, uint32 leafIndex)"
  ])
];

// shared/privacy/poseidon.ts
import { poseidon1 } from "poseidon-lite/poseidon1";
import { poseidon2 } from "poseidon-lite/poseidon2";
import { poseidon3 } from "poseidon-lite/poseidon3";
import { poseidon4 } from "poseidon-lite/poseidon4";
var hash2 = (a, b) => poseidon2([a, b]);

// shared/privacy/merkleTree.ts
function computeZeros(depth = TREE_DEPTH, zero = ZERO_VALUE) {
  const zeros = [zero];
  for (let i = 0; i < depth; i++) zeros.push(hash2(zeros[i], zeros[i]));
  return zeros;
}
var MerkleTree = class _MerkleTree {
  depth;
  zeros;
  /** layers[0] = leaves, layers[depth] = [root] */
  layers;
  constructor(depth = TREE_DEPTH, leaves = [], zero = ZERO_VALUE) {
    if (depth < 1 || depth > 32) throw new Error("unsupported depth");
    this.depth = depth;
    this.zeros = computeZeros(depth, zero);
    this.layers = Array.from({ length: depth + 1 }, () => []);
    for (const leaf of leaves) this.insert(leaf);
  }
  get size() {
    return this.layers[0].length;
  }
  get capacity() {
    return 2 ** this.depth;
  }
  get leaves() {
    return this.layers[0];
  }
  get root() {
    return this.layers[this.depth][0] ?? this.zeros[this.depth];
  }
  node(level, index) {
    return this.layers[level][index] ?? this.zeros[level];
  }
  insert(leaf) {
    if (leaf < 0n || leaf >= SNARK_SCALAR_FIELD) throw new Error("leaf out of field");
    if (this.size >= this.capacity) throw new Error("tree is full");
    let index = this.size;
    this.layers[0].push(leaf);
    for (let level = 0; level < this.depth; level++) {
      const parentIndex = index >> 1;
      const left = this.node(level, parentIndex * 2);
      const right = this.node(level, parentIndex * 2 + 1);
      this.layers[level + 1][parentIndex] = hash2(left, right);
      index = parentIndex;
    }
    return this.size - 1;
  }
  indexOf(leaf) {
    return this.layers[0].indexOf(leaf);
  }
  has(leaf) {
    return this.indexOf(leaf) !== -1;
  }
  /**
   * Node (level, index) of the tree made of only the first `size` leaves. Nodes whose leaves all lie
   * below `size` are the same as in this tree, nodes past it are zeros; only the O(depth) nodes that
   * straddle `size` are hashed again.
   */
  nodeAt(level, index, size) {
    const span = 2 ** level;
    const first = index * span;
    if (first >= size) return this.zeros[level];
    if (first + span <= size) return this.node(level, index);
    return hash2(this.nodeAt(level - 1, index * 2, size), this.nodeAt(level - 1, index * 2 + 1, size));
  }
  /** Root this tree had when it held only its first `size` leaves (an earlier snapshot, e.g. an older association-set root). */
  rootAt(size) {
    if (!Number.isInteger(size) || size < 0 || size > this.size) throw new Error("size out of range");
    return size === this.size ? this.root : this.nodeAt(this.depth, 0, size);
  }
  /** Membership proof for leaf `index`, against the root of the first `size` leaves (default: all of them). */
  proof(index, size = this.size) {
    if (!Number.isInteger(size) || size < 0 || size > this.size) throw new Error("size out of range");
    if (index < 0 || index >= size) throw new Error("leaf index out of range");
    const full = size === this.size;
    const siblings = [];
    let idx = index;
    for (let level = 0; level < this.depth; level++) {
      siblings.push(full ? this.node(level, idx ^ 1) : this.nodeAt(level, idx ^ 1, size));
      idx >>= 1;
    }
    return { leaf: this.layers[0][index], index, siblings, root: this.rootAt(size) };
  }
  static verify(proof, depth = TREE_DEPTH) {
    if (proof.siblings.length !== depth) return false;
    let hash = proof.leaf;
    let idx = proof.index;
    for (let level = 0; level < depth; level++) {
      const sibling = proof.siblings[level];
      hash = idx & 1 ? hash2(sibling, hash) : hash2(hash, sibling);
      idx >>= 1;
    }
    return hash === proof.root;
  }
  /** Root the tree had after exactly `count` leaves were inserted (for ASP snapshots). */
  static rootOf(leaves, depth = TREE_DEPTH) {
    return new _MerkleTree(depth, [...leaves]).root;
  }
};

// shared/privacy/notes.ts
import { keccak256 as keccak2563, concat, toBytes as toBytes2 } from "viem";

// shared/privacy/indexer.ts
var POOL_EVENTS = PRIVACY_POOL_ABI.filter((item) => item.type === "event");
var byBlockAndLog = (a, b) => a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;
function isRangeError(err) {
  const msg = String(err?.message ?? err).toLowerCase();
  return /range|limit|too many|exceed|10000|block span|response size/.test(msg);
}
function getChunkLogs(client, pool, fromBlock, toBlock, protocol) {
  const events = isV2Protocol(protocol) ? PRIVACY_POOL_V2_ABI.filter((item) => item.type === "event") : POOL_EVENTS;
  return client.getLogs({ address: pool, events, fromBlock, toBlock, strict: true });
}
function decodeLog(log, protocol) {
  const base = { blockNumber: log.blockNumber, txHash: log.transactionHash, logIndex: log.logIndex };
  switch (log.eventName) {
    case "Deposited": {
      const nonce = "recoveryNonce" in log.args ? log.args.recoveryNonce : void 0;
      if (isV2Protocol(protocol) && (typeof nonce !== "bigint" || nonce <= 0n || nonce >= SNARK_SCALAR_FIELD)) {
        throw new Error("V2 deposit has an invalid recovery nonce");
      }
      return {
        kind: "deposit",
        depositor: log.args.depositor,
        commitment: log.args.commitment,
        label: log.args.label,
        value: log.args.value,
        precommitment: log.args.precommitment,
        ...isV2Protocol(protocol) ? { recoveryNonce: nonce } : {},
        leafIndex: log.args.leafIndex,
        ...base
      };
    }
    case "Withdrawn":
      return {
        kind: "withdraw",
        recipient: log.args.recipient,
        relayer: log.args.relayer,
        value: log.args.value,
        fee: log.args.fee,
        spentNullifier: log.args.spentNullifier,
        newCommitment: log.args.newCommitment,
        leafIndex: log.args.leafIndex,
        ...base
      };
    case "Ragequit":
      return {
        kind: "ragequit",
        ragequitter: log.args.ragequitter,
        commitment: log.args.commitment,
        label: log.args.label,
        value: log.args.value,
        ...base
      };
    case "ASPRootUpdated":
      return { kind: "asproot", root: log.args.root, cid: log.args.cid, ...base };
    default:
      return null;
  }
}
async function fetchPoolEvents(client, pool, fromBlock, toBlock, opts = {}) {
  if (opts.protocol !== void 0) protocolDefinition(opts.protocol);
  const minChunk = opts.minChunkSize ?? 500n;
  let chunk = opts.chunkSize ?? 20000n;
  const parallel = Math.max(1, Math.floor(Number.isFinite(opts.concurrency) ? opts.concurrency : 1));
  const out = [];
  let cursor = fromBlock;
  while (cursor <= toBlock) {
    const spans = [];
    for (let from = cursor; spans.length < parallel && from <= toBlock; ) {
      const to = from + chunk - 1n > toBlock ? toBlock : from + chunk - 1n;
      spans.push({ from, to });
      from = to + 1n;
    }
    const results = await Promise.allSettled(spans.map((s) => getChunkLogs(client, pool, s.from, s.to, opts.protocol)));
    for (let i = 0; i < spans.length; i++) {
      const r = results[i];
      if (r.status === "rejected") {
        if (chunk > minChunk && isRangeError(r.reason)) {
          chunk = chunk / 2n < minChunk ? minChunk : chunk / 2n;
          break;
        }
        throw r.reason;
      }
      const events = [];
      for (const log of r.value) {
        const e = decodeLog(log, opts.protocol);
        if (e) events.push(e);
      }
      out.push(...events);
      opts.onProgress?.(spans[i].from, spans[i].to, events);
      cursor = spans[i].to + 1n;
    }
  }
  out.sort(byBlockAndLog);
  return out;
}
var SCAN_CONCURRENCY = 4;
function mergePoolEvents(cached2, fresh, fromBlock) {
  const out = cached2.filter((e) => e.blockNumber < fromBlock);
  out.push(...fresh);
  return out.sort(byBlockAndLog);
}
function nextScanRange(o) {
  if (o.lastBlock !== null && o.head < o.lastBlock) return null;
  const window = windowBlocks(o.reorgWindow);
  const resume = o.lastBlock === null ? o.deployBlock : o.lastBlock + 1n - window;
  return { from: resume > o.deployBlock ? resume : o.deployBlock, to: o.head };
}
var windowBlocks = (reorgWindow) => BigInt(Math.max(0, Math.floor(Number.isFinite(reorgWindow) ? reorgWindow : 0)));
function headRegression(o) {
  if (o.head >= o.lastBlock) return "keep";
  const window = windowBlocks(o.reorgWindow);
  return window > 0n && o.head + window >= o.lastBlock ? "keep" : "rescan";
}

// shared/privacy/screening.ts
var ASP_POLICY_VERSION = 1;
var MAX_RECIPE_EXCLUSIONS = 500;
var MAX_EXCLUSION_ENTRIES = 1e4;
var MAX_EXCLUSION_NOTE_CHARS = 500;
var MAX_INCLUSION_DELAY_SECONDS = 604800;
var EXCLUSION_REASON_CODES = Object.freeze(["sanctions", "stolen-funds", "fraud", "legal-order", "test"]);
var EXCLUSION_REASONS = Object.freeze({
  sanctions: Object.freeze({ title: "Sanctions", text: "the depositing address is on a public sanctions list." }),
  "stolen-funds": Object.freeze({ title: "Stolen funds", text: "the deposit was reported as coming from stolen funds." }),
  fraud: Object.freeze({ title: "Fraud", text: "the deposit was reported as coming from a scam or fraud." }),
  "legal-order": Object.freeze({ title: "Legal order", text: "a court or regulator ordered the operator to exclude it." }),
  test: Object.freeze({ title: "Test", text: "an exclusion made on the testnet to test screening." })
});
function isExclusionReason(v) {
  return typeof v === "string" && EXCLUSION_REASON_CODES.includes(v);
}
var isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var isUint = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
var byPosition = (a, b) => a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1;
var isBefore = (e, at) => byPosition(e, at) < 0;
var infos = /* @__PURE__ */ new WeakMap();
function infoOf(events) {
  const hit = infos.get(events);
  if (hit && hit.length === events.length) return hit.info;
  const deposits = events.filter((e) => e.kind === "deposit").sort((a, b) => a.leafIndex - b.leafIndex);
  const ordinal = /* @__PURE__ */ new Map();
  deposits.forEach((d, i) => {
    if (!ordinal.has(d.label)) ordinal.set(d.label, i);
  });
  const leaves = /* @__PURE__ */ new Set();
  for (const e of events) if (e.kind === "deposit" || e.kind === "withdraw") leaves.add(e.leafIndex);
  let contiguous = 0;
  while (leaves.has(contiguous)) contiguous++;
  const roots = events.filter((e) => e.kind === "asproot" && e.root !== 0n).sort(byPosition);
  const info = { deposits, ordinal, contiguous, gapFree: leaves.size === contiguous, roots, memo: /* @__PURE__ */ new Map(), minus: /* @__PURE__ */ new Map() };
  infos.set(events, { length: events.length, info });
  return info;
}
function memo(info, key, make) {
  if (info.memo.has(key)) return info.memo.get(key);
  const value = make();
  info.memo.set(key, value);
  return value;
}
function depositsInLeafOrder(events) {
  return infoOf(events).deposits;
}
function depositOf(events, label) {
  const info = infoOf(events);
  const ordinal = info.ordinal.get(label);
  return ordinal === void 0 ? null : { ordinal, deposit: info.deposits[ordinal] };
}
var completeThrough = (info, n) => n <= info.deposits.length && (n === 0 || info.deposits[n - 1].leafIndex < info.contiguous);
var zerosByDepth = /* @__PURE__ */ new Map();
function zerosOf(depth) {
  let z2 = zerosByDepth.get(depth);
  if (!z2) {
    z2 = Object.freeze(computeZeros(depth));
    zerosByDepth.set(depth, z2);
  }
  return z2;
}
function checkMembers(labels, depth) {
  if (!Number.isInteger(depth) || depth < 1 || depth > 32) throw new RangeError("unsupported depth");
  if (labels.length > 2 ** depth) throw new RangeError("too many members for the tree");
  for (const l of labels) if (typeof l !== "bigint" || l < 0n || l >= SNARK_SCALAR_FIELD) throw new RangeError("a member is out of the field");
}
function setRoot(labels, depth = TREE_DEPTH) {
  checkMembers(labels, depth);
  const zeros = zerosOf(depth);
  let level = labels;
  for (let d = 0; d < depth; d++) {
    if (level.length === 0) return zeros[depth];
    const next = new Array(Math.ceil(level.length / 2));
    for (let i = 0; i < level.length; i += 2) next[i >> 1] = hash2(level[i], i + 1 < level.length ? level[i + 1] : zeros[d]);
    level = next;
  }
  return level.length === 0 ? zeros[depth] : level[0];
}
function setLayers(labels, depth) {
  checkMembers(labels, depth);
  const zeros = zerosOf(depth);
  const layers = [[...labels]];
  for (let d = 0; d < depth; d++) {
    const level = layers[d];
    const next = new Array(Math.ceil(level.length / 2));
    for (let i = 0; i < level.length; i += 2) next[i >> 1] = hash2(level[i], i + 1 < level.length ? level[i + 1] : zeros[d]);
    layers.push(next);
  }
  return layers;
}
function prefixRootOf(layers, m, depth) {
  const zeros = zerosOf(depth);
  if (m === 0) return zeros[depth];
  let idx = m - 1;
  let node = layers[0][idx];
  for (let d = 0; d < depth; d++) {
    node = idx & 1 ? hash2(layers[d][idx - 1], node) : hash2(node, zeros[d]);
    idx >>= 1;
  }
  return node;
}
var MINUS_CACHE = 8;
function minusLayers(info, x, depth) {
  const key = `${depth}|${[...x].sort((a, b) => a - b).join(",")}`;
  const hit = info.minus.get(key);
  if (hit) {
    info.minus.delete(key);
    info.minus.set(key, hit);
    return hit;
  }
  const labels = info.deposits.filter((d) => !x.has(d.leafIndex)).map((d) => d.label);
  const value = { labels, layers: setLayers(labels, depth) };
  info.minus.set(key, value);
  if (info.minus.size > MINUS_CACHE) info.minus.delete(info.minus.keys().next().value);
  return value;
}
var SCREENED_PREFIX = "hylsia-asp:";
var NUM = "(?:0|[1-9][0-9]*)";
var RECIPE_V1 = new RegExp(`^hylsia-asp:v1;n=(${NUM});x=(${NUM}(?:,${NUM})*)?;asOf=(${NUM});t=(${NUM});delay=(${NUM});conf=(${NUM})$`);
var RECIPE_V0 = new RegExp(`^open-testnet-policy:count=(${NUM}):head=(${NUM})$`);
var SCREENED_VERSION = /^hylsia-asp:v([1-9][0-9]{0,8})(?:;|$)/;
var MAX_CID_CHARS = 16384;
var safeInt = (s) => {
  const v = Number(s);
  return Number.isSafeInteger(v) ? v : null;
};
var isScreenedCid = (cid) => typeof cid === "string" && cid.startsWith(SCREENED_PREFIX);
function cidPolicyVersion(cid) {
  if (typeof cid !== "string") return null;
  const m = SCREENED_VERSION.exec(cid);
  if (m) return Number(m[1]);
  return RECIPE_V0.test(cid) ? 0 : null;
}
function highestPolicyVersion(events) {
  return infoOf(events).roots.reduce((max, e) => Math.max(max, cidPolicyVersion(e.cid) ?? 0), 0);
}
function formatRecipe(r) {
  const bad = (what) => new RangeError(`formatRecipe: ${what}`);
  if (r.version !== 1) throw bad("version must be 1");
  if (!isUint(r.considered)) throw bad("n must be a whole number");
  if (!Array.isArray(r.excludedLeaves)) throw bad("x must be a list of leaves");
  if (r.excludedLeaves.length > MAX_RECIPE_EXCLUSIONS) throw bad(`x holds more than ${MAX_RECIPE_EXCLUSIONS} leaves`);
  if (r.excludedLeaves.length > r.considered) throw bad("x holds more leaves than n considers");
  r.excludedLeaves.forEach((leaf, k) => {
    if (!isUint(leaf)) throw bad("every leaf in x must be a whole number");
    if (k > 0 && leaf <= r.excludedLeaves[k - 1]) throw bad("x must be strictly ascending");
  });
  if (typeof r.asOfBlock !== "bigint" || r.asOfBlock < 0n) throw bad("asOf must be a block number");
  if (!isUint(r.asOfTime)) throw bad("t must be a whole number of seconds");
  if (!isUint(r.delaySeconds)) throw bad("delay must be a whole number of seconds");
  if (!isUint(r.confirmations)) throw bad("conf must be a whole number");
  return `hylsia-asp:v1;n=${r.considered};x=${r.excludedLeaves.join(",")};asOf=${r.asOfBlock};t=${r.asOfTime};delay=${r.delaySeconds};conf=${r.confirmations}`;
}
function parseRecipe(cid) {
  if (typeof cid !== "string" || cid.length > MAX_CID_CHARS) return null;
  const v1 = RECIPE_V1.exec(cid);
  if (v1) {
    const considered = safeInt(v1[1]);
    const t2 = safeInt(v1[4]);
    const delay = safeInt(v1[5]);
    const conf = safeInt(v1[6]);
    if (considered === null || t2 === null || delay === null || conf === null) return null;
    const x = [];
    if (v1[2] !== void 0) {
      for (const part of v1[2].split(",")) {
        const leaf = safeInt(part);
        if (leaf === null || x.length > 0 && leaf <= x[x.length - 1]) return null;
        x.push(leaf);
      }
    }
    if (x.length > MAX_RECIPE_EXCLUSIONS || x.length > considered) return null;
    return { version: 1, considered, excludedLeaves: x, asOfBlock: BigInt(v1[3]), asOfTime: t2, delaySeconds: delay, confirmations: conf };
  }
  const v0 = RECIPE_V0.exec(cid);
  if (v0) {
    const count = safeInt(v0[1]);
    if (count === null) return null;
    return { version: 0, considered: count, excludedLeaves: [], asOfBlock: BigInt(v0[2]), asOfTime: null, delaySeconds: null, confirmations: null };
  }
  return null;
}
var recipeMemberCount = (r) => r.considered - r.excludedLeaves.length;
function considerationFloor(events, at, depth = TREE_DEPTH) {
  const info = infoOf(events);
  return floorOf(info, at ? info.roots.filter((e) => isBefore(e, at)) : info.roots, depth);
}
function floorOf(info, history, depth) {
  const claims = [];
  for (const e of history) {
    const r = isScreenedCid(e.cid) ? parseRecipe(e.cid) : null;
    if (r && r.version === 1 && r.considered > 0) claims.push({ e, r });
  }
  claims.sort((a, b) => b.r.considered - a.r.considered);
  for (const { e, r } of claims) if (recipeList(info, e.root, e.cid, r, depth).status === "verified") return r.considered;
  return 0;
}
function recipeList(info, root, cid, r, depth) {
  return memo(info, `list|${root}|${depth}|${cid}`, () => {
    if (!completeThrough(info, r.considered)) return { status: "unknown", problem: "missing_deposits" };
    const members = recipeMembers(info, r, depth);
    if (members === null) return { status: "mismatch", problem: "exclusions" };
    return members.root === root ? { status: "verified", labels: members.labels } : { status: "mismatch", problem: "root" };
  });
}
function recipeMembers(info, r, depth) {
  if (!isUint(r.considered) || r.considered > info.deposits.length) return null;
  const x = new Set(r.excludedLeaves);
  let hit = 0;
  for (let i = 0; i < r.considered; i++) if (x.has(info.deposits[i].leafIndex)) hit++;
  if (hit !== x.size) return null;
  const all = minusLayers(info, x, depth);
  const m = r.considered - x.size;
  return { labels: all.labels.slice(0, m), root: prefixRootOf(all.layers, m, depth) };
}
function readmittedLeaves(current, snapshot) {
  if (!current) return [];
  const still = new Set(snapshot.excludedLeaves);
  return current.excludedLeaves.filter((leaf) => !still.has(leaf));
}
var EXCLUSIONS_FORMAT = "hylsia-asp-exclusions";
var FILE_FIELDS = ["format", "version", "comment", "entries"];
var ENTRY_FIELDS = ["label", "depositor", "reason", "chainId", "note", "added"];
function jsonWhere(err, text) {
  const message = err instanceof Error ? err.message : "";
  const lc = /line (\d+) column (\d+)/.exec(message);
  if (lc) return ` (line ${lc[1]}, column ${lc[2]})`;
  const pos = /position (\d+)/.exec(message);
  if (!pos) return "";
  const p = Math.min(Number(pos[1]), text.length);
  const before = text.slice(0, p);
  return ` (line ${before.split("\n").length}, column ${p - before.lastIndexOf("\n")})`;
}
function fieldElement(v) {
  if (typeof v !== "string" || v.length > 80 || !/^(?:[0-9]+|0x[0-9a-fA-F]+)$/.test(v)) return null;
  const n = BigInt(v);
  return n > 0n && n < SNARK_SCALAR_FIELD ? n : null;
}
function isDate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t2 = new Date(Date.UTC(y, m - 1, d));
  return t2.getUTCFullYear() === y && t2.getUTCMonth() === m - 1 && t2.getUTCDate() === d;
}
function parseExclusionFile(text, o = {}) {
  const fail = (error) => ({ ok: false, error });
  if (typeof text !== "string") return fail("the exclusion list is not text");
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return fail(`the exclusion list is not valid JSON${jsonWhere(err, text)}`);
  }
  if (!isRecord(doc)) return fail("the exclusion list must be a JSON object");
  if (Object.keys(doc).some((k) => !FILE_FIELDS.includes(k))) {
    return fail(`the exclusion list has a top-level field that is not allowed (allowed: ${FILE_FIELDS.join(", ")})`);
  }
  if (doc.format !== EXCLUSIONS_FORMAT) return fail(`field "format" must be "${EXCLUSIONS_FORMAT}"`);
  if (doc.version !== 1) return fail('field "version" must be 1');
  if (doc.comment !== void 0 && typeof doc.comment !== "string") return fail('field "comment" must be text');
  if (!Array.isArray(doc.entries)) return fail('field "entries" must be a list');
  if (doc.entries.length > MAX_EXCLUSION_ENTRIES) return fail(`field "entries" holds more than ${MAX_EXCLUSION_ENTRIES.toLocaleString("en-US")} entries`);
  const entries = [];
  const warnings = [];
  const seen = /* @__PURE__ */ new Map();
  for (let i = 0; i < doc.entries.length; i++) {
    const n = i + 1;
    const raw = doc.entries[i];
    const field = (name, rule) => fail(`entry #${n}: field "${name}" ${rule}`);
    if (!isRecord(raw)) return fail(`entry #${n} must be an object`);
    if (Object.keys(raw).some((k) => !ENTRY_FIELDS.includes(k))) {
      return fail(`entry #${n} has a field that is not allowed (allowed: ${ENTRY_FIELDS.join(", ")})`);
    }
    const hasLabel = raw.label !== void 0;
    if (hasLabel === (raw.depositor !== void 0)) return fail(`entry #${n} must name exactly one of "label" or "depositor"`);
    let label = null;
    let depositor = null;
    if (hasLabel) {
      label = fieldElement(raw.label);
      if (label === null) return field("label", "must be text holding a decimal or 0x number above 0 and below the field size");
    } else {
      if (typeof raw.depositor !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(raw.depositor)) return field("depositor", "must be an address: 0x and 40 hex digits");
      depositor = raw.depositor.toLowerCase();
    }
    if (!isExclusionReason(raw.reason)) return field("reason", `must be one of ${EXCLUSION_REASON_CODES.join(", ")}`);
    let chainId2 = null;
    if (raw.chainId !== void 0) {
      if (typeof raw.chainId !== "number" || !Number.isSafeInteger(raw.chainId) || raw.chainId <= 0) return field("chainId", "must be a whole number above 0");
      chainId2 = raw.chainId;
    }
    if (raw.note !== void 0) {
      if (o.notes === "reject") return field("note", "is not allowed in an inline list (keep notes in the file only)");
      if (typeof raw.note !== "string" || raw.note.length > MAX_EXCLUSION_NOTE_CHARS) return field("note", `must be text of at most ${MAX_EXCLUSION_NOTE_CHARS} characters`);
    }
    if (raw.added !== void 0 && !isDate(raw.added)) return field("added", "must be a date written YYYY-MM-DD");
    const key = `${chainId2 ?? "*"}|${label !== null ? `l${label}` : `d${depositor}`}`;
    const first = seen.get(key);
    if (first !== void 0) warnings.push(`entry #${n} repeats entry #${first}; the first one's reason counts`);
    else seen.set(key, n);
    entries.push({ chainId: chainId2, label, depositor, reason: raw.reason });
  }
  return { ok: true, entries, warnings };
}
function exclusionMatcher(entries, chainId2) {
  const byLabel = /* @__PURE__ */ new Map();
  const byDepositor = /* @__PURE__ */ new Map();
  entries.forEach((e, at) => {
    if (e.chainId !== null && e.chainId !== chainId2) return;
    if (e.label !== null && !byLabel.has(e.label)) byLabel.set(e.label, { at, reason: e.reason });
    if (e.depositor !== null) {
      const key = e.depositor.toLowerCase();
      if (!byDepositor.has(key)) byDepositor.set(key, { at, reason: e.reason });
    }
  });
  return (d) => {
    const a = byLabel.get(d.label);
    const b = typeof d.depositor === "string" ? byDepositor.get(d.depositor.toLowerCase()) : void 0;
    const hit = a && b ? a.at < b.at ? a : b : a ?? b;
    return hit ? hit.reason : null;
  };
}
function screeningArgs(input) {
  if (!isUint(input.confirmations)) throw new RangeError("screening: confirmations must be a whole number");
  if (!isUint(input.delaySeconds)) throw new RangeError("screening: the delay must be a whole number of seconds");
  if (!isUint(input.previousConsidered)) throw new RangeError("screening: previousConsidered must be a whole number");
  if (!input.head || typeof input.head.block !== "bigint" || input.head.block < 0n || !isUint(input.head.time)) {
    throw new RangeError("screening: the head needs a block number and a block time");
  }
}
function blocksNeedingTime(input) {
  screeningArgs(input);
  if (input.delaySeconds === 0) return [];
  const { deposits } = infoOf(input.deposits);
  const cutoff = input.head.block - BigInt(input.confirmations) + 1n;
  const out = [];
  for (let i = Math.min(input.previousConsidered, deposits.length); i < deposits.length; i++) {
    const block = deposits[i].blockNumber;
    if (block > cutoff) break;
    if (out[out.length - 1] !== block) out.push(block);
  }
  return out;
}
function screenDeposits(input) {
  screeningArgs(input);
  const { deposits } = infoOf(input.deposits);
  const count = deposits.length;
  const cutoff = input.head.block - BigInt(input.confirmations) + 1n;
  let n = Math.min(input.previousConsidered, count);
  while (n < count) {
    const d = deposits[n];
    if (d.blockNumber > cutoff) break;
    if (input.delaySeconds > 0) {
      const t2 = input.blockTime(d.blockNumber);
      if (typeof t2 !== "number" || !Number.isFinite(t2)) throw new Error(`screenDeposits: no block time for block ${d.blockNumber}`);
      if (t2 + input.delaySeconds > input.head.time) break;
    }
    n++;
  }
  const excluded = [];
  const x = [];
  const keep = input.keepExcluded ?? null;
  for (let i = 0; i < count; i++) {
    const d = deposits[i];
    const reason = input.exclude(d);
    if (reason === null) {
      if (i < n && keep?.has(d.leafIndex)) x.push(d.leafIndex);
      continue;
    }
    if (!isExclusionReason(reason)) throw new RangeError("screenDeposits: the exclusion rule gave an unknown reason");
    excluded.push({ leafIndex: d.leafIndex, label: d.label, reason, considered: i < n });
    if (i < n) x.push(d.leafIndex);
  }
  const xs = new Set(x);
  const labels = deposits.slice(0, n).filter((d) => !xs.has(d.leafIndex)).map((d) => d.label);
  const recipe = {
    version: 1,
    considered: n,
    excludedLeaves: x,
    asOfBlock: input.head.block,
    asOfTime: input.head.time,
    delaySeconds: input.delaySeconds,
    confirmations: input.confirmations
  };
  return {
    recipe,
    cid: x.length <= MAX_RECIPE_EXCLUSIONS ? formatRecipe(recipe) : null,
    labels,
    root: setRoot(labels),
    memberCount: labels.length,
    excluded,
    waiting: count - n - excluded.filter((e) => !e.considered).length,
    deposits: count
  };
}
var Verified = class {
  root;
  cid;
  recipe;
  labels;
  memberCount;
  depth;
  index = null;
  layers = null;
  merkle = null;
  constructor(root, cid, recipe, labels, depth) {
    this.root = root;
    this.cid = cid;
    this.recipe = recipe;
    this.labels = labels;
    this.memberCount = labels.length;
    this.depth = depth;
  }
  indexOf(label) {
    if (!this.index) {
      this.index = /* @__PURE__ */ new Map();
      this.labels.forEach((l, i) => {
        if (!this.index.has(l)) this.index.set(l, i);
      });
    }
    return this.index.get(label) ?? -1;
  }
  has(label) {
    return this.indexOf(label) !== -1;
  }
  proof(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.labels.length) throw new RangeError("leaf index out of range");
    this.layers ??= setLayers(this.labels, this.depth);
    const zeros = zerosOf(this.depth);
    const siblings = [];
    let idx = index;
    for (let level = 0; level < this.depth; level++) {
      siblings.push(this.layers[level][idx ^ 1] ?? zeros[level]);
      idx >>= 1;
    }
    return { leaf: this.labels[index], index, siblings, root: this.layers[this.depth][0] ?? zeros[this.depth] };
  }
  get tree() {
    this.merkle ??= new MerkleTree(this.depth, [...this.labels]);
    return this.merkle;
  }
};
function prefixSize(info, root, depth) {
  const sizes = memo(info, `prefix|${depth}`, () => {
    const map = /* @__PURE__ */ new Map();
    const tree = new MerkleTree(depth);
    for (const d of info.deposits) {
      tree.insert(d.label);
      if (!map.has(tree.root)) map.set(tree.root, tree.size);
    }
    return map;
  });
  return sizes.get(root);
}
function checkUncached(root, cid, info, at, depth) {
  const history = at ? info.roots.filter((e) => isBefore(e, at)) : info.roots;
  const verified = (recipe, labels) => ({ status: "verified", set: new Verified(root, cid, recipe, labels, depth) });
  if (root === 0n) return { status: "unknown", problem: "no_record", recipe: null };
  if (isScreenedCid(cid)) {
    const m = SCREENED_VERSION.exec(cid);
    if (!m) return { status: "mismatch", problem: "malformed", recipe: null };
    const version = Number(m[1]);
    if (version > ASP_POLICY_VERSION) return { status: "outdated", problem: "outdated", version };
    const r = parseRecipe(cid);
    if (!r || r.version !== 1) return { status: "mismatch", problem: "malformed", recipe: null };
    const list = recipeList(info, root, cid, r, depth);
    if (list.status !== "verified") return { ...list, recipe: r };
    if (r.considered < Math.min(floorOf(info, history, depth), info.deposits.length)) return { status: "mismatch", problem: "lowered", recipe: r };
    return verified(r, list.labels);
  }
  if (history.some((e) => isScreenedCid(e.cid))) {
    return cid === null ? { status: "unknown", problem: "no_record", recipe: null } : { status: "mismatch", problem: "version_backwards", recipe: null };
  }
  const r0 = cid !== null ? parseRecipe(cid) : null;
  if (r0 && r0.considered > 0 && completeThrough(info, r0.considered)) {
    const labels = info.deposits.slice(0, r0.considered).map((d) => d.label);
    if (setRoot(labels, depth) === root) return verified(r0, labels);
  }
  const k = prefixSize(info, root, depth);
  if (k !== void 0) {
    const recipe = { version: 0, considered: k, excludedLeaves: [], asOfBlock: r0?.asOfBlock ?? null, asOfTime: null, delaySeconds: null, confirmations: null };
    return verified(recipe, info.deposits.slice(0, k).map((d) => d.label));
  }
  if (cid === null) return { status: "unknown", problem: "no_record", recipe: null };
  return at && info.gapFree ? { status: "mismatch", problem: "root", recipe: r0 } : { status: "unknown", problem: "missing_deposits", recipe: r0 };
}
function checkRoot(i) {
  const depth = i.depth ?? TREE_DEPTH;
  const at = i.at ?? null;
  const info = infoOf(i.events);
  const cid = typeof i.cid === "string" ? i.cid : null;
  return memo(
    info,
    `check|${i.root}|${at ? `${at.blockNumber}:${at.logIndex}` : "-"}|${depth}|${cid === null ? "\0" : cid}`,
    () => checkUncached(i.root, cid, info, at, depth)
  );
}
function verifySet(root, cid, events, depth) {
  const c = checkRoot({ root, cid, events, depth });
  return c.status === "verified" ? c.set : null;
}
function rootRecordOf(events, root) {
  const { roots } = infoOf(events);
  for (let k = roots.length - 1; k >= 0; k--) {
    const e = roots[k];
    if (e.root === root) return { root, cid: e.cid, at: { blockNumber: e.blockNumber, logIndex: e.logIndex } };
  }
  return null;
}
function checkCurrentRoot(i) {
  if (i.currentRoot === 0n) return null;
  const own = rootRecordOf(i.events, i.currentRoot);
  if (own) return { check: checkRoot({ root: i.currentRoot, cid: own.cid, events: i.events, at: own.at, depth: i.depth }), source: "event", at: own.at };
  const rec = i.record && i.record.root === i.currentRoot ? i.record : null;
  const cid = rec && typeof rec.cid === "string" ? rec.cid : null;
  return { check: checkRoot({ root: i.currentRoot, cid, events: i.events, at: null, depth: i.depth }), source: rec ? "record" : "none", at: null };
}
function newlyListedLeaves(current, snapshot) {
  if (!snapshot || !current || current.status !== "verified") return [];
  const listed = new Set(current.set.recipe.excludedLeaves);
  return snapshot.excludedLeaves.filter((leaf) => !listed.has(leaf));
}
function rootDueFor(i) {
  if (i.currentRoot === 0n) return i.snapshot.memberCount > 0 || (i.snapshot.recipe?.excludedLeaves.length ?? 0) > 0;
  if (i.snapshot.root !== i.currentRoot || i.current?.status === "mismatch") return true;
  return newlyListedLeaves(i.current, i.snapshot.recipe).length > 0;
}
var SHRINK_ALARM_ROOTS = ASP_ROOT_HISTORY_SIZE;
var SHRINK_ALARM_SCAN = 4 * SHRINK_ALARM_ROOTS;

// server/privacy/chain.ts
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount as privateKeyToAccount2 } from "viem/accounts";

// server/privacy/config.ts
import fs2 from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TRPCError } from "@trpc/server";
import { privateKeyToAccount } from "viem/accounts";

// shared/privacy/deployments.ts
var DEPLOYMENTS = {
  46630: {
    chainId: 46630,
    pool: "0xbBc4362133e4d50157206Cc907909d0C0211913f",
    withdrawVerifier: "0x7594c1923973Ee026040e935DF93244A41de7977",
    commitmentVerifier: "0xfB1BFc18294a884B040f3e4B633A08f1D577ffE2",
    owner: "0x2629cCae35E1e6F5958ed618a75DE28d08763bC4",
    aspPostman: "0x4D62c8c148a847788C385b436ed760BDe5b1b80C",
    scope: "6737352968100009709496304954471303060616745443515941364061740903211996795929",
    minDepositWei: "0",
    deployBlock: "154136323",
    protocol: "hylsia-pp-v1",
    deployer: "0x2629cCae35E1e6F5958ed618a75DE28d08763bC4",
    libraries: [
      { name: "PoseidonT3", address: "0xfF4044510b61A631aB192cd4F60D45731c0C12f3" },
      { name: "PoseidonT4", address: "0xa553216D49F01C26E2a8Ed86860D4c789C194b33" }
    ],
    txHashes: {
      PoseidonT3: "0x801a0a5fefc23701216df5bfd80768d9c74e13be72dfc2fdb9861f092a3a5c0f",
      PoseidonT4: "0x4bcc5ca8aaf5696aae0a06919fccabca29d2ffc96a33c7fb0566151b3eb41c32",
      WithdrawVerifier: "0x0ced1b4fe3c1369356b91b5b5b096d61c52cbc83d53bcc393d415a66d23cccd4",
      CommitmentVerifier: "0xc138fc01a667c1de4952dab283f90a0711e6462072086cd10b2a97e05b2608a8",
      PrivacyPool: "0x3ee049e43af2f4e13f6cbff628a81a8dc623a88badda1497febc47677cea92f0"
    },
    poolReceiptBlock: "154136462",
    vkeySha256: {
      withdraw: "1dc4aa6699fd8c403c9322bda1b63c01ed87c28c73dd993f3f188d497936d2a1",
      commitment: "139d663703e1607edee64c2331550b890396e9f7afb809bde18ef9826dbb2db1"
    },
    verifierCodeHash: {
      withdraw: "0x3bdf7a4e9b6a8bd47e8cc30763620df25c55403c9a02a933ba63cdef5a25a798",
      commitment: "0x09c640bbc3f61d947a4458483371c5e0a9df29ed80fc0824c27e43970fbe122b"
    }
  }
};

// contracts/deployments/1.json
var __default = {
  chainId: 1,
  protocol: "hylsia-pp-v2-eth",
  pool: "0xAC84cFAC0a7C55760197b0681576CD27837cCfea",
  withdrawVerifier: "0x3482C211042894457b48F1870Fc83731cd085B13",
  commitmentVerifier: "0x0170A74750475BF45DEd1b1873d63Ca583EE42Ea",
  owner: "0x5636835544d9D49f43dfDA695a51dcB398dDE6cF",
  aspPostman: "0x5636835544d9D49f43dfDA695a51dcB398dDE6cF",
  deployer: "0x5636835544d9D49f43dfDA695a51dcB398dDE6cF",
  scope: "19862275661092037214311706317823814540136185778625368978903287973627071173463",
  minDepositWei: "0",
  deployBlock: "26465235",
  releaseId: "23f30ccaa7c30be08724c67b226d37d51b6d4a0310866807f4c73637e54031ef",
  artifactManifestSha256: "546ae336183d51bf580d7118b5a945581d6d2bdbb988b12d305e338350e55c32",
  vkeySha256: {
    withdraw: "62ae70c88b314b5080db766eb827fabdfa55851d9c705dbaea46073b643a7501",
    commitment: "215abe623499ff1c7a3cafaa6dd3799d383449bd55f1b88ddd665fce6c8b7e7c"
  },
  verifierCodeHash: {
    withdraw: "0x0026527e326a6236644221ee8af852b9c5ac4c19ef4aa911dff67e9afa2d449c",
    commitment: "0x4d33e76df5bcab30f66c5b7250b7c29a6776bfa44c9a2b9d4c6baf2a260984a7"
  },
  trustModel: "single-operator",
  independentReview: false,
  operatorAuthorizationSha256: "ecd6d65007865ec76ece0137cf01c804745e067a13b0f33ef7ad07b015a3d96c",
  operatorAuthorizationEvidence: "docs/security/ethereum-mainnet-single-operator-release.json",
  libraries: [
    {
      name: "PoseidonT3",
      address: "0xCd9C4359AEc7C1C778Dea7E95C22B2C509Eea085"
    },
    {
      name: "PoseidonT4",
      address: "0x250E9cb1ddbcca6c2ADB24f34a351daBA7E0DCeB"
    }
  ],
  txHashes: {
    PoseidonT3: "0x5d9d5660cfb5044a54d307bc223c2c7c2c2477a887b154c0c55c93f7a319a008",
    PoseidonT4: "0x3aae98edcdfeabbd6b1394555f725dae225739e355ea040d6f5942d859290543",
    WithdrawVerifierV2ETH: "0x80455e20ca3c0eba153344f28e9f30628be56ab1cd21ac4ef52ee1f1ceaf9c4a",
    CommitmentVerifierV2ETH: "0xf4783439d13944e802dc7ea09d6c631fd69ba005c44fa5b407e58294e4bf906c",
    PrivacyPoolV2ETH: "0xd22547f4a1c6c89eb3bfd938bcbedf76117e2b94a7f791eae4e91b5202eabc32"
  },
  poolReceiptBlock: "26465235"
};

// shared/privacy/applicationProfiles.ts
function mainnetApplicationEnabled(value, production) {
  const setting = value?.trim();
  return setting === "true" || !setting && production;
}
var ETHEREUM_APPLICATION_RELEASE = Object.freeze(
  __default
);
function isAuthorizedApplicationRelease(record) {
  return record.chainId === 1 && record.protocol === V2_ETH_PROTOCOL && record.pool.toLowerCase() === "0xac84cfac0a7c55760197b0681576cd27837ccfea" && record.deployBlock === "26465235" && record.releaseId === "23f30ccaa7c30be08724c67b226d37d51b6d4a0310866807f4c73637e54031ef" && record.artifactManifestSha256 === "546ae336183d51bf580d7118b5a945581d6d2bdbb988b12d305e338350e55c32" && record.vkeySha256?.withdraw === "62ae70c88b314b5080db766eb827fabdfa55851d9c705dbaea46073b643a7501" && record.vkeySha256?.commitment === "215abe623499ff1c7a3cafaa6dd3799d383449bd55f1b88ddd665fce6c8b7e7c";
}
var APPLICATION_DEPLOYMENTS = Object.freeze({
  ...DEPLOYMENTS,
  1: ETHEREUM_APPLICATION_RELEASE
});
function applicationProfileReader(read, profile) {
  return (name) => {
    if (name === "PRIVACY_CHAIN_IDS")
      return profile === "ethereum-mainnet" ? "1" : "46630";
    if (name === "PRIVACY_CHAIN_ID") return void 0;
    if (name === "PRIVACY_PROTOCOL")
      return profile === "ethereum-mainnet" ? V2_ETH_PROTOCOL : "hylsia-pp-v1";
    if (profile === "ethereum-mainnet" && /^PRIVACY_(?:ASP_POSTMAN|RELAYER)_PRIVATE_KEY$/.test(name))
      return void 0;
    return read(name);
  };
}
function resolveApplicationNetworks(read) {
  const enabled = mainnetApplicationEnabled(
    read("PRIVACY_ENABLE_MAINNET_APP"),
    read("NODE_ENV") === "production"
  );
  const deployments = enabled ? APPLICATION_DEPLOYMENTS : DEPLOYMENTS;
  const resolved = resolveNetworks(read, deployments);
  if (!enabled) return resolved;
  for (const item of resolved.networks) {
    const release = ETHEREUM_APPLICATION_RELEASE;
    if (!isAuthorizedApplicationRelease(release) || item.network.chainId !== 1 || item.protocol !== V2_ETH_PROTOCOL || item.pool?.toLowerCase() !== release.pool.toLowerCase() || item.deployBlock !== BigInt(release.deployBlock))
      continue;
    item.problems = item.problems.filter(
      (problem) => problem !== "mainnet_release_blocked"
    );
    item.warnings = item.warnings.filter(
      (message) => !message.startsWith("Mainnet release blocked:")
    );
    item.warnings.push(
      "Owner-authorized single-operator Ethereum release; not independently audited. Publisher signatures are approved in its wallet."
    );
  }
  return resolved;
}

// server/privacy/exclusions.ts
import { createHash } from "node:crypto";
import fs from "node:fs";
var READ_EVERY_MS = 1e3;
var EXCLUSIONS_SETTLE_SECONDS = 30;
var REPEAT_INVALID_MS = 10 * 6e4;
var cache = null;
var versions = 0;
function sourceKey(source) {
  switch (source.kind) {
    case "none":
      return "none";
    case "file":
      return `file:${source.path}`;
    case "inline":
      return `inline:${sha256(source.text)}`;
    case "error":
      return `error:${source.error}`;
  }
}
var sha256 = (text) => createHash("sha256").update(text).digest("hex");
function where(source) {
  return source.kind === "file" ? source.display : source.kind === "inline" ? "PRIVACY_ASP_EXCLUSIONS_JSON" : null;
}
function readFailure(err) {
  const code = err?.code;
  if (code === "ENOENT") return "the file does not exist";
  if (code === "EISDIR") return "the path is a folder, not a file";
  if (code === "EACCES" || code === "EPERM") return "the file cannot be read (permission denied)";
  return `the file cannot be read${typeof code === "string" ? ` (${code})` : ""}`;
}
function readSource(source) {
  switch (source.kind) {
    case "none":
      return null;
    case "error":
      return { ok: false, error: source.error };
    case "inline":
      return { ok: true, text: source.text, mtimeMs: null };
    case "file":
      try {
        const { mtimeMs } = fs.statSync(source.path);
        return { ok: true, text: fs.readFileSync(source.path, "utf8"), mtimeMs };
      } catch (err) {
        return { ok: false, error: readFailure(err) };
      }
  }
}
function describe(state, lastGoodCount) {
  if (state.status === "none") return { line: "[privacy] exclusion list: none configured (PRIVACY_ASP_EXCLUSIONS_FILE is unset): no deposit is excluded", warn: false };
  if (state.status === "ok") {
    const n = state.entries.length;
    const w = state.warnings.length > 0 ? `; ${state.warnings.join("; ")}` : "";
    return { line: `[privacy] exclusion list (${state.where}): ${n} ${n === 1 ? "entry" : "entries"}${w}`, warn: false };
  }
  const kept = lastGoodCount > 0 ? ` The last good list (${lastGoodCount} ${lastGoodCount === 1 ? "entry" : "entries"}) is still shown.` : "";
  return {
    line: `[privacy] exclusion list${state.where ? ` (${state.where})` : ""} is invalid: ${state.error}. Publishing association-set roots is paused on every network until it is fixed.${kept}`,
    warn: true
  };
}
function readExclusions(source, o = {}) {
  const now = o.now ?? Date.now();
  const key = sourceKey(source);
  if (cache && cache.key === key && !o.force && now - cache.readAt < READ_EVERY_MS) {
    if (o.log) o.log(describe(cache.state, cache.lastGood.length).line);
    return cache.state;
  }
  const prev = cache && cache.key === key ? cache : null;
  const read = readSource(source);
  const contentKey = read === null ? "none" : read.ok ? `text:${sha256(read.text)}` : `fail:${read.error}`;
  let state;
  let lastGood = prev?.lastGood ?? [];
  if (prev && prev.contentKey === contentKey) {
    state = prev.state;
  } else {
    const changedAt = read === null || source.kind === "inline" ? 0 : read.ok && read.mtimeMs !== null ? Math.min(now, read.mtimeMs) : now;
    const before = prev?.state ?? null;
    const previousSettled = before === null ? null : before.status !== "invalid" && changedAt - before.changedAt >= EXCLUSIONS_SETTLE_SECONDS * 1e3 ? before.entries : before.previousSettled;
    const base = { version: ++versions, where: where(source), changedAt, previousSettled };
    if (read === null) {
      state = { ...base, status: "none", entries: [], hash: null, error: null, warnings: [] };
      lastGood = [];
    } else if (!read.ok) {
      state = { ...base, status: "invalid", entries: lastGood, hash: null, error: read.error, warnings: [] };
    } else {
      const parsed = parseExclusionFile(read.text, { notes: source.kind === "inline" ? "reject" : "allow" });
      const hash = sha256(read.text);
      if (parsed.ok) {
        state = { ...base, status: "ok", entries: Object.freeze(parsed.entries), hash, error: null, warnings: Object.freeze(parsed.warnings) };
        lastGood = state.entries;
      } else {
        state = { ...base, status: "invalid", entries: lastGood, hash, error: parsed.error, warnings: [] };
      }
    }
  }
  const next = { key, state, readAt: now, contentKey, lastGood, loggedAt: prev?.loggedAt ?? 0 };
  const changed = prev ? prev.contentKey !== contentKey : state.status !== "none";
  const repeat = state.status === "invalid" && now - next.loggedAt >= REPEAT_INVALID_MS;
  if (o.log || changed || repeat) {
    const { line, warn } = describe(state, lastGood.length);
    if (o.log) o.log(line);
    else if (warn) console.warn(line);
    else console.log(line);
    next.loggedAt = now;
  }
  cache = next;
  return state;
}

// server/privacy/config.ts
var DEFAULT_AUTO_PUBLISH_SECONDS = 600;
var MIN_AUTO_PUBLISH_SECONDS = 10;
var MAX_AUTO_PUBLISH_SECONDS = 86400;
var DEFAULT_RELAYER_FEE_BPS = 50;
var DEFAULT_QUOTE_TTL_SECONDS = 900;
var DEFAULT_RECEIPT_WAIT_MS = 2e4;
var PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;
function chainEnv(read, chainId2, mode, warnings) {
  const isSet = (name) => {
    const v = read(name);
    return typeof v === "string" && v.trim() !== "";
  };
  return {
    get: (name, fallback) => networkEnv(read, name, chainId2, { mode, fallback }),
    /** the variable that supplied the value, for messages */
    source: (name) => isSet(`${name}_${chainId2}`) ? `${name}_${chainId2}` : name,
    warn: (message) => warnings.push(message)
  };
}
function privateKey(env, name) {
  const v = env.get(name, "always");
  if (v === void 0) return null;
  if (!PRIVATE_KEY.test(v)) {
    env.warn(`${env.source(name)} is not a 32-byte hex private key; it is ignored`);
    return null;
  }
  try {
    privateKeyToAccount(v);
  } catch {
    env.warn(`${env.source(name)} is not a valid private key; it is ignored`);
    return null;
  }
  return v;
}
function wholeNumber(env, name, fallback, def, min, max) {
  const v = env.get(name, fallback);
  if (v === void 0) return def;
  const n = /^\d+$/.test(v) ? Number(v) : Number.NaN;
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    env.warn(`${env.source(name)} is not a whole number from ${min} to ${max}; the default ${def} is used`);
    return def;
  }
  return n;
}
function bigNumber(env, name, fallback, def, min) {
  const v = env.get(name, fallback);
  if (v === void 0) return def;
  const n = /^\d+$/.test(v) ? BigInt(v) : null;
  if (n === null || n < min) {
    env.warn(`${env.source(name)} is not a whole number of at least ${min}; the default ${def} is used`);
    return def;
  }
  return n;
}
function recordScopeOf(chainId2, pool) {
  const record = APPLICATION_DEPLOYMENTS[chainId2];
  if (!record || !pool || typeof record.pool !== "string" || record.pool.toLowerCase() !== pool.toLowerCase()) return null;
  try {
    return BigInt(record.scope);
  } catch {
    return null;
  }
}
function chainFrom(r, read, mode) {
  const network2 = r.network;
  const chainId2 = network2.chainId;
  const warnings = [...r.warnings];
  const env = chainEnv(read, chainId2, mode, warnings);
  const logChunk = bigNumber(env, "PRIVACY_LOG_CHUNK", "legacy", network2.logChunk, 1n);
  return {
    chainId: chainId2,
    protocol: r.protocol,
    network: network2,
    rpcUrl: r.rpcUrl,
    rpcSource: r.rpcSource,
    pool: r.pool,
    poolSource: r.poolSource,
    deployBlock: r.deployBlock,
    deployBlockSource: r.deployBlockSource,
    scope: r.pool ? computeScope(r.pool, chainId2) : null,
    recordScope: recordScopeOf(chainId2, r.pool),
    problems: [...r.problems],
    warnings,
    relayerPrivateKey: privateKey(env, "PRIVACY_RELAYER_PRIVATE_KEY"),
    relayerFeeBps: wholeNumber(env, "PRIVACY_RELAYER_FEE_BPS", "always", DEFAULT_RELAYER_FEE_BPS, 0, 1e4),
    relayerMinFeeWei: bigNumber(env, "PRIVACY_RELAYER_MIN_FEE_WEI", "always", 0n, 0n),
    quoteTtlSeconds: wholeNumber(env, "PRIVACY_QUOTE_TTL_SECONDS", "always", DEFAULT_QUOTE_TTL_SECONDS, 1, 86400),
    aspPostmanPrivateKey: privateKey(env, "PRIVACY_ASP_POSTMAN_PRIVATE_KEY"),
    aspConfirmations: wholeNumber(env, "PRIVACY_ASP_CONFIRMATIONS", "legacy", network2.aspConfirmations, 1, 1e5),
    aspInclusionDelaySeconds: wholeNumber(env, "PRIVACY_ASP_INCLUSION_DELAY_SECONDS", "legacy", network2.aspInclusionDelaySeconds, 0, MAX_INCLUSION_DELAY_SECONDS),
    reorgWindow: wholeNumber(env, "PRIVACY_REORG_WINDOW", "legacy", network2.reorgWindow, 0, 1e5),
    logChunk,
    minLogChunk: network2.minLogChunk < logChunk ? network2.minLogChunk : logChunk,
    receiptWaitMs: wholeNumber(env, "PRIVACY_ASP_RECEIPT_WAIT_MS", "legacy", DEFAULT_RECEIPT_WAIT_MS, 0, 6e5)
  };
}
var NETWORK_ONLY_SETTINGS = [
  "PRIVACY_ASP_CONFIRMATIONS",
  "PRIVACY_ASP_INCLUSION_DELAY_SECONDS",
  "PRIVACY_REORG_WINDOW",
  "PRIVACY_LOG_CHUNK",
  "PRIVACY_ASP_RECEIPT_WAIT_MS"
];
function autoPublishSeconds(read, warnings) {
  const raw = read("PRIVACY_ASP_AUTO_PUBLISH_SECONDS");
  const v = typeof raw === "string" ? raw.trim() : "";
  if (v === "") return DEFAULT_AUTO_PUBLISH_SECONDS;
  const n = /^\d+$/.test(v) ? Number(v) : Number.NaN;
  if (n === 0) return 0;
  if (!Number.isSafeInteger(n) || n < MIN_AUTO_PUBLISH_SECONDS || n > MAX_AUTO_PUBLISH_SECONDS) {
    warnings.push(
      `PRIVACY_ASP_AUTO_PUBLISH_SECONDS is neither 0 (off) nor a whole number from ${MIN_AUTO_PUBLISH_SECONDS} to ${MAX_AUTO_PUBLISH_SECONDS}; the default ${DEFAULT_AUTO_PUBLISH_SECONDS} is used`
    );
    return DEFAULT_AUTO_PUBLISH_SECONDS;
  }
  return n;
}
var rootDir = null;
function repoRoot() {
  if (rootDir !== null) return rootDir;
  let dir;
  try {
    dir = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return rootDir = process.cwd();
  }
  for (let i = 0; i < 10; i++) {
    if (fs2.existsSync(path.join(dir, "package.json"))) return rootDir = dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return rootDir = process.cwd();
}
function exclusionSource(read) {
  const value = (name) => {
    const v = read(name);
    return typeof v === "string" ? v.trim() : "";
  };
  const file = value("PRIVACY_ASP_EXCLUSIONS_FILE");
  const json = value("PRIVACY_ASP_EXCLUSIONS_JSON");
  if (file && json) {
    return { kind: "error", error: "both PRIVACY_ASP_EXCLUSIONS_FILE and PRIVACY_ASP_EXCLUSIONS_JSON are set; set only one" };
  }
  if (json) return { kind: "inline", text: json };
  if (file) return { kind: "file", path: path.isAbsolute(file) ? path.normalize(file) : path.resolve(repoRoot(), file), display: file };
  return { kind: "none" };
}
function loadPrivacyConfig(read = (name) => process.env[name]) {
  const enabled = mainnetApplicationEnabled(read("PRIVACY_ENABLE_MAINNET_APP"), read("NODE_ENV") === "production");
  const resolved = enabled ? resolveApplicationNetworks(read) : resolveNetworks(read, DEPLOYMENTS);
  const publicProfiles = enabled && !resolved.networks.some((r) => r.network.kind === "local");
  const chains = resolved.networks.filter((r) => !publicProfiles || ![1, 46630].includes(r.network.chainId)).map((r) => chainFrom(r, read, resolved.mode));
  if (publicProfiles) {
    for (const profile of ["robinhood-testnet", "ethereum-mainnet"]) {
      const profileRead = applicationProfileReader(read, profile);
      const selected = resolveApplicationNetworks(profileRead);
      chains.push(...selected.networks.map((r) => chainFrom(r, profileRead, selected.mode)));
    }
  }
  const warnings = [...resolved.warnings];
  if (resolved.mode === "multi") {
    for (const name of NETWORK_ONLY_SETTINGS) {
      const v = read(name);
      if (typeof v === "string" && v.trim() !== "") {
        warnings.push(`${name} has no network suffix and is ignored; set ${chains.map((c) => `${name}_${c.chainId}`).join(" or ")}`);
      }
    }
  }
  return {
    mode: resolved.mode,
    protocol: resolved.protocol,
    chains,
    byChainId: new Map(chains.map((c) => [c.chainId, c])),
    autoPublishSeconds: autoPublishSeconds(read, warnings),
    aspExclusions: exclusionSource(read),
    warnings
  };
}
var cached = null;
function privacyConfig() {
  if (!cached) cached = loadPrivacyConfig();
  return cached;
}
function chainConfig(chainId2) {
  const cfg = privacyConfig();
  if (chainId2 === void 0) {
    if (cfg.chains.length === 1) return cfg.chains[0];
    throw new TRPCError({ code: "BAD_REQUEST", message: `chainId is required: this server serves ${cfg.chains.length} networks` });
  }
  const chain = cfg.byChainId.get(chainId2);
  if (!chain) throw new TRPCError({ code: "BAD_REQUEST", message: `Hylsia is not built for network ${chainId2}` });
  return chain;
}
function keyAddress(key) {
  if (!key) return null;
  try {
    return privateKeyToAccount(key).address;
  } catch {
    return null;
  }
}

// server/privacy/chain.ts
var RPC_TIMEOUT_MS = 5e3;
var RPC_RETRIES = 1;
var publicClients = /* @__PURE__ */ new Map();
var walletClients = /* @__PURE__ */ new Map();
function getPublicClient(chainId2) {
  const cfg = chainConfig(chainId2);
  const key = `${cfg.chainId}|${cfg.rpcUrl}`;
  let client = publicClients.get(key);
  if (!client) {
    client = createPublicClient({
      chain: cfg.network.chain,
      transport: http(cfg.rpcUrl, { batch: true, retryCount: RPC_RETRIES, timeout: RPC_TIMEOUT_MS })
    });
    publicClients.set(key, client);
  }
  return client;
}
function makeWalletClient(privateKey2, chainId2) {
  const cfg = chainConfig(chainId2);
  const account = privateKeyToAccount2(privateKey2);
  const key = `${cfg.chainId}|${cfg.rpcUrl}|${account.address}`;
  let wallet = walletClients.get(key);
  if (!wallet) {
    wallet = createWalletClient({ account, chain: cfg.network.chain, transport: http(cfg.rpcUrl) });
    walletClients.set(key, wallet);
  }
  return wallet;
}

// server/privacy/blockTimes.ts
var times = /* @__PURE__ */ new Map();
var timeKey = (chainId2, block) => `${chainId2}:${block}`;
var CONCURRENCY = 8;
async function blockTimestamp(chainId2, block) {
  const key = timeKey(chainId2, block);
  const hit = times.get(key);
  if (hit !== void 0) return hit;
  const b = await getPublicClient(chainId2).getBlock({ blockNumber: block });
  const ts = Number(b.timestamp);
  times.set(key, ts);
  return ts;
}
async function blockTimestamps(chainId2, blocks) {
  const queue = [...new Set(blocks.map(String))].filter((b) => !times.has(timeKey(chainId2, BigInt(b))));
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let b = queue.shift(); b !== void 0; b = queue.shift()) await blockTimestamp(chainId2, BigInt(b));
  });
  await Promise.all(workers);
  return (block) => times.get(timeKey(chainId2, block));
}
var heads = /* @__PURE__ */ new Map();
async function headTimestamp(chainId2, block) {
  const cached2 = times.get(timeKey(chainId2, block));
  if (cached2 !== void 0) return cached2;
  const last = heads.get(chainId2);
  if (last && last.block === block) return last.time;
  const b = await getPublicClient(chainId2).getBlock({ blockNumber: block });
  const time = Number(b.timestamp);
  heads.set(chainId2, { block, time });
  return time;
}
function forgetBlockTimes(chainId2) {
  const prefix = `${chainId2}:`;
  for (const key of times.keys()) if (key.startsWith(prefix)) times.delete(key);
  heads.delete(chainId2);
}

// server/privacy/errors.ts
import { BaseError, InsufficientFundsError } from "viem";
function describeError(err) {
  const text = err instanceof BaseError ? err.shortMessage : err instanceof Error ? err.message : String(err);
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]+/gi, (url) => urlHost(url)).slice(0, 500);
}
function isInsufficientFunds(err) {
  if (err instanceof BaseError && err.walk((e) => e instanceof InsufficientFundsError)) return true;
  const text = err instanceof BaseError ? `${err.shortMessage} ${err.details ?? ""}` : err instanceof Error ? err.message : String(err);
  return /insufficient funds/i.test(text);
}

// server/privacy/funding.ts
var WITHDRAW_GAS = 1200000n;
var PUBLISH_GAS = 100000n;
var GAS_PRICE_MARGIN = 2n;
var FUNDING_TTL_MS = 3e4;
var FUNDING_DEADLINE_MS = 4e3;
var LAST_GOOD_MS = 10 * 6e4;
var LOG_EVERY_MS = 5 * 6e4;
var cache2 = /* @__PURE__ */ new Map();
var reading = /* @__PURE__ */ new Map();
var loggedAt = /* @__PURE__ */ new Map();
function oneTransactionCost(gasPrice, gas) {
  return gasPrice * gas * GAS_PRICE_MARGIN;
}
function keyFunding(address2, balance, gasPrice, gas) {
  const required = oneTransactionCost(gasPrice, gas);
  return { address: address2, balance, required, funded: balance >= required };
}
function cacheKey(cfg, relayer, postman) {
  return `${poolKey(cfg.chainId, cfg.pool)}|${cfg.rpcUrl}|${relayer ?? "-"}|${postman ?? "-"}`;
}
function withDeadline(work, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${Math.round(ms / 1e3)} s`)), ms);
    timer.unref?.();
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
async function readOnce(cfg, relayer, postman) {
  const client = getPublicClient(cfg.chainId);
  const [gasPrice, relayerBalance, postmanBalance] = await Promise.all([
    client.getGasPrice(),
    relayer ? client.getBalance({ address: relayer }) : null,
    postman ? client.getBalance({ address: postman }) : null
  ]);
  return {
    chainId: cfg.chainId,
    gasPrice,
    relayer: relayer && relayerBalance !== null ? keyFunding(relayer, relayerBalance, gasPrice, WITHDRAW_GAS) : null,
    postman: postman && postmanBalance !== null ? keyFunding(postman, postmanBalance, gasPrice, PUBLISH_GAS) : null,
    at: Date.now()
  };
}
async function readFunding(chainId2, o = {}) {
  const cfg = chainConfig(chainId2);
  if (!cfg.pool || cfg.problems.length > 0) return null;
  const relayer = keyAddress(cfg.relayerPrivateKey);
  const postman = keyAddress(cfg.aspPostmanPrivateKey);
  if (!relayer && !postman) return null;
  const key = cacheKey(cfg, relayer, postman);
  const hit = cache2.get(key);
  if (!o.fresh && hit && Date.now() - hit.at < FUNDING_TTL_MS) return hit;
  const running = reading.get(key);
  if (running) return running;
  const tracked = withDeadline(readOnce(cfg, relayer, postman), FUNDING_DEADLINE_MS).then(
    (funding) => {
      cache2.set(key, funding);
      return funding;
    },
    (err) => {
      const now = Date.now();
      if (now - (loggedAt.get(cfg.chainId) ?? -Infinity) >= LOG_EVERY_MS) {
        loggedAt.set(cfg.chainId, now);
        console.warn(`[privacy] ${cfg.network.name} (${cfg.chainId}): could not read the relayer's and publisher's balances: ${describeError(err)}`);
      }
      const last = cache2.get(key);
      return last && now - last.at < LAST_GOOD_MS ? last : null;
    }
  ).finally(() => {
    if (reading.get(key) === tracked) reading.delete(key);
  });
  reading.set(key, tracked);
  return tracked;
}
function forgetFunding(chainId2) {
  for (const key of cache2.keys()) if (key.startsWith(`${chainId2}:`)) cache2.delete(key);
}
function relayerServices(cfg, funding) {
  const block = !cfg.relayerPrivateKey ? "no_relayer_key" : funding?.relayer && !funding.relayer.funded ? "relayer_unfunded" : null;
  return { relayerAvailable: block === null, relayerBlock: block };
}
function publisherServices(cfg, onChainPostman, funding) {
  const me = keyAddress(cfg.aspPostmanPrivateKey);
  const block = !me ? "no_key" : onChainPostman.toLowerCase() !== me.toLowerCase() ? "not_postman" : funding?.postman && !funding.postman.funded ? "publisher_unfunded" : null;
  return { aspCanPublish: block === null, aspPublishBlock: block };
}

// server/privacy/asp.ts
var UNAVAILABLE_TEXT = {
  rpc_error: "its RPC node did not answer",
  config_error: "this server's configuration for it has a problem",
  contract_check_failed: "the contract at its address is not this pool",
  wrong_chain: "its RPC node serves another chain"
};
var PoolUnavailableError = class extends TRPCError2 {
  chainId;
  pool;
  reason;
  constructor(cfg, reason) {
    super({
      code: reason === "rpc_error" ? "INTERNAL_SERVER_ERROR" : "PRECONDITION_FAILED",
      message: `The privacy pool on ${cfg.network.name} (${cfg.chainId}) is unavailable right now: ${UNAVAILABLE_TEXT[reason]}`
    });
    this.name = "PoolUnavailableError";
    this.chainId = cfg.chainId;
    this.pool = cfg.pool;
    this.reason = reason;
  }
};
var PoolDeadlineError = class extends PoolUnavailableError {
  constructor(cfg, ms) {
    super(cfg, "rpc_error");
    this.name = "PoolDeadlineError";
    this.message = `The privacy pool on ${cfg.network.name} (${cfg.chainId}) is unavailable right now: its RPC node did not answer within ${Math.round(ms / 1e3)} s`;
  }
};
var POOL_DEADLINE_MS = 8e3;
var poolDeadlineMs = POOL_DEADLINE_MS;
function withPoolDeadline(cfg, work) {
  const ms = poolDeadlineMs;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new PoolDeadlineError(cfg, ms)), ms);
    timer.unref?.();
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
function unavailableReason(err) {
  return err instanceof PoolUnavailableError ? err.reason : "rpc_error";
}
var loggedAt2 = /* @__PURE__ */ new Map();
function logPoolFailure(cfg, what, err) {
  const reason = unavailableReason(err);
  const key = `${cfg.chainId}|${what}|${reason}`;
  const now = Date.now();
  if (now - (loggedAt2.get(key) ?? -Infinity) < 6e4) return;
  loggedAt2.set(key, now);
  console.warn(`[privacy] ${cfg.network.name} (${cfg.chainId}) ${what}: unavailable (${reason}): ${describeError(err)}`);
}
async function settlePools(what, fn) {
  const chains = privacyConfig().chains.filter((c) => c.pool !== null || c.problems.length > 0);
  const settled = await Promise.allSettled(
    chains.map(
      (cfg) => cfg.problems.length > 0 ? Promise.reject(new PoolUnavailableError(cfg, "config_error")) : withPoolDeadline(
        cfg,
        Promise.resolve().then(() => fn(cfg))
      )
    )
  );
  const ok = [];
  const unavailable = [];
  settled.forEach((s, i) => {
    const cfg = chains[i];
    if (s.status === "fulfilled") {
      ok.push(s.value);
      return;
    }
    if (cfg.problems.length === 0) logPoolFailure(cfg, what, s.reason);
    unavailable.push({ chainId: cfg.chainId, pool: cfg.pool, reason: unavailableReason(s.reason) });
  });
  return { ok, unavailable };
}
function usablePool(chainId2) {
  const cfg = chainConfig(chainId2);
  if (cfg.problems.length > 0) throw new PoolUnavailableError(cfg, "config_error");
  if (!cfg.pool || cfg.deployBlock === null || cfg.scope === null) {
    throw new TRPCError2({ code: "PRECONDITION_FAILED", message: `${cfg.network.name} (${cfg.chainId}) has no privacy pool yet` });
  }
  return { cfg, pool: cfg.pool, deployBlock: cfg.deployBlock, scope: cfg.scope };
}
var checks = /* @__PURE__ */ new Map();
var checking = /* @__PURE__ */ new Map();
var CHECK_RETRY_MS = 6e4;
function singleFlight(map, key, run) {
  const running = map.get(key);
  if (running) return running;
  const tracked = run().finally(() => {
    if (map.get(key) === tracked) map.delete(key);
  });
  map.set(key, tracked);
  return tracked;
}
function isContractLevelError(err) {
  return err instanceof BaseError2 && !!err.walk(
    (e) => e instanceof ContractFunctionRevertedError || e instanceof ContractFunctionZeroDataError || e instanceof AbiDecodingZeroDataError || e instanceof AbiDecodingDataSizeTooSmallError
  );
}
async function checkContract({ cfg, pool, scope }, key) {
  const client = getPublicClient(cfg.chainId);
  const [rpcChainId, code, onChainScope] = await Promise.all([
    client.getChainId(),
    client.getCode({ address: pool }),
    client.readContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName: "SCOPE" }).catch((err) => {
      if (isContractLevelError(err)) return null;
      throw err;
    })
  ]);
  const observedProtocol = isV2Protocol(cfg.protocol) ? await client.readContract({ address: pool, abi: PRIVACY_POOL_V2_ABI, functionName: "PROTOCOL_VERSION" }).catch((err) => {
    if (isContractLevelError(err)) return null;
    throw err;
  }) : cfg.protocol;
  let failure = null;
  if (rpcChainId !== cfg.chainId) failure = { reason: "wrong_chain", detail: `its RPC node answers chain id ${rpcChainId}` };
  else if (!code || code === "0x") failure = { reason: "contract_check_failed", detail: "there is no contract at the pool address" };
  else if (onChainScope === null || onChainScope !== scope) {
    failure = { reason: "contract_check_failed", detail: "SCOPE() is not this pool's scope on this chain" };
  } else if (cfg.recordScope !== null && onChainScope !== cfg.recordScope) {
    failure = { reason: "contract_check_failed", detail: "SCOPE() does not match the deployment record" };
  } else if (observedProtocol !== cfg.protocol) {
    failure = { reason: "contract_check_failed", detail: "the contract does not match the selected protocol" };
  }
  if (failure) {
    checks.set(key, { passed: false, reason: failure.reason, at: Date.now() });
    console.warn(`[privacy] ${cfg.network.name} (${cfg.chainId}): pool ${pool} failed its contract check: ${failure.detail}; retried in 60 s`);
    return;
  }
  checks.set(key, { passed: true });
}
async function ensurePoolContract(chainId2) {
  const ready = usablePool(chainId2);
  const key = poolKey(ready.cfg.chainId, ready.pool);
  const state = checks.get(key);
  if (state?.passed) return ready;
  if (state && !state.passed && Date.now() - state.at < CHECK_RETRY_MS) throw new PoolUnavailableError(ready.cfg, state.reason);
  await singleFlight(checking, key, () => checkContract(ready, key));
  const after = checks.get(key);
  if (after && !after.passed) throw new PoolUnavailableError(ready.cfg, after.reason);
  return ready;
}
function contractCheckFailed(chainId2) {
  const cfg = chainConfig(chainId2);
  if (!cfg.pool) return false;
  const state = checks.get(poolKey(cfg.chainId, cfg.pool));
  return !!state && !state.passed && Date.now() - state.at < CHECK_RETRY_MS;
}
var caches = /* @__PURE__ */ new Map();
var syncing = /* @__PURE__ */ new Map();
var MIN_REFRESH_MS = 3e3;
var staleEvents = /* @__PURE__ */ new Set();
var resetListeners = /* @__PURE__ */ new Set();
function onPoolReset(listener) {
  resetListeners.add(listener);
  return () => {
    resetListeners.delete(listener);
  };
}
function forgetPoolState(cfg, pool) {
  const key = poolKey(cfg.chainId, pool);
  caches.delete(key);
  staleEvents.delete(key);
  screened.delete(key);
  statuses.delete(key);
  checks.delete(key);
  pendingPublishes.delete(key);
  for (const k of repaired) if (k.startsWith(`${key}|`)) repaired.delete(k);
  for (const k of recorded) if (k.startsWith(`${key}|`)) recorded.delete(k);
  forgetFunding(cfg.chainId);
  forgetBlockTimes(cfg.chainId);
  for (const listener of resetListeners) listener(cfg.chainId, pool);
}
function sameEvents(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.kind !== y.kind || x.txHash !== y.txHash || x.logIndex !== y.logIndex || x.blockNumber !== y.blockNumber) return false;
    if (x.kind === "deposit" && y.kind === "deposit" && (x.label !== y.label || x.leafIndex !== y.leafIndex)) return false;
    if (x.kind === "withdraw" && y.kind === "withdraw" && x.leafIndex !== y.leafIndex) return false;
    if (x.kind === "asproot" && y.kind === "asproot" && (x.root !== y.root || x.cid !== y.cid)) return false;
  }
  return true;
}
async function scanEvents({ cfg, pool, deployBlock }, key, fresh) {
  const client = getPublicClient(cfg.chainId);
  const head = await client.getBlockNumber(fresh ? { cacheTime: 0 } : void 0);
  let prev = caches.get(key) ?? null;
  let range = nextScanRange({ deployBlock, lastBlock: prev?.lastBlock ?? null, head, reorgWindow: cfg.reorgWindow });
  if (range === null && prev) {
    if (headRegression({ lastBlock: prev.lastBlock, head, reorgWindow: cfg.reorgWindow }) === "keep") {
      const kept = { events: prev.events, lastBlock: prev.lastBlock, fetchedAt: Date.now() };
      caches.set(key, kept);
      return kept;
    }
    console.warn(
      `[privacy] ${cfg.network.name} (${cfg.chainId}): the RPC's head ${head} is below block ${prev.lastBlock}, which the pool was scanned to; its cached state is dropped and it is scanned again from its deploy block`
    );
    forgetPoolState(cfg, pool);
    prev = null;
    range = { from: deployBlock, to: head };
  }
  const { from, to } = range ?? { from: deployBlock, to: head };
  const before = prev ? prev.events.filter((e) => e.blockNumber < from) : [];
  const scanned = [];
  const fetched = from <= to ? await fetchPoolEvents(client, pool, from, to, {
    protocol: cfg.protocol,
    chunkSize: cfg.logChunk,
    minChunkSize: cfg.minLogChunk,
    concurrency: SCAN_CONCURRENCY,
    // A long scan (a cold start on a fast chain) keeps its progress: if it is cut off, the next one resumes
    // there instead of starting over. Progress is never served (fetchedAt 0).
    onProgress: (_from, scannedTo, events2) => {
      scanned.push(...events2);
      if (scannedTo < to) caches.set(key, { events: mergePoolEvents(before, scanned, from), lastBlock: scannedTo, fetchedAt: 0 });
    }
  }) : [];
  const merged = mergePoolEvents(prev?.events ?? [], fetched, from);
  const events = prev && prev.fetchedAt !== 0 && sameEvents(prev.events, merged) ? prev.events : merged;
  const next = { events, lastBlock: to, fetchedAt: Date.now() };
  caches.set(key, next);
  staleEvents.delete(key);
  return next;
}
async function syncEvents(opts = {}) {
  const ready = await ensurePoolContract(opts.chainId);
  const key = poolKey(ready.cfg.chainId, ready.pool);
  const force = !!opts.force || staleEvents.has(key);
  const cached2 = caches.get(key);
  if (!force && cached2 && Date.now() - cached2.fetchedAt < MIN_REFRESH_MS) return cached2;
  let running = syncing.get(key);
  if (running && (running.fresh || !force)) return running.promise;
  if (running) await running.promise.catch(() => void 0);
  running = syncing.get(key);
  if (running && (running.fresh || !force)) return running.promise;
  const promise = scanEvents(ready, key, force).finally(() => {
    if (syncing.get(key)?.promise === promise) syncing.delete(key);
  });
  syncing.set(key, { promise, fresh: force });
  return promise;
}
function verifiedCurrent(s) {
  return s.current?.status === "verified" ? s.current.set : null;
}
var screened = /* @__PURE__ */ new Map();
var SCREENED_MEMO_MS = MIN_REFRESH_MS;
var repaired = /* @__PURE__ */ new Set();
var recorded = /* @__PURE__ */ new Set();
var loggedRoots = /* @__PURE__ */ new Set();
var shortRoot = (root) => `${root.toString().slice(0, 12)}\u2026`;
var recordKey = (key, snapshot) => `${key}|${snapshot.root}|${snapshot.recipe.excludedLeaves.join(",")}`;
function exclusionsNow() {
  return readExclusions(privacyConfig().aspExclusions);
}
function policyErrorOf(s) {
  if (s.exclusions.status === "invalid") return `the exclusion list is invalid (${s.exclusions.error})`;
  if (s.snapshot.cid === null) {
    return `the snapshot excludes ${s.snapshot.recipe.excludedLeaves.length} deposits, more than the ${MAX_RECIPE_EXCLUSIONS} a root's record can list`;
  }
  const onChain = highestPolicyVersion(s.events);
  if (onChain > ASP_POLICY_VERSION) {
    return `the pool's roots follow screening policy version ${onChain}, newer than this server's version ${ASP_POLICY_VERSION}: update this server before it posts again`;
  }
  if (s.rootDue && verifySet(s.snapshot.root, s.snapshot.cid, s.events) === null) return "the snapshot did not pass the publisher's own check";
  return null;
}
function noteRootProblems(cfg, key, s) {
  const c = s.current;
  if (!c || c.status !== "mismatch") return;
  const id = `${key}|${s.currentRoot}|${c.problem}`;
  if (loggedRoots.has(id)) return;
  loggedRoots.add(id);
  const what = c.problem === "version_backwards" ? "was posted under the older open policy after screened roots (is an older publisher still running with this postman key? Run one publisher version per pool)" : `does not match its record (${c.problem})`;
  console.warn(
    `[privacy] ${cfg.network.name} (${cfg.chainId}): the current association-set root ${shortRoot(s.currentRoot)} ${what}; devices refuse to prove against it${s.rootDue ? ", and this publisher posts its own root" : ""}`
  );
}
async function buildScreenedSet(cfg, pool, fresh, exclusions) {
  const key = poolKey(cfg.chainId, pool);
  const { events, lastBlock } = await syncEvents({ chainId: cfg.chainId, force: fresh });
  const client = getPublicClient(cfg.chainId);
  const [currentRoot, headTime] = await Promise.all([
    client.readContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName: "currentASPRoot" }),
    headTimestamp(cfg.chainId, lastBlock)
  ]);
  const cur = checkCurrentRoot({ events, currentRoot });
  const current = cur?.check ?? null;
  const verified = current?.status === "verified" ? current.set : null;
  const previousConsidered = Math.max(verified ? verified.recipe.considered : 0, considerationFloor(events));
  const head = { block: lastBlock, time: headTime };
  const invalid = exclusions.status === "invalid";
  const keepExcluded = invalid && verified && verified.recipe.version === 1 ? new Set(verified.recipe.excludedLeaves) : null;
  const base = {
    deposits: events,
    head,
    confirmations: cfg.aspConfirmations,
    delaySeconds: cfg.aspInclusionDelaySeconds,
    exclude: exclusionMatcher(exclusions.entries, cfg.chainId),
    previousConsidered,
    keepExcluded
  };
  const blocks = blocksNeedingTime(base);
  const blockTime = blocks.length > 0 ? await blockTimestamps(cfg.chainId, blocks) : () => void 0;
  const snapshot = screenDeposits({ ...base, blockTime });
  let rootDue = rootDueFor({ currentRoot, current, snapshot });
  const sameRoot = rootDue && snapshot.root === currentRoot;
  const repair = sameRoot && current?.status === "mismatch";
  const record = sameRoot && !repair;
  if (repair && repaired.has(`${key}|${currentRoot}`)) rootDue = false;
  if (record && recorded.has(recordKey(key, snapshot))) rootDue = false;
  const readmitted = invalid ? [] : readmittedLeaves(verified && verified.recipe.version === 1 ? verified.recipe : null, snapshot.recipe);
  let settling = false;
  if (rootDue && Date.now() - exclusions.changedAt < EXCLUSIONS_SETTLE_SECONDS * 1e3) {
    const before = exclusions.previousSettled ? exclusionMatcher(exclusions.previousSettled, cfg.chainId) : null;
    const admitsListed = before !== null && snapshot.labels.some((label) => {
      if (verified?.has(label)) return false;
      const d = depositOf(events, label);
      return d !== null && before(d.deposit) !== null;
    });
    settling = readmitted.length > 0 || admitsListed;
  }
  if (settling) rootDue = false;
  const partial = {
    chainId: cfg.chainId,
    pool,
    head,
    events,
    delaySeconds: cfg.aspInclusionDelaySeconds,
    confirmations: cfg.aspConfirmations,
    currentRoot,
    currentRecord: currentRoot !== 0n ? rootRecordOf(events, currentRoot) : null,
    current,
    previousConsidered,
    snapshot,
    rootDue,
    repair: repair && rootDue,
    record: record && rootDue,
    readmitted,
    settling,
    exclusions
  };
  noteRootProblems(cfg, key, partial);
  return { ...partial, policyError: policyErrorOf(partial) };
}
function getScreenedSet(opts = {}) {
  let ready;
  try {
    ready = usablePool(opts.chainId);
  } catch (err) {
    return Promise.reject(err);
  }
  const { cfg, pool } = ready;
  const key = poolKey(cfg.chainId, pool);
  const fresh = !!opts.fresh;
  const exclusions = exclusionsNow();
  const hit = screened.get(key);
  if (hit && hit.exclusionsVersion === exclusions.version) {
    if (hit.settledAt === null && (hit.fresh || !fresh)) return hit.promise;
    if (!fresh && hit.settledAt !== null && Date.now() - hit.settledAt < SCREENED_MEMO_MS) return hit.promise;
  }
  const memo2 = { promise: buildScreenedSet(cfg, pool, fresh, exclusions), settledAt: null, fresh, exclusionsVersion: exclusions.version };
  screened.set(key, memo2);
  memo2.promise.then(
    () => {
      memo2.settledAt = Date.now();
    },
    () => {
      if (screened.get(key) === memo2) screened.delete(key);
    }
  );
  return memo2.promise;
}
function excludedLabelsOf(s) {
  return new Set(s.snapshot.excluded.map((e) => e.label));
}
function rootTaint(events, root, excluded) {
  const records = events.filter((e) => e.kind === "asproot" && e.root === root).sort((a, b) => a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : a.blockNumber < b.blockNumber ? 1 : -1);
  for (const e of records) {
    const c = checkRoot({ root, cid: e.cid, events, at: { blockNumber: e.blockNumber, logIndex: e.logIndex } });
    if (c.status === "verified") return c.set.labels.some((l) => excluded.has(l)) ? "holds" : "clean";
  }
  return "unverifiable";
}
async function getPublicAssociationSet(chainId2) {
  const s = await getScreenedSet({ chainId: chainId2 });
  if (s.currentRoot !== 0n) {
    const verified = verifiedCurrent(s);
    return {
      chainId: s.chainId,
      pool: s.pool,
      labels: verified ? [...verified.labels] : [],
      memberCount: verified ? verified.memberCount : 0,
      root: s.currentRoot,
      head: s.head.block,
      cid: s.currentRecord?.cid ?? null,
      onChain: true
    };
  }
  return {
    chainId: s.chainId,
    pool: s.pool,
    labels: [...s.snapshot.labels],
    memberCount: s.snapshot.memberCount,
    root: s.snapshot.root,
    head: s.head.block,
    cid: s.snapshot.cid,
    onChain: false
  };
}
async function getPublicAssociationSets() {
  const { ok, unavailable } = await settlePools("asp.set", (cfg) => getPublicAssociationSet(cfg.chainId));
  return { sets: ok, unavailable };
}
var autoPublishing = /* @__PURE__ */ new Map();
function autoPublishState(chainId2) {
  const seconds = autoPublishing.get(chainId2);
  return seconds !== void 0 ? { running: true, seconds } : { running: false, seconds: privacyConfig().autoPublishSeconds };
}
function screeningOf(s) {
  const config = chainConfig(s.chainId);
  const verified = verifiedCurrent(s);
  const invalid = s.exclusions.status === "invalid";
  return {
    walletPublishable: s.policyError === null && !s.settling,
    publicationMode: config.chainId === 1 && config.protocol === V2_ETH_PROTOCOL && config.aspPostmanPrivateKey === null ? "wallet" : "server",
    policyVersion: ASP_POLICY_VERSION,
    delaySeconds: s.delaySeconds,
    confirmations: s.confirmations,
    autoPublish: autoPublishState(s.chainId),
    exclusions: s.exclusions.status,
    snapshot: {
      asOfBlock: s.head.block.toString(),
      asOfTime: s.head.time,
      considered: s.snapshot.recipe.considered,
      memberCount: s.snapshot.memberCount,
      waiting: s.snapshot.waiting,
      root: s.snapshot.root.toString(),
      cid: s.snapshot.cid
    },
    current: s.currentRoot === 0n || s.current === null ? null : {
      root: s.currentRoot.toString(),
      cid: s.currentRecord?.cid ?? null,
      status: s.current.status,
      considered: verified ? verified.recipe.considered : null,
      memberCount: verified ? verified.memberCount : null
    },
    rootDue: s.rootDue,
    readmitted: s.readmitted.length,
    // the deposits the list names (label, leaf, reason code): never a note, a date (the list's, or when this server
    // first matched an entry) or an address that never deposited
    excluded: s.snapshot.excluded.map((e) => ({
      leafIndex: e.leafIndex,
      label: e.label.toString(),
      reason: e.reason,
      considered: e.considered
    })),
    settling: s.settling,
    // nothing about the next root while the list cannot be read: it depends on a list this server does not have
    next: verified && !invalid ? nextChange(verified, s.snapshot.labels) : null
  };
}
function nextChange(current, next) {
  const kept = new Set(next);
  return { joins: next.filter((l) => !current.has(l)).length, removals: current.labels.filter((l) => !kept.has(l)).length };
}
var statuses = /* @__PURE__ */ new Map();
var STATUS_MEMO_MS = 15e3;
async function buildStatus(cfg, pool, fresh) {
  const s = await getScreenedSet({ chainId: cfg.chainId, fresh });
  const client = getPublicClient(cfg.chainId);
  const [postman, funding] = await Promise.all([
    client.readContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName: "aspPostman" }),
    readFunding(cfg.chainId)
  ]);
  const { aspPublishBlock } = publisherServices(cfg, postman, funding);
  const block = s.policyError ? "policy_error" : aspPublishBlock;
  return {
    chainId: cfg.chainId,
    pool,
    confirmations: cfg.aspConfirmations,
    memberCount: s.snapshot.memberCount,
    localRoot: s.snapshot.root.toString(),
    onChainRoot: s.currentRoot.toString(),
    onChainIsCurrent: s.currentRoot === s.snapshot.root,
    canPublish: block === null,
    publishBlock: block,
    head: s.head.block.toString(),
    screening: screeningOf(s)
  };
}
function getASPStatus(chainId2, o = {}) {
  let ready;
  try {
    ready = usablePool(chainId2);
  } catch (err) {
    return Promise.reject(err);
  }
  const { cfg, pool } = ready;
  const key = poolKey(cfg.chainId, pool);
  const exclusions = exclusionsNow();
  const hit = statuses.get(key);
  if (!o.fresh && hit && hit.exclusionsVersion === exclusions.version && (hit.settledAt === null || Date.now() - hit.settledAt < STATUS_MEMO_MS)) {
    return hit.promise;
  }
  const memo2 = { promise: buildStatus(cfg, pool, !!o.fresh), settledAt: null, exclusionsVersion: exclusions.version };
  statuses.set(key, memo2);
  memo2.promise.then(
    () => {
      memo2.settledAt = Date.now();
    },
    () => {
      if (statuses.get(key) === memo2) statuses.delete(key);
    }
  );
  return memo2.promise;
}
async function getASPStatuses() {
  const { ok, unavailable } = await settlePools("asp.status", (cfg) => getASPStatus(cfg.chainId));
  return { pools: ok, unavailable };
}
function invalidateAnswers(key) {
  staleEvents.add(key);
  screened.delete(key);
  statuses.delete(key);
}
var publishing = /* @__PURE__ */ new Map();
var sending = /* @__PURE__ */ new Map();
var sentNow = /* @__PURE__ */ new WeakSet();
var pausedBecause = /* @__PURE__ */ new WeakMap();
var pendingPublishes = /* @__PURE__ */ new Map();
var PENDING_PUBLISH_MS = 10 * 6e4;
function publishResult(cfg, pool, status, root, txHash2) {
  return { chainId: cfg.chainId, pool, status, root: root === null ? null : root.toString(), ...txHash2 ? { txHash: txHash2 } : {} };
}
function replacedAfter(s, minedAt) {
  return !!s.currentRecord?.at && s.currentRecord.at.blockNumber > minedAt;
}
function logPost(cfg, s) {
  const name = `${cfg.network.name} (${cfg.chainId})`;
  const verified = verifiedCurrent(s);
  const removed = verified ? s.snapshot.excluded.filter((e) => e.considered && verified.has(e.label)).length : 0;
  if (s.repair) {
    console.log(`[privacy] ${name}: posting the current association-set root once more with its screening record (its record did not match it)`);
  }
  if (s.record) {
    const added = newlyListedLeaves(s.current, s.snapshot.recipe).length;
    console.log(
      `[privacy] ${name}: posting the current association-set root once more with a record that lists ${added} newly excluded deposit(s) (listed before they joined; the members do not change)`
    );
  }
  if (removed > 0) {
    console.log(`[privacy] ${name}: the new association-set root removes ${removed} deposit(s) that the exclusion list names${s.snapshot.memberCount === 0 ? " (no member is left: the empty set's root)" : ""}`);
  }
  if (s.readmitted.length > 0) {
    console.log(`[privacy] ${name}: the new association-set root admits again ${s.readmitted.length} deposit(s) that the current root excludes (leaves ${s.readmitted.join(", ")}): an exclusion was lifted`);
  }
}
async function decideAndSend(cfg, pool) {
  const result = (status, root2, txHash3) => ({ result: publishResult(cfg, pool, status, root2, txHash3) });
  try {
    await ensurePoolContract(cfg.chainId);
  } catch (err) {
    if (err instanceof PoolUnavailableError) return result("unavailable", null);
    throw err;
  }
  const s = await getScreenedSet({ chainId: cfg.chainId, fresh: true });
  const root = s.snapshot.root;
  if (!s.rootDue) return result(s.currentRoot === 0n && s.snapshot.memberCount === 0 ? "empty" : "current", root);
  if (s.policyError !== null || s.snapshot.cid === null) {
    const paused = publishResult(cfg, pool, "policy_error", root);
    pausedBecause.set(paused, s.policyError ?? "the snapshot has no record");
    return { result: paused };
  }
  const cid = s.snapshot.cid;
  if (!cfg.aspPostmanPrivateKey) return result("no_key", root);
  const client = getPublicClient(cfg.chainId);
  const wallet = makeWalletClient(cfg.aspPostmanPrivateKey, cfg.chainId);
  const postman = await client.readContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName: "aspPostman" });
  if (postman.toLowerCase() !== wallet.account.address.toLowerCase()) return result("not_postman", root);
  const key = poolKey(cfg.chainId, pool);
  const prior = pendingPublishes.get(key);
  if (prior && prior.root === root) {
    const young = Date.now() - prior.sentAt < PENDING_PUBLISH_MS;
    if (!prior.txHash) {
      if (young) return result("pending", root);
    } else {
      const receipt = await client.getTransactionReceipt({ hash: prior.txHash }).catch(() => null);
      if (receipt?.status === "success") {
        if (!s.repair && !s.record && (young || !replacedAfter(s, receipt.blockNumber))) return result("published", root, prior.txHash);
      } else if (receipt) pendingPublishes.delete(key);
      else if (young) return result("pending", root, prior.txHash);
    }
  }
  const funding = await readFunding(cfg.chainId, { fresh: true });
  if (funding?.postman && !funding.postman.funded) return result("unfunded", root);
  const live = pendingPublishes.get(key);
  if (!(live && live.root !== root && live.txHash)) {
    const me = wallet.account.address;
    const inFlight = await Promise.all([
      client.getTransactionCount({ address: me, blockTag: "latest" }),
      client.getTransactionCount({ address: me, blockTag: "pending" })
    ]).then(
      ([mined, sent]) => sent > mined,
      () => false
    );
    if (inFlight) return result("pending", root, live && live.root === root ? live.txHash : null);
  }
  const { request } = await client.simulateContract({
    address: pool,
    abi: PRIVACY_POOL_ABI,
    functionName: "updateASPRoot",
    args: [root, cid],
    account: wallet.account
  });
  const record = { root, txHash: null, sentAt: Date.now() };
  pendingPublishes.set(key, record);
  logPost(cfg, s);
  let txHash2;
  try {
    txHash2 = await wallet.writeContract(request);
    if (s.repair) repaired.add(`${key}|${root}`);
    if (s.record) recorded.add(recordKey(key, s.snapshot));
  } catch (err) {
    if (pendingPublishes.get(key) === record) pendingPublishes.delete(key);
    if (isInsufficientFunds(err)) {
      forgetFunding(cfg.chainId);
      return result("unfunded", root);
    }
    throw err;
  } finally {
    invalidateAnswers(key);
  }
  record.txHash = txHash2;
  return { root, txHash: txHash2 };
}
async function publishOnce(cfg, pool) {
  const sent = await withPoolDeadline(cfg, singleFlight(sending, poolKey(cfg.chainId, pool), () => decideAndSend(cfg, pool)));
  if ("result" in sent) return sent.result;
  const { root, txHash: txHash2 } = sent;
  const key = poolKey(cfg.chainId, pool);
  const client = getPublicClient(cfg.chainId);
  const fresh = (status) => {
    const r = publishResult(cfg, pool, status, root, txHash2);
    sentNow.add(r);
    return r;
  };
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash: txHash2, timeout: Math.max(1, cfg.receiptWaitMs) });
  } catch {
    return fresh("pending");
  } finally {
    invalidateAnswers(key);
  }
  if (receipt.status !== "success") {
    if (pendingPublishes.get(key)?.txHash === txHash2) pendingPublishes.delete(key);
    return fresh("unavailable");
  }
  return fresh("published");
}
function publishASPRoot(chainId2) {
  let cfg;
  try {
    cfg = chainConfig(chainId2);
  } catch (err) {
    return Promise.reject(err);
  }
  const pool = cfg.pool;
  if (!pool) return Promise.resolve({ chainId: cfg.chainId, pool: null, status: "unavailable", root: null });
  return singleFlight(publishing, poolKey(cfg.chainId, pool), () => publishOnce(cfg, pool));
}
async function publishBehindRoots() {
  const { chains } = privacyConfig();
  const settled = await Promise.allSettled(chains.map((c) => publishASPRoot(c.chainId)));
  return {
    results: settled.map((s, i) => {
      if (s.status === "fulfilled") return s.value;
      logPoolFailure(chains[i], "asp.publish", s.reason);
      return { chainId: chains[i].chainId, pool: chains[i].pool, status: "unavailable", root: null };
    })
  };
}
function onChainExcluded(s) {
  const verified = verifiedCurrent(s);
  if (!verified || verified.recipe.excludedLeaves.length === 0) return [];
  const byLeaf = new Map(depositsInLeafOrder(s.events).map((d) => [d.leafIndex, d.label]));
  return verified.recipe.excludedLeaves.map((leaf) => byLeaf.get(leaf)).filter((l) => l !== void 0);
}
async function refusedASPRoot(chainId2, root) {
  const { cfg, pool } = usablePool(chainId2);
  const list = exclusionsNow();
  if (list.status !== "invalid" && !list.entries.some((e) => e.chainId === null || e.chainId === cfg.chainId)) return false;
  const client = getPublicClient(cfg.chainId);
  const currentRoot = await client.readContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName: "currentASPRoot" });
  if (root === currentRoot) return false;
  let s = await getScreenedSet({ chainId: cfg.chainId });
  if (s.currentRoot !== currentRoot) s = await getScreenedSet({ chainId: cfg.chainId, fresh: true });
  if (list.status === "invalid" && verifiedCurrent(s) === null) return true;
  const excluded = excludedLabelsOf(s);
  for (const label of onChainExcluded(s)) excluded.add(label);
  if (excluded.size === 0) return false;
  return rootTaint(s.events, root, excluded) !== "clean";
}

// server/privacy/pools.ts
import { TRPCError as TRPCError4 } from "@trpc/server";
import { zeroAddress as zeroAddress2 } from "viem";

// shared/privacy/associationSet.ts
function associationSetLabels(events, opts = {}) {
  const { cutoffBlock } = opts;
  return events.filter((e) => e.kind === "deposit" && (cutoffBlock === void 0 || e.blockNumber <= cutoffBlock)).sort((a, b) => a.leafIndex - b.leafIndex).map((e) => e.label);
}
function buildAssociationSet(labels, depth = TREE_DEPTH) {
  const tree = new MerkleTree(depth);
  const roots = [tree.root];
  for (const label of labels) {
    tree.insert(label);
    roots.push(tree.root);
  }
  return { labels: [...labels], roots, tree };
}
function prefixSizes(set) {
  const sizes = /* @__PURE__ */ new Map();
  for (let k = 1; k < set.roots.length; k++) sizes.set(set.roots[k], k);
  return sizes;
}
var SENT = "No withdrawal was sent.";
var RAGEQUIT_NOW = "Ragequit (public exit) works now.";
var MESSAGES = {
  NOT_MEMBER: "This deposit is not in the association set yet. Wait until it is confirmed and try again. No withdrawal was sent; ragequit (public exit) works now.",
  NO_PUBLISHED_ROOT: "No published association-set root includes this deposit yet, so a private withdrawal is not possible right now. No withdrawal was sent. Try again after the association-set publisher posts a newer root; ragequit (public exit) works now.",
  ROOT_NOT_KNOWN: "The association-set root built on this device is not a known root on-chain, so no proof was made and no withdrawal was sent. Sync and try again; ragequit (public exit) works now.",
  INVALID_PROOF: "The association-set proof built on this device does not verify, so no proof was made and no withdrawal was sent.",
  WAITING: `This deposit is waiting for screening, so it cannot be withdrawn privately yet. ${SENT} ${RAGEQUIT_NOW}`,
  EXCLUDED: `This deposit was excluded from the association set, so it cannot be withdrawn privately. Use the public exit (ragequit): it returns the deposit to the address that made it. ${SENT}`,
  REMOVAL_ANNOUNCED: `The operator has announced that this deposit will be excluded from the association set, but the association set on-chain still includes it, so this app does not withdraw it privately for now. ${SENT}`,
  UNVERIFIED_ROOT: `The newest association-set root could not be checked on this device, so no proof was made. ${SENT} Sync and try again.`,
  SET_CHANGED: setChangedMessage(null),
  DECLINED: SENT
};
function setChangedMessage(dropped) {
  const what = dropped === null ? "deposits that were in it a moment ago, whose exclusion the operator's status, as this app last read it, did not announce" : `${dropped.toLocaleString("en-US")} deposit${dropped === 1 ? "" : "s"} that ${dropped === 1 ? "was" : "were"} in it a moment ago, whose exclusion the operator's status, as this app last read it, did not announce`;
  return `The association set changed while this withdrawal was being prepared: the newest root leaves out ${what} (an exclusion announced since then stops a withdrawal this way too). ${SENT} A new attempt is proved against the new set; the app asks first only if that set is small or shrank sharply, and whether and when you try again can tell the operator something.`;
}
var UNVERIFIED_MESSAGES = {
  missing_deposits: MESSAGES.UNVERIFIED_ROOT,
  no_record: MESSAGES.UNVERIFIED_ROOT,
  root: `The newest association-set root does not match the list its record describes, so no proof was made. ${SENT}`,
  exclusions: `The newest association-set root does not match the list its record describes, so no proof was made. ${SENT}`,
  malformed: `The newest association-set root carries a record this app cannot read, so no proof was made. ${SENT}`,
  lowered: `The newest association-set root leaves out deposits that an earlier root counted, without listing them as excluded. The screening policy does not allow that, so no proof was made. ${SENT}`,
  version_backwards: `The newest association-set root was posted under the older open policy after screened roots (the policy version went backwards), so no proof was made. ${SENT}`,
  outdated: `The newest association-set root follows a newer screening policy than this app knows. This app is out of date: reload the page. ${SENT}`
};

// shared/privacy/guidance.ts
import { formatEther } from "viem";

// shared/privacy/simulate.ts
var WAIT_STEPS = [600, 1800, 3600, 10800, 21600, 43200, 86400, 172800, 259200, 604800, 1209600, 2592e3];

// shared/privacy/guidance.ts
var DAY = 86400;
var MILLI = 10n ** 15n;
var ETHER = 10n ** 18n;
var eth = (wei) => formatEther(wei);
var STANDARD_AMOUNTS = [10n * MILLI, 50n * MILLI, 100n * MILLI, 500n * MILLI, ETHER, 5n * ETHER];
var STANDARD_LADDER = `${STANDARD_AMOUNTS.map(eth).join(" \xB7 ")} ETH`;
var isStandardAmount = (wei) => STANDARD_AMOUNTS.includes(wei);
var PACE_WINDOW = 7 * DAY;
var QUIET_PACE = 1 / 7;
var LONGEST_WAIT = WAIT_STEPS[WAIT_STEPS.length - 1];

// server/privacy/submissionQueue.ts
var SubmissionQueue = class {
  tail = Promise.resolve();
  entries = /* @__PURE__ */ new Map();
  uncertain = false;
  run(id, job, terms = id) {
    const existing = this.entries.get(id);
    if (existing)
      return existing.terms === terms ? existing.promise : Promise.reject(
        new Error(
          "A different withdrawal for this note was already submitted. Sync and check its transaction before retrying."
        )
      );
    if (this.entries.size >= 1e3)
      return Promise.reject(
        new Error(
          "Relayer submission capacity reached; operator reconciliation is required."
        )
      );
    let attempted = false;
    const run = this.tail.then(async () => {
      if (this.uncertain)
        throw new Error(
          "Relayer submission status is uncertain. Check chain status; the operator must reconcile pending transactions before this signer resumes."
        );
      return job((uncertain = true) => {
        attempted = uncertain;
      });
    });
    this.entries.set(id, { terms, promise: run });
    this.tail = run.catch(() => void 0);
    void run.catch(() => {
      if (attempted) this.uncertain = true;
      else if (this.entries.get(id)?.promise === run) this.entries.delete(id);
    });
    return run;
  }
};

// server/privacy/relayer.ts
import { keccak256 as keccak2564, toBytes as toBytes3 } from "viem";
import { TRPCError as TRPCError3 } from "@trpc/server";
import {
  BaseError as BaseError3,
  ContractFunctionRevertedError as ContractFunctionRevertedError2,
  TransactionReceiptNotFoundError
} from "viem";

// shared/privacy/types.ts
var WITHDRAW_PUBLIC_SIGNALS = {
  newCommitmentHash: 0,
  existingNullifierHash: 1,
  withdrawnValue: 2,
  stateRoot: 3,
  ASPRoot: 4,
  context: 5
};

// server/privacy/relayer.ts
var queues = /* @__PURE__ */ new WeakMap();
function relayerAddress(chainId2) {
  return keyAddress(chainConfig(chainId2).relayerPrivateKey);
}
function computeFee(withdrawnValue, chainId2) {
  const { relayerFeeBps, relayerMinFeeWei } = chainConfig(chainId2);
  const pct = withdrawnValue * BigInt(relayerFeeBps) / 10000n;
  return pct > relayerMinFeeWei ? pct : relayerMinFeeWei;
}
async function getQuote(chainId2) {
  const cfg = chainConfig(chainId2);
  const relayer = keyAddress(cfg.relayerPrivateKey);
  let reason = !cfg.pool && cfg.problems.length === 0 ? "no_pool" : cfg.problems.length > 0 || contractCheckFailed(cfg.chainId) ? "pool_unavailable" : !relayer ? "no_relayer_key" : null;
  if (reason === null) {
    const funding = await readFunding(cfg.chainId);
    if (funding?.relayer && !funding.relayer.funded) reason = "relayer_unfunded";
  }
  return {
    chainId: cfg.chainId,
    pool: cfg.pool,
    available: reason === null,
    reason,
    relayer,
    feeBps: cfg.relayerFeeBps,
    minFeeWei: cfg.relayerMinFeeWei.toString(),
    expiresAt: Math.floor(Date.now() / 1e3) + cfg.quoteTtlSeconds
  };
}
async function getQuotes() {
  return { quotes: await Promise.all(privacyConfig().chains.map((c) => getQuote(c.chainId))) };
}
var ASP_ROOT_REFUSED = "The association-set root this proof used is no longer accepted. Nothing was sent; make a new proof.";
function relayerUnfunded(networkName) {
  return new TRPCError3({
    code: "PRECONDITION_FAILED",
    message: `The relayer for ${networkName} has too little testnet ETH to send a withdrawal right now. Nothing was sent.`
  });
}
function revertReason(err) {
  if (err instanceof BaseError3) {
    const revert = err.walk(
      (e) => e instanceof ContractFunctionRevertedError2
    );
    if (revert?.data?.errorName) return revert.data.errorName;
  }
  return describeError(err);
}
async function relayWithdrawal(req) {
  const cfg = chainConfig(req.chainId);
  const name = cfg.network.name;
  if (cfg.problems.length > 0) throw new PoolUnavailableError(cfg, "config_error");
  const pool = cfg.pool;
  if (!pool || cfg.scope === null) throw new TRPCError3({ code: "PRECONDITION_FAILED", message: `${name} has no privacy pool yet` });
  if (req.pubSignals.length !== 6) throw new TRPCError3({ code: "BAD_REQUEST", message: "Expected 6 public signals" });
  const { withdrawal } = req;
  let context;
  try {
    context = computeContext(cfg.scope, withdrawal);
  } catch {
    throw new TRPCError3({ code: "BAD_REQUEST", message: "Malformed withdrawal parameters" });
  }
  if (context !== req.pubSignals[WITHDRAW_PUBLIC_SIGNALS.context]) {
    throw new TRPCError3({ code: "BAD_REQUEST", message: `This proof is for a different pool than the one on ${name}` });
  }
  const me = keyAddress(cfg.relayerPrivateKey);
  if (!me || !cfg.relayerPrivateKey) throw new TRPCError3({ code: "PRECONDITION_FAILED", message: `The relayer for ${name} is not configured` });
  if (withdrawal.relayer.toLowerCase() !== me.toLowerCase()) {
    throw new TRPCError3({ code: "BAD_REQUEST", message: "Proof is bound to a different relayer address" });
  }
  const withdrawnValue = req.pubSignals[WITHDRAW_PUBLIC_SIGNALS.withdrawnValue];
  const requiredFee = computeFee(withdrawnValue, cfg.chainId);
  if (withdrawal.fee < requiredFee) {
    throw new TRPCError3({ code: "BAD_REQUEST", message: `Fee too low on ${name}: required ${requiredFee} wei, got ${withdrawal.fee}` });
  }
  const now = BigInt(Math.floor(Date.now() / 1e3));
  if (withdrawal.deadline !== 0n && withdrawal.deadline < now + 30n) {
    throw new TRPCError3({ code: "BAD_REQUEST", message: "Withdrawal deadline already expired or too close" });
  }
  if (withdrawal.deadline === 0n || withdrawal.deadline > now + BigInt(cfg.quoteTtlSeconds) + 60n) {
    throw new TRPCError3({ code: "BAD_REQUEST", message: "Withdrawal must carry a deadline within the quote window" });
  }
  try {
    await ensurePoolContract(cfg.chainId);
  } catch (err) {
    if (err instanceof TRPCError3) throw err;
    throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: `Relay failed on ${name}: ${describeError(err)}` });
  }
  const funding = await readFunding(cfg.chainId, { fresh: true });
  if (funding?.relayer && !funding.relayer.funded) throw relayerUnfunded(name);
  let refused;
  try {
    refused = await refusedASPRoot(cfg.chainId, req.pubSignals[WITHDRAW_PUBLIC_SIGNALS.ASPRoot]);
  } catch (err) {
    if (err instanceof TRPCError3) throw err;
    throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: `Relay failed on ${name}: ${describeError(err)}` });
  }
  if (refused) throw new TRPCError3({ code: "BAD_REQUEST", message: ASP_ROOT_REFUSED });
  const publicClient = getPublicClient(cfg.chainId);
  const wallet = makeWalletClient(cfg.relayerPrivateKey, cfg.chainId);
  const args = [
    { recipient: withdrawal.recipient, relayer: withdrawal.relayer, fee: withdrawal.fee, deadline: withdrawal.deadline },
    { pA: req.proof.pA, pB: req.proof.pB, pC: req.proof.pC },
    req.pubSignals
  ];
  let queue = queues.get(cfg);
  if (!queue) {
    queue = new SubmissionQueue();
    queues.set(cfg, queue);
  }
  const id = keccak2564(
    toBytes3(
      JSON.stringify(
        args,
        (_k, value) => typeof value === "bigint" ? value.toString() : value
      )
    )
  );
  try {
    const txHash2 = await queue.run(
      req.pubSignals[WITHDRAW_PUBLIC_SIGNALS.existingNullifierHash].toString(),
      async (broadcasting) => {
        let request;
        try {
          ({ request } = await publicClient.simulateContract({
            address: pool,
            abi: PRIVACY_POOL_ABI,
            functionName: "withdraw",
            args,
            account: wallet.account
          }));
        } catch (err) {
          if (!isContractLevelError(err)) {
            throw new TRPCError3({ code: "INTERNAL_SERVER_ERROR", message: `Relay failed on ${name}: ${describeError(err)}` });
          }
          throw new TRPCError3({ code: "BAD_REQUEST", message: `The pool on ${name} rejected the withdrawal: ${revertReason(err)}` });
        }
        try {
          broadcasting();
          return await wallet.writeContract(request);
        } catch (err) {
          if (isInsufficientFunds(err)) {
            broadcasting(false);
            forgetFunding(cfg.chainId);
            throw relayerUnfunded(name);
          }
          throw new TRPCError3({
            code: "INTERNAL_SERVER_ERROR",
            message: `Relay failed on ${name}: ${describeError(err)}`
          });
        }
      },
      id
    );
    return { chainId: cfg.chainId, txHash: txHash2 };
  } catch (err) {
    if (err instanceof TRPCError3) throw err;
    throw new TRPCError3({
      code: "PRECONDITION_FAILED",
      message: err instanceof Error ? err.message : "Relayer submission unavailable"
    });
  }
}
async function getRelayStatus(txHash2, chainId2) {
  const cfg = chainConfig(chainId2);
  if (!cfg.pool || cfg.problems.length > 0) {
    throw new TRPCError3({ code: "PRECONDITION_FAILED", message: `${cfg.network.name} has no usable privacy pool` });
  }
  const receipt = await getPublicClient(cfg.chainId).getTransactionReceipt({ hash: txHash2 }).catch((err) => {
    if (err instanceof TransactionReceiptNotFoundError) return null;
    throw new TRPCError3({
      code: "PRECONDITION_FAILED",
      message: `Receipt status is unavailable on ${cfg.network.name}; check the RPC before retrying.`
    });
  });
  if (!receipt) return { status: "pending" };
  return { status: receipt.status === "success" ? "success" : "reverted", blockNumber: receipt.blockNumber.toString() };
}

// server/privacy/pools.ts
var POOL_INTERVALS = { "1h": 3600, "4h": 14400, "12h": 43200, "24h": 86400, "7d": 604800, "30d": 2592e3 };
var SPARK_BUCKETS = 24;
var DETAIL_BUCKETS = 60;
var ACTIVITY_CAP = 1e3;
var LOAD_MEMO_MS = 5e3;
var NETWORKS_CACHE_MS = 1e4;
function activityOf(e, ts) {
  const base = { txHash: e.txHash, blockNumber: e.blockNumber, timestamp: ts };
  switch (e.kind) {
    case "deposit":
      return { kind: "deposit", value: e.value, fee: 0n, account: e.depositor, relayer: null, ...base };
    case "withdraw":
      return {
        kind: "withdraw",
        value: e.value,
        fee: e.fee,
        account: e.recipient,
        relayer: e.relayer === "0x0000000000000000000000000000000000000000" ? null : e.relayer,
        ...base
      };
    case "ragequit":
      return { kind: "ragequit", value: e.value, fee: 0n, account: e.ragequitter, relayer: null, ...base };
    default:
      return null;
  }
}
var signed = (a) => a.kind === "deposit" ? a.value : -a.value;
var legacySizes = /* @__PURE__ */ new WeakMap();
function legacyPrefixSizes(events) {
  let sizes = legacySizes.get(events);
  if (!sizes) {
    sizes = prefixSizes(buildAssociationSet(associationSetLabels(events)));
    legacySizes.set(events, sizes);
  }
  return sizes;
}
function crowdSteps(events, timeOf, now) {
  const updates = events.filter((e) => e.kind === "asproot" && e.root !== 0n).sort((a, b) => a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1);
  let screenedBefore = false;
  return updates.map((u) => {
    let members = 0;
    if (isScreenedCid(u.cid)) {
      const r = parseRecipe(u.cid);
      members = r && r.version === 1 ? recipeMemberCount(r) : 0;
      screenedBefore = true;
    } else if (!screenedBefore) {
      members = legacyPrefixSizes(events).get(u.root) ?? 0;
    }
    return { timestamp: timeOf(u.blockNumber) ?? now, members };
  });
}
var serverNow = () => Math.floor(Date.now() / 1e3);
async function load(cfg) {
  const { pool, deployBlock } = await ensurePoolContract(cfg.chainId);
  const chainId2 = cfg.chainId;
  const client = getPublicClient(chainId2);
  const head = await client.getBlock();
  const now = Number(head.timestamp);
  const read = (functionName) => client.readContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName });
  const [screened2, scope, owner, aspPostman, dead, minDeposit, nextIndex, aspRoot, tvl, funding] = await Promise.all([
    getScreenedSet({ chainId: chainId2 }),
    read("SCOPE"),
    read("owner"),
    read("aspPostman"),
    read("dead"),
    read("minDeposit"),
    read("nextIndex"),
    read("currentASPRoot"),
    client.getBalance({ address: pool }),
    // the relayer's and publisher's balances (cached 30 s, the same for every visitor; unknown when the read fails)
    readFunding(chainId2)
  ]);
  const events = screened2.events;
  const timeOf = await blockTimestamps(chainId2, [...events.map((e) => e.blockNumber), ...deployBlock > 0n ? [deployBlock] : []]);
  const activity = events.map((e) => activityOf(e, timeOf(e.blockNumber) ?? now)).filter((a) => a !== null);
  const deposits = activity.filter((a) => a.kind === "deposit");
  const exits = activity.filter((a) => a.kind !== "deposit");
  const deployedAt = deployBlock > 0n ? timeOf(deployBlock) ?? null : activity[0]?.timestamp ?? null;
  const crowd = crowdSteps(events, timeOf, now);
  const current = verifiedCurrent(screened2);
  return {
    chainId: chainId2,
    pool,
    now,
    events,
    activity,
    crowd,
    timeOf,
    summaryBase: {
      chainId: chainId2,
      pool,
      asset: "ETH",
      scope,
      owner,
      aspPostman,
      deployBlock,
      deployedAt,
      dead,
      minDeposit,
      tvl,
      leafCount: Number(nextIndex),
      deposits: deposits.length,
      withdrawals: activity.filter((a) => a.kind === "withdraw").length,
      ragequits: activity.filter((a) => a.kind === "ragequit").length,
      uniqueDepositors: new Set(deposits.map((a) => a.account.toLowerCase())).size,
      aspRootMembers: screened2.currentRoot !== 0n && current ? current.memberCount : 0,
      aspMembers: screened2.snapshot.memberCount,
      aspRootPublished: aspRoot !== 0n,
      depositedTotal: deposits.reduce((s, a) => s + a.value, 0n),
      withdrawnTotal: exits.reduce((s, a) => s + a.value, 0n),
      feesPaid: exits.reduce((s, a) => s + a.fee, 0n),
      relayer: relayerAddress(chainId2),
      relayerFeeBps: cfg.relayerFeeBps,
      relayerMinFeeWei: cfg.relayerMinFeeWei,
      ...relayerServices(cfg, funding),
      // publishing paused (an invalid exclusion list, say) is reported like a publisher that cannot post
      ...screened2.policyError !== null ? PAUSED : publisherServices(cfg, aspPostman, funding)
    }
  };
}
var PAUSED = Object.freeze({ aspCanPublish: false, aspPublishBlock: "policy_error" });
var loads = /* @__PURE__ */ new Map();
function loadPool(cfg) {
  const key = poolKey(cfg.chainId, usablePool(cfg.chainId).pool);
  const hit = loads.get(key);
  if (hit && (hit.settledAt === null || Date.now() - hit.settledAt < LOAD_MEMO_MS)) return hit.promise;
  const memo2 = { promise: load(cfg), settledAt: null };
  const settle = () => {
    memo2.settledAt = Date.now();
  };
  memo2.promise.then(settle, settle);
  loads.set(key, memo2);
  return memo2.promise;
}
function bucketize(activity, crowd, now, span, buckets) {
  const start = now - span;
  const size = span / buckets;
  const points = Array.from({ length: buckets }, (_, i) => ({
    t: Math.round(start + size * (i + 1)),
    tvl: 0n,
    deposited: 0n,
    exited: 0n,
    members: 0,
    count: 0
  }));
  let tvlBefore = 0n;
  let intervalDeposits = 0n;
  let intervalWithdrawals = 0n;
  let intervalCount = 0;
  for (const a of activity) {
    if (a.timestamp < start) {
      tvlBefore += signed(a);
      continue;
    }
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((a.timestamp - start) / size)));
    const p = points[idx];
    p.count++;
    intervalCount++;
    if (a.kind === "deposit") {
      p.deposited += a.value;
      intervalDeposits += a.value;
    } else {
      p.exited += a.value;
      intervalWithdrawals += a.value;
    }
  }
  let tvl = tvlBefore;
  let step = 0;
  for (const p of points) {
    tvl += p.deposited - p.exited;
    p.tvl = tvl;
    while (step < crowd.length && crowd[step].timestamp <= p.t) step++;
    p.members = step > 0 ? crowd[step - 1].members : 0;
  }
  return { intervalDeposits, intervalWithdrawals, intervalCount, points };
}
function summarize(l, interval2) {
  const b = bucketize(l.activity, l.crowd, l.now, POOL_INTERVALS[interval2], SPARK_BUCKETS);
  return {
    ...l.summaryBase,
    interval: interval2,
    intervalDeposits: b.intervalDeposits,
    intervalWithdrawals: b.intervalWithdrawals,
    intervalCount: b.intervalCount,
    netFlow: b.points.map((p) => (p.deposited - p.exited).toString()),
    tvlSeries: b.points.map((p) => p.tvl.toString()),
    recent: l.activity.slice(-25).reverse()
  };
}
function privacyHealth(activity) {
  const deposits = activity.filter((a) => a.kind === "deposit");
  const withdrawals = activity.filter((a) => a.kind === "withdraw");
  const amountCount = /* @__PURE__ */ new Map();
  for (const d of deposits) amountCount.set(d.value.toString(), (amountCount.get(d.value.toString()) ?? 0) + 1);
  const depositors = new Set(deposits.map((d) => d.account.toLowerCase()));
  let exactMatch = 0;
  for (const w of withdrawals) {
    if (deposits.some((d) => d.timestamp <= w.timestamp && d.value === w.value)) exactMatch++;
  }
  const all = [...deposits, ...withdrawals];
  return {
    uniqueAmountDeposits: deposits.filter((d) => amountCount.get(d.value.toString()) === 1).length,
    exactMatchWithdrawals: exactMatch,
    recipientIsDepositor: withdrawals.filter((w) => depositors.has(w.account.toLowerCase())).length,
    selfRelayed: withdrawals.filter((w) => w.relayer === null).length,
    standardAmountShare: all.length ? all.filter((a) => isStandardAmount(a.value)).length / all.length : 1
  };
}
async function listPools(interval2) {
  const { chains } = privacyConfig();
  const { ok, unavailable } = await settlePools("pools", loadPool);
  return {
    now: serverNow(),
    networks: chains.map((c) => ({ chainId: c.chainId, pool: c.pool })),
    pools: ok.map((l) => ({ ...summarize(l, interval2), now: l.now })),
    unavailable
  };
}
async function getPoolDetail(chainId2, address2, interval2) {
  const cfg = chainConfig(chainId2);
  if (!cfg.pool || cfg.pool.toLowerCase() !== address2.toLowerCase()) {
    throw new TRPCError4({ code: "NOT_FOUND", message: `No privacy pool at ${address2} on ${cfg.network.name} (${cfg.chainId})` });
  }
  let l;
  try {
    l = await withPoolDeadline(cfg, loadPool(cfg));
  } catch (err) {
    if (err instanceof TRPCError4) throw err;
    logPoolFailure(cfg, "poolDetail", err);
    throw new PoolUnavailableError(cfg, "rpc_error");
  }
  const span = POOL_INTERVALS[interval2];
  const b = bucketize(l.activity, l.crowd, l.now, span, DETAIL_BUCKETS);
  const aspUpdates = l.events.filter((e) => e.kind === "asproot").map((e) => ({ root: e.root, cid: e.cid, timestamp: l.timeOf(e.blockNumber) ?? l.now, txHash: e.txHash })).reverse();
  const activity = [...l.activity].reverse();
  return {
    now: l.now,
    pool: summarize(l, interval2),
    series: b.points,
    activity: activity.slice(0, ACTIVITY_CAP),
    activityTruncated: activity.length > ACTIVITY_CAP,
    aspUpdates,
    health: privacyHealth(l.activity)
  };
}
async function getPoolActivity() {
  const { ok, unavailable } = await settlePools("poolActivity", loadPool);
  return {
    now: serverNow(),
    pools: ok.map((l) => ({ chainId: l.chainId, pool: l.pool, now: l.now, activity: l.activity })),
    unavailable
  };
}
async function networkStatus(cfg) {
  const chainId2 = cfg.chainId;
  if (!cfg.pool && cfg.problems.length === 0) return { chainId: chainId2, configured: false };
  const pool = cfg.pool ?? zeroAddress2;
  if (cfg.problems.length > 0) return { chainId: chainId2, configured: true, available: false, pool, reason: "config_error" };
  try {
    const { deployBlock, scope, lastRoot, aspRoot, nextIndex, dead, minDeposit, poolBalance, aspPostman, funding } = await withPoolDeadline(
      cfg,
      (async () => {
        const { deployBlock: deployBlock2 } = await ensurePoolContract(chainId2);
        const client = getPublicClient(chainId2);
        const read = (functionName) => client.readContract({ address: pool, abi: PRIVACY_POOL_ABI, functionName });
        const [scope2, lastRoot2, aspRoot2, nextIndex2, dead2, minDeposit2, poolBalance2, aspPostman2, funding2] = await Promise.all([
          read("SCOPE"),
          read("getLastRoot"),
          read("currentASPRoot"),
          read("nextIndex"),
          read("dead"),
          read("minDeposit"),
          client.getBalance({ address: pool }),
          read("aspPostman"),
          // the relayer's and publisher's balances (cached 30 s, the same for every visitor; unknown when the read fails)
          readFunding(chainId2)
        ]);
        return { deployBlock: deployBlock2, scope: scope2, lastRoot: lastRoot2, aspRoot: aspRoot2, nextIndex: nextIndex2, dead: dead2, minDeposit: minDeposit2, poolBalance: poolBalance2, aspPostman: aspPostman2, funding: funding2 };
      })()
    );
    return {
      chainId: chainId2,
      configured: true,
      available: true,
      pool,
      deployBlock,
      scope,
      lastRoot,
      aspRoot,
      leafCount: BigInt(nextIndex),
      dead,
      minDeposit,
      poolBalance,
      relayer: relayerAddress(chainId2),
      relayerFeeBps: cfg.relayerFeeBps,
      ...relayerServices(cfg, funding),
      // the landing's answer reads no events: an invalid exclusion list is the pause it can see (privacy.pools and
      // privacy.asp.status report every cause)
      ...readExclusions(privacyConfig().aspExclusions).status === "invalid" ? PAUSED : publisherServices(cfg, aspPostman, funding)
    };
  } catch (err) {
    logPoolFailure(cfg, "networks", err);
    return { chainId: chainId2, configured: true, available: false, pool, reason: unavailableReason(err) };
  }
}
var networksMemo = null;
function getNetworks() {
  const hit = networksMemo;
  if (hit && (hit.settledAt === null || Date.now() - hit.settledAt < NETWORKS_CACHE_MS)) return hit.promise;
  const memo2 = {
    promise: Promise.resolve().then(async () => ({
      protocol: privacyConfig().protocol,
      networks: await Promise.all(privacyConfig().chains.map(networkStatus))
    })),
    settledAt: null
  };
  const settle = () => {
    memo2.settledAt = Date.now();
  };
  memo2.promise.then(settle, () => {
    if (networksMemo === memo2) networksMemo = null;
  });
  networksMemo = memo2;
  return memo2.promise;
}
onPoolReset((chainId2, pool) => {
  loads.delete(poolKey(chainId2, pool));
  networksMemo = null;
});

// server/privacy/router.ts
var fieldElement2 = z.bigint().nonnegative().refine((v) => v < SNARK_SCALAR_FIELD, "not a field element");
var address = z.string().refine((v) => isAddress2(v), "invalid address");
var txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((v) => v);
var chainId = z.number().int().positive();
var interval = z.enum(Object.keys(POOL_INTERVALS));
var g1 = z.tuple([z.bigint(), z.bigint()]);
var proofSchema = z.object({ pA: g1, pB: z.tuple([g1, g1]), pC: g1 });
var privacyRouter = router({
  /** Every served network's public configuration and live pool state, in registry order. The landing's request. */
  networks: publicProcedure.query(() => getNetworks()),
  /** Pools explorer: per-pool public statistics, one entry per served pool. */
  pools: publicProcedure.input(z.object({ interval: interval.default("24h") }).optional()).query(({ input }) => listPools(input?.interval ?? "24h")),
  /** One pool, by chain and address: time series, full public activity, ASP root history, privacy-health heuristics. */
  poolDetail: publicProcedure.input(z.object({ chainId, pool: address, interval: interval.default("7d") })).query(({ input }) => getPoolDetail(input.chainId, input.pool, input.interval)),
  /**
   * Public deposits/exits with amounts and times, one list per pool. Parameterless and the same for every caller:
   * the vault's privacy check reads its active pool's entry on the device.
   */
  poolActivity: publicProcedure.query(() => getPoolActivity()),
  /**
   * Association set (screening policy v1). There is deliberately no per-label proof or per-label state here: asking
   * for the proof or the state of one label tells the server which deposit is about to be spent. Devices rebuild every
   * root's list from their own public events and its recipe cid, build the proof themselves
   * (shared/privacy/associationSet.ts) and work out whether a deposit is waiting or excluded on the device.
   */
  asp: router({
    /**
     * Every pool's status with its screening block (policy, snapshot, the root on-chain as the server checks it,
     * rootDue, the excluded deposits with reason codes): input-less, the same for every visitor.
     */
    status: publicProcedure.query(() => getASPStatuses()),
    /** Every pool's current on-chain root with its cid (and its list), the same for every caller. */
    set: publicProcedure.query(() => getPublicAssociationSets()),
    /**
     * Idempotent, label-free and input-less: publishes on every served pool whose root is due (postman key configured
     * and able to pay for one publish, publishing not paused), so the request does not say which network a withdrawal
     * will be on.
     */
    publish: publicProcedure.mutation(() => publishBehindRoots())
  }),
  relayer: router({
    /** One quote per served network (available: false with relayer_unfunded when the relayer cannot pay for one). */
    quote: publicProcedure.query(() => getQuotes()),
    submit: publicProcedure.input(
      z.object({
        chainId,
        withdrawal: z.object({ recipient: address, relayer: address, fee: z.bigint().nonnegative(), deadline: z.bigint().nonnegative() }),
        proof: proofSchema,
        pubSignals: z.array(fieldElement2).length(6)
      })
    ).mutation(async ({ input }) => {
      try {
        return await relayWithdrawal(input);
      } catch (err) {
        if (err instanceof TRPCError5) throw err;
        const name = networkById(input.chainId)?.name ?? `network ${input.chainId}`;
        throw new TRPCError5({ code: "INTERNAL_SERVER_ERROR", message: `Relay failed on ${name}: ${describeError(err)}` });
      }
    }),
    status: publicProcedure.input(z.object({ chainId, txHash })).query(({ input }) => getRelayStatus(input.txHash, input.chainId))
  })
});

// server/routers.ts
var appRouter = router({
  privacy: privacyRouter
});

// server/_core/context.ts
async function createContext(opts) {
  return {
    req: opts.req,
    res: opts.res
  };
}

// server/privacy/relayerCors.ts
var RELAYER_PROCEDURE = /^\/privacy\.relayer\.(?:quote|submit)$/;
function relayerCorsEnabled(env = process.env) {
  return (env.PRIVACY_RELAYER_CORS ?? "").trim() !== "0";
}
function relayerCors(env = process.env) {
  const on = relayerCorsEnabled(env);
  return (req, res, next) => {
    if (!on || !RELAYER_PROCEDURE.test(req.path)) return next();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST");
      res.setHeader("Access-Control-Allow-Headers", "content-type, trpc-accept");
      res.setHeader("Access-Control-Max-Age", "600");
      res.status(204).end();
      return;
    }
    next();
  };
}

// server/_core/serverless.ts
var _app = null;
function getApp() {
  if (_app) return _app;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ limit: "10mb", extended: true }));
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, node: process.version, time: (/* @__PURE__ */ new Date()).toISOString() });
  });
  app.use("/api/trpc", relayerCors());
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  app.use((err, _req, res, _next) => {
    console.error("[Vercel API] Express error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error", message: err.message });
    }
  });
  _app = app;
  return app;
}
async function handler(req, res) {
  try {
    const app = getApp();
    await new Promise((resolve, reject) => {
      res.on("finish", resolve);
      res.on("error", reject);
      app(req, res);
    });
  } catch (err) {
    console.error("[Vercel API] Handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal server error",
        message: err.message
      });
    }
  }
}
export {
  handler as default
};
