/**
 * client/src/privacy/walletChain.ts: what the app says when an operation needs the wallet on its own network
 * (final design §5 table). The error classes are wagmi's and viem's own, so their names are checked against the
 * libraries the app ships.
 */
import { describe, expect, it } from "vitest";
import {
  ChainNotConfiguredError,
  ConnectorChainMismatchError,
  ConnectorNotConnectedError,
  ConnectorUnavailableReconnectingError,
  ProviderNotFoundError,
  SwitchChainNotSupportedError,
} from "@wagmi/core";
import {
  BaseError,
  ChainMismatchError,
  ContractFunctionExecutionError,
  ResourceUnavailableRpcError,
  SwitchChainError,
  UnauthorizedProviderError,
  UnsupportedChainIdError,
  UserRejectedRequestError,
  WaitForTransactionReceiptTimeoutError,
} from "viem";
import { PRIVACY_POOL_ABI } from "../../shared/privacy/abi";
import { anvilB, robinhoodTestnet } from "../../shared/privacy/chains";
import {
  classifyWalletError,
  isReceiptTimeout,
  SELF_RELAY_PROOF_LOST,
  sentOnOtherNetworkMessage,
  walletChainMessage,
  WalletChainFailure,
  walletNetworkName,
} from "../../client/src/privacy/walletChain";

const connector = { name: "MetaMask" } as never;

describe("classifyWalletError", () => {
  it("knows wagmi's connection errors", () => {
    expect(classifyWalletError(new ConnectorNotConnectedError())).toBe("not_connected");
    expect(classifyWalletError(new ProviderNotFoundError())).toBe("not_connected");
    expect(classifyWalletError(new ConnectorUnavailableReconnectingError({ connector }))).toBe("not_connected");
    expect(classifyWalletError(new SwitchChainNotSupportedError({ connector }))).toBe("switch_unsupported");
    expect(classifyWalletError(new ChainNotConfiguredError())).toBe("switch_unsupported");
    expect(classifyWalletError(new ConnectorChainMismatchError({ connectionChainId: 46630, connectorChainId: 31338 }))).toBe("chain_changed");
  });

  it("knows viem's provider errors", () => {
    expect(classifyWalletError(new UserRejectedRequestError(new Error("no")))).toBe("switch_rejected");
    expect(classifyWalletError(new SwitchChainError(new Error("unrecognized")))).toBe("switch_unsupported");
    expect(classifyWalletError(new UnsupportedChainIdError(new Error("x")))).toBe("switch_unsupported");
    expect(classifyWalletError(new UnauthorizedProviderError(new Error("x")))).toBe("not_connected");
    expect(classifyWalletError(new ChainMismatchError({ chain: robinhoodTestnet, currentChainId: 31338 }))).toBe("chain_changed");
  });

  it("a request still open in the wallet (-32002) is its own case, also inside wagmi's SwitchChainError", () => {
    const pending = { code: -32002, message: "Request of type 'wallet_switchEthereumChain' already pending for origin. Please wait." };
    expect(classifyWalletError(pending)).toBe("request_pending");
    expect(classifyWalletError(new ResourceUnavailableRpcError(new Error("already pending")))).toBe("request_pending");
    // wagmi's injected connector throws new SwitchChainError(error) for anything but 4902 and 4001
    expect(classifyWalletError(new SwitchChainError(pending as never))).toBe("request_pending");
    expect(classifyWalletError({ code: -32603, data: { originalError: { code: -32002 } } })).toBe("request_pending");
    expect(walletChainMessage("request_pending", { action: "deposit", target: "Robinhood Chain Testnet", current: null })).toBe(
      "Your wallet already has a request open. Finish or close it in your wallet, then try again. Nothing was sent.",
    );
    // a SwitchChainError for anything else is still "add or enable the network"
    expect(classifyWalletError(new SwitchChainError({ code: 4901, message: "x" } as never))).toBe("switch_unsupported");
  });

  it("reads raw EIP-1193 codes, also MetaMask Mobile's nested one", () => {
    expect(classifyWalletError({ code: 4001, message: "User rejected" })).toBe("switch_rejected");
    expect(classifyWalletError({ code: 4902, message: "Unrecognized chain ID" })).toBe("switch_unsupported");
    expect(classifyWalletError({ code: 4200 })).toBe("switch_unsupported");
    expect(classifyWalletError({ code: 4100 })).toBe("not_connected");
    expect(classifyWalletError({ code: -32603, data: { originalError: { code: 4902 } } })).toBe("switch_unsupported");
  });

  it("finds the cause inside viem's wrappers (the write path)", () => {
    const mismatch = new ChainMismatchError({ chain: anvilB, currentChainId: 46630 });
    const wrapped = new ContractFunctionExecutionError(new BaseError("send failed", { cause: mismatch }), {
      abi: PRIVACY_POOL_ABI,
      functionName: "deposit",
      args: [1n],
    });
    expect(classifyWalletError(wrapped)).toBe("chain_changed");
  });

  it("lets the outermost known error win, as wagmi reports it", () => {
    // wagmi wraps a failed add-chain (4902) in a UserRejectedRequestError
    expect(classifyWalletError(new UserRejectedRequestError(new SwitchChainError(new Error("x"))))).toBe("switch_rejected");
  });

  it("returns null for anything else, without looping on cyclic causes", () => {
    expect(classifyWalletError(new Error("execution reverted"))).toBeNull();
    expect(classifyWalletError({ code: -32000, message: "insufficient funds" })).toBeNull();
    expect(classifyWalletError(null)).toBeNull();
    expect(classifyWalletError(undefined)).toBeNull();
    expect(classifyWalletError("boom")).toBeNull();
    const a: { name: string; cause?: unknown } = { name: "Error" };
    const b = { name: "Error", cause: a };
    a.cause = b;
    expect(classifyWalletError(a)).toBeNull();
  });
});

