/**
 * What went wrong when an operation needed the wallet on its own network, said for the person acting.
 *
 * Every case here happens before anything is sent: the app checks, and asks the wallet to switch, before it asks
 * for a signature, and viem checks the wallet's network again right before sending (the operation's own chain is
 * passed to every write). A relayed withdrawal never touches the wallet.
 *
 * Pure (no wagmi or viem import): errors are recognised by their name and their EIP-1193 code anywhere in the
 * `cause` chain, so this is tested from server/privacy/walletChain.test.ts.
 */
import { networkById } from "@shared/privacy/networks";

/**
 * The four cases of final design §5, plus `request_pending`: the wallet still shows an earlier request (EIP-1193
 * -32002, e.g. a network switch nobody answered yet), which "add or enable the network" would misdiagnose.
 */
export type WalletChainError = "not_connected" | "switch_rejected" | "switch_unsupported" | "chain_changed" | "request_pending";

/** Error class names (wagmi, viem) and what they mean here. */
const BY_NAME: Readonly<Record<string, WalletChainError>> = {
  // no wallet, or the wallet went away
  ConnectorNotConnectedError: "not_connected",
  ConnectorAccountNotFoundError: "not_connected",
  ConnectorUnavailableReconnectingError: "not_connected",
  ProviderNotFoundError: "not_connected",
  ProviderDisconnectedError: "not_connected",
  UnauthorizedProviderError: "not_connected",
  // the person said no to the switch
  UserRejectedRequestError: "switch_rejected",
  // the wallet cannot switch there (does not know the network, or cannot switch programmatically)
  SwitchChainNotSupportedError: "switch_unsupported",
  SwitchChainError: "switch_unsupported",
  ChainNotConfiguredError: "switch_unsupported",
  UnsupportedProviderMethodError: "switch_unsupported",
  UnsupportedChainIdError: "switch_unsupported",
  ChainDisconnectedError: "switch_unsupported",
  // the wallet is on another network than the one the operation was prepared for
  ConnectorChainMismatchError: "chain_changed",
  ChainMismatchError: "chain_changed",
  // the wallet already has a request open (viem's name for EIP-1193 -32002)
  ResourceUnavailableRpcError: "request_pending",
};

/** EIP-1193 / EIP-3085 provider codes. */
const BY_CODE: Readonly<Record<number, WalletChainError>> = {
  4001: "switch_rejected", // user rejected the request
  4100: "not_connected", // unauthorized: the account is not connected
  4200: "switch_unsupported", // unsupported method
  4900: "not_connected", // disconnected
  4901: "switch_unsupported", // not connected to the requested chain
  4902: "switch_unsupported", // unrecognized chain id (the wallet does not have the network)
  5710: "switch_unsupported", // the wallet does not support the requested chain id
  [-32002]: "request_pending", // resource unavailable: a request of the same kind is already open in the wallet
};

type ErrorLike = { name?: unknown; code?: unknown; cause?: unknown; data?: { originalError?: { code?: unknown } } };

const own = (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k);

function classifyOne(e: ErrorLike): WalletChainError | null {
  if (typeof e.name === "string" && own(BY_NAME, e.name)) return BY_NAME[e.name];
  // MetaMask Mobile wraps the provider code: { code: -32603, data: { originalError: { code: 4902 } } }
  const nested = e.data && typeof e.data === "object" ? e.data.originalError?.code : undefined;
  for (const code of [e.code, nested]) {
    if (typeof code === "number" && own(BY_CODE, code)) return BY_CODE[code];
  }
  return null;
}

/** Walks an error and its `cause` chain (bounded, cycle-safe). */
function walk(err: unknown, visit: (e: ErrorLike) => boolean): boolean {
  const seen = new Set<unknown>();
  let e: unknown = err;
  for (let depth = 0; e && typeof e === "object" && !seen.has(e) && depth < 12; depth++) {
    seen.add(e);
    if (visit(e as ErrorLike)) return true;
    e = (e as ErrorLike).cause;
  }
  return false;
}

