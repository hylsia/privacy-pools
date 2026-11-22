/**
 * Error text for logs and answers, shared by every privacy server module (no other import, so any module can use it).
 */
import { BaseError, InsufficientFundsError } from "viem";
import { urlHost } from "../../shared/privacy/networks";

/** A short message for logs and answers: viem's short message, with every URL cut to its host (a path can hold a key). */
export function describeError(err: unknown): string {
  const text = err instanceof BaseError ? err.shortMessage : err instanceof Error ? err.message : String(err);
  return text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)\]]+/gi, (url) => urlHost(url)).slice(0, 500);
}

/** The node refused a transaction because the sender cannot pay for its gas. */
export function isInsufficientFunds(err: unknown): boolean {
  if (err instanceof BaseError && err.walk((e) => e instanceof InsufficientFundsError)) return true;
  const text = err instanceof BaseError ? `${err.shortMessage} ${err.details ?? ""}` : err instanceof Error ? err.message : String(err);
  return /insufficient funds/i.test(text);
}
