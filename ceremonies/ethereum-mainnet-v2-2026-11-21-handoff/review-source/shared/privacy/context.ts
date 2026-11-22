/**
 * Domain separation helpers — must match PrivacyPool.sol exactly.
 */
import { encodeAbiParameters, encodePacked, keccak256, type Address } from "viem";
import { NATIVE_ASSET, SNARK_SCALAR_FIELD } from "./constants";

/** SCOPE = uint256(keccak256(abi.encodePacked(pool, chainid, asset))) % p */
export function computeScope(pool: Address, chainId: number | bigint, asset: Address = NATIVE_ASSET): bigint {
  const h = keccak256(encodePacked(["address", "uint256", "address"], [pool, BigInt(chainId), asset]));
  return BigInt(h) % SNARK_SCALAR_FIELD;
}

export interface WithdrawalRequest {
  recipient: Address;
  relayer: Address;
  fee: bigint;
  deadline: bigint;
}

/** context = uint256(keccak256(abi.encode(scope, recipient, relayer, fee, deadline))) % p */
export function computeContext(scope: bigint, w: WithdrawalRequest): bigint {
  const h = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [scope, w.recipient, w.relayer, w.fee, w.deadline],
    ),
  );
  return BigInt(h) % SNARK_SCALAR_FIELD;
}