/** EIP-1193 -32002 (viem: ResourceUnavailableRpcError), also as MetaMask Mobile wraps it. */
const isRequestPending = (e: ErrorLike): boolean =>
  e.name === "ResourceUnavailableRpcError" || e.code === -32002 || (!!e.data && typeof e.data === "object" && e.data.originalError?.code === -32002);

/**
 * The wallet-network case an error belongs to, or null for anything else (a failed RPC, a revert, a bug). A request
 * still open in the wallet (-32002) wins wherever it sits in the chain: wagmi wraps it in a SwitchChainError, which
 * would otherwise read as "add or enable the network". Apart from that the outermost recognised error wins, the way
 * wagmi reports it. A rejected *transaction* is also a UserRejectedRequestError, so callers classify only what the
 * switch and wallet-client steps throw, and treat a write's error as "chain_changed" only.
 */
export function classifyWalletError(err: unknown): WalletChainError | null {
  if (walk(err, isRequestPending)) return "request_pending";
  let found: WalletChainError | null = null;
  walk(err, (e) => {
    found = classifyOne(e);
    return found !== null;
  });
  return found;
}

/**
 * The message for one case (final design §5). `target` is the operation's network name, `current` the wallet's
 * network name ("chain <id>" outside the registry; null when unknown). Each says that nothing was sent.
 */
export function walletChainMessage(
  code: WalletChainError,
  o: { action: "deposit" | "withdraw" | "exit"; target: string; current: string | null },
): string {
  switch (code) {
    case "not_connected":
      return "Connect a wallet first.";
    case "switch_rejected":
      return `Your wallet stayed on ${o.current ?? "another network"}. Switch it to ${o.target} to ${o.action} here. Nothing was sent.`;
    case "switch_unsupported":
      // the app asks the wallet to add the network when it does not know it; this wallet could not do either
      return `Your wallet could not switch to ${o.target}. Add or enable ${o.target} in your wallet, then try again. Nothing was sent.`;
    case "chain_changed":
      return `Your wallet changed network before sending. Nothing was sent; switch back to ${o.target} and try again.`;
    case "request_pending":
      return "Your wallet already has a request open. Finish or close it in your wallet, then try again. Nothing was sent.";
  }
}

/**
 * Added when a pay-your-own-gas withdrawal cannot be sent after its proof was made: that proof binds no relayer
 * (relayer 0, fee 0), so the relayer cannot send it. It names the form's option as the form shows it.
 */
export const SELF_RELAY_PROOF_LOST =
  'This proof was made for sending from your own wallet, so the relayer cannot use it. Choose "Via relayer (recommended)" to make a new one.';

/** The wallet's network as the messages name it: the registry name, "chain <id>" outside it, null when unknown. */
export function walletNetworkName(chainId: number | null | undefined): string | null {
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || chainId <= 0) return null;
  return networkById(chainId)?.name ?? `chain ${chainId}`;
}

/** A receipt wait that ran out (viem's WaitForTransactionReceiptTimeoutError), anywhere in the cause chain. */
export function isReceiptTimeout(err: unknown): boolean {
  return walk(err, (e) => e.name === "WaitForTransactionReceiptTimeoutError");
}

/** After a receipt timeout, when the hash turned up on another registry network (final design §5, C1). */
export function sentOnOtherNetworkMessage(other: string, target: string): string {
  return `This transaction was sent on ${other}, not ${target}. Keep the transaction hash; nothing more is sent from this app.`;
}

/** An Error that carries its wallet-network case, so a caller can add to the message (e.g. SELF_RELAY_PROOF_LOST). */
export class WalletChainFailure extends Error {
  readonly code: WalletChainError;
  constructor(code: WalletChainError, message: string) {
    super(message);
    this.name = "WalletChainFailure";
    this.code = code;
  }
}
