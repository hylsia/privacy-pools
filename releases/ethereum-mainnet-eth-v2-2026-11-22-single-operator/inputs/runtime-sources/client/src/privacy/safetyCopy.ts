/** Shared user-facing facts so the website and documentation describe the same proven limitation. */
export const DUPLICATE_NOTE_RISK =
  "Deposits with the same note precommitment share a nullifier. After one is spent, the others cannot be withdrawn or ragequit.";

export const PUBLIC_VALIDATION_STATUS =
  "A deployed contract and readable pool state do not mean the public deposit-to-withdrawal flow has been validated.";
