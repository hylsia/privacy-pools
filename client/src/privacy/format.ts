import { formatEther, parseEther } from "viem";

export const shortHex = (v: string, n = 6) => (v.length > 2 * n + 2 ? `${v.slice(0, n + 2)}…${v.slice(-n)}` : v);

export function formatEth(wei: bigint, maxFrac = 6): string {
  const s = formatEther(wei);
  const [int, frac = ""] = s.split(".");
  const trimmed = frac.slice(0, maxFrac).replace(/0+$/, "");
  return trimmed ? `${int}.${trimmed}` : int;
}

export function parseEthInput(text: string): bigint | null {
  const t = text.trim();
  if (!/^\d*(\.\d*)?$/.test(t) || t === "" || t === ".") return null;
  try {
    return parseEther(t);
  } catch {
    return null;
  }
}

export const fieldShort = (v: bigint) => shortHex(`0x${v.toString(16).padStart(64, "0")}`, 5);
