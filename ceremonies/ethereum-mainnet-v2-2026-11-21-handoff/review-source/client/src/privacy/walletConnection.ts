/** Header-only wallet state. No RPC, persistence, or network switching happens here. */
import { classifyWalletError } from "./walletChain";

export type WalletConnectionState =
  | "disconnected"
  | "restoring"
  | "checking"
  | "ready"
  | "switch";

export function walletConnectionState(input: {
  status: "connected" | "connecting" | "reconnecting" | "disconnected";
  address?: string;
  chainId?: number;
  targetChainId: number;
}): WalletConnectionState {
  // A restored connection can carry a neutral stored chain until the wallet answers. Never judge it yet.
  if (input.status === "connecting" || input.status === "reconnecting")
    return "restoring";
  if (input.status !== "connected" || !input.address) return "disconnected";
  if (input.chainId === undefined) return "checking";
  return input.chainId === input.targetChainId ? "ready" : "switch";
}

/** Safe, local messages; provider errors can include full RPC URLs and are never displayed or logged here. */
export function networkSwitchMessage(
  error: unknown,
  target: { name: string; chainId: number }
): string {
  switch (classifyWalletError(error)) {
    case "request_pending":
      return "A network request is already open in your wallet. Finish or dismiss it there before trying again.";
    case "switch_rejected":
      return "Network change cancelled. You can keep browsing and switch when you are ready.";
    case "not_connected":
      return "Your wallet disconnected. Reconnect it before changing networks.";
    case "switch_unsupported":
      return `Your wallet could not switch automatically. Add or select ${target.name} (chain ${target.chainId}) in your wallet.`;
    default:
      return "The network could not be changed. Open your wallet and try again.";
  }
}
