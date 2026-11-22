import { formatEther } from "viem";

export function ethNumber(wei: bigint): number {
  return Number(formatEther(wei));
}

/** Compact ETH amount. The dashboard shows ETH only: testnet ETH has no market value. */
export function ethAmount(wei: bigint): string {
  const eth = ethNumber(wei);
  const digits = eth === 0 ? 0 : Math.abs(eth) >= 100 ? 2 : Math.abs(eth) >= 1 ? 3 : 4;
  return `${eth.toLocaleString("en-US", { maximumFractionDigits: digits })} ETH`;
}

/** Signed ETH amount for net deposits: "+1.2 ETH", "−0.5 ETH". */
export function signedEth(wei: bigint): string {
  if (wei === 0n) return ethAmount(0n);
  return `${wei > 0n ? "+" : "−"}${ethAmount(wei < 0n ? -wei : wei)}`;
}

/** "1 deposit", "1,281 deposits". */
export function plural(n: number, noun: string, many = `${noun}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? noun : many}`;
}

export function age(from: number | null, now: number): string {
  if (!from) return "—";
  const s = Math.max(0, now - from);
  if (s < 3_600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86_400) return `${Math.floor(s / 3_600)}h`;
  if (s < 86_400 * 60) return `${Math.floor(s / 86_400)}d`;
  return `${Math.floor(s / (86_400 * 30))}mo`;
}

export function ago(ts: number, now: number): string {
  const s = Math.max(0, now - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3_600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3_600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export const short = (a: string, n = 4) => `${a.slice(0, n + 2)}…${a.slice(-n)}`;

/**
 * A relayer's minimum fee in words ("min 0.001 ETH"), or null without one. A withdrawal pays the larger of the
 * percentage and this minimum, so a small withdrawal pays more than the percentage says (the withdraw form's terms).
 */
export function minFeeText(minWei: bigint | null | undefined): string | null {
  return typeof minWei === "bigint" && minWei > 0n ? `min ${ethAmount(minWei)}` : null;
}

/** A relayer's terms in one string: "0.5%", or "0.5% (min 0.001 ETH)" with a minimum fee. */
export function relayerFeeTerms(bps: number, minWei: bigint | null | undefined): string {
  const min = minFeeText(minWei);
  return min ? `${bps / 100}% (${min})` : `${bps / 100}%`;
}
