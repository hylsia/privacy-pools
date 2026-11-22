import { parseAbi } from "viem";
import { PRIVACY_POOL_ABI } from "../abi";

/** V2 has a distinct deposit selector and event topic; a v1 decoder cannot silently consume it. */
export const PRIVACY_POOL_V2_ABI = [
  ...PRIVACY_POOL_ABI.filter(
    item =>
      !(item.type === "function" && item.name === "deposit") &&
      !(item.type === "event" && item.name === "Deposited")
  ),
  ...parseAbi([
    "function PROTOCOL_VERSION() view returns (string)",
    "function deposit(uint256 precommitment, uint256 recoveryNonce) payable returns (uint256 commitment)",
    "event Deposited(address indexed depositor, uint256 commitment, uint256 label, uint256 value, uint256 precommitment, uint256 recoveryNonce, uint32 leafIndex)",
  ]),
] as const;