describe("walletChainMessage (final design §5, each before anything is sent)", () => {
  it("says exactly the table's words", () => {
    expect(walletChainMessage("not_connected", { action: "deposit", target: "Robinhood Chain Testnet", current: null })).toBe("Connect a wallet first.");
    expect(walletChainMessage("switch_rejected", { action: "deposit", target: "Robinhood Chain Testnet", current: "chain 1" })).toBe(
      "Your wallet stayed on chain 1. Switch it to Robinhood Chain Testnet to deposit here. Nothing was sent.",
    );
    expect(walletChainMessage("switch_unsupported", { action: "withdraw", target: "Robinhood Chain Testnet", current: "chain 1" })).toBe(
      "Your wallet could not switch to Robinhood Chain Testnet. Add or enable Robinhood Chain Testnet in your wallet, then try again. Nothing was sent.",
    );
    expect(walletChainMessage("chain_changed", { action: "exit", target: "Robinhood Chain Testnet", current: "chain 1" })).toBe(
      "Your wallet changed network before sending. Nothing was sent; switch back to Robinhood Chain Testnet and try again.",
    );
  });

  it("names the action and the networks", () => {
    expect(walletChainMessage("switch_rejected", { action: "exit", target: "Robinhood Chain Testnet", current: "Local chain B" })).toBe(
      "Your wallet stayed on Local chain B. Switch it to Robinhood Chain Testnet to exit here. Nothing was sent.",
    );
    expect(walletChainMessage("switch_rejected", { action: "withdraw", target: "Local chain B", current: "Robinhood Chain Testnet" })).toBe(
      "Your wallet stayed on Robinhood Chain Testnet. Switch it to Local chain B to withdraw here. Nothing was sent.",
    );
    expect(walletChainMessage("switch_rejected", { action: "deposit", target: "Robinhood Chain Testnet", current: null })).toBe(
      "Your wallet stayed on another network. Switch it to Robinhood Chain Testnet to deposit here. Nothing was sent.",
    );
  });

  it("adds no wallet-specific hint: the app asks the wallet to add Robinhood Chain Testnet itself", () => {
    expect(walletChainMessage("switch_unsupported", { action: "deposit", target: "Local chain B", current: null })).toBe(
      "Your wallet could not switch to Local chain B. Add or enable Local chain B in your wallet, then try again. Nothing was sent.",
    );
  });

  it("explains a lost pay-your-own-gas proof, and a send that landed on another network", () => {
    // it names the form's option as the form shows it (WithdrawPanel.tsx: "Via relayer (recommended)")
    expect(SELF_RELAY_PROOF_LOST).toBe(
      'This proof was made for sending from your own wallet, so the relayer cannot use it. Choose "Via relayer (recommended)" to make a new one.',
    );
    expect(sentOnOtherNetworkMessage("Local chain B", "Robinhood Chain Testnet")).toBe(
      "This transaction was sent on Local chain B, not Robinhood Chain Testnet. Keep the transaction hash; nothing more is sent from this app.",
    );
  });

  it("every message but 'connect' says nothing was sent", () => {
    for (const code of ["switch_rejected", "switch_unsupported", "chain_changed", "request_pending"] as const) {
      expect(walletChainMessage(code, { action: "deposit", target: "Robinhood Chain Testnet", current: "Local chain A" })).toMatch(/Nothing was sent/);
    }
  });
});

describe("helpers", () => {
  it("names the wallet's network from the registry, else by id", () => {
    expect(walletNetworkName(46630)).toBe("Robinhood Chain Testnet");
    expect(walletNetworkName(31338)).toBe("Local chain B");
    expect(walletNetworkName(1)).toBe("Ethereum");
    expect(walletNetworkName(999)).toBe("chain 999");
    expect(walletNetworkName(4663)).toBe("Robinhood Chain");
    expect(walletNetworkName(undefined)).toBeNull();
    expect(walletNetworkName(0)).toBeNull();
    expect(walletNetworkName(Number.NaN)).toBeNull();
  });

  it("recognises a receipt timeout, wrapped or not", () => {
    const timeout = new WaitForTransactionReceiptTimeoutError({ hash: `0x${"ab".repeat(32)}` });
    expect(isReceiptTimeout(timeout)).toBe(true);
    expect(isReceiptTimeout(new BaseError("wrapped", { cause: timeout }))).toBe(true);
    expect(isReceiptTimeout(new Error("reverted"))).toBe(false);
    expect(isReceiptTimeout(null)).toBe(false);
  });

  it("carries its case on the error", () => {
    const e = new WalletChainFailure("switch_rejected", "x");
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe("switch_rejected");
    expect(e.message).toBe("x");
  });
});
