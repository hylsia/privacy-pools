/**
 * The app areas, by path. App.tsx mounts one router per part, both under Hylsia's wallet config
 * (client/src/privacy/wagmi.ts: only the networks this build offers, no mainnet, no WalletConnect).
 *
 *   privacy  /pools, /pools/* and /privacy (the old vault page): the vault, My notes and the pool pages. One
 *            PrivacyProvider, cookie-free API calls, no page-view analytics (client/src/analytics.ts).
 *   docs     /docs and /docs/*: static documentation, no vault initialization or page-view tracking.
 *   site     every other path: the landing (an unknown path shows it too).
 *
 * A wallet that already trusts the site reconnects on the landing as it does on /pools, and nothing there reads its
 * address on another network.
 *
 * Pure: tested from server/privacy/areas.test.ts.
 */

/** /pools, /pools/* and /privacy: the pages under PrivacyProvider. */
export function isPrivacyArea(path: string): boolean {
  return path === "/privacy" || path === "/pools" || path.startsWith("/pools/");
}

/** Documentation has a standalone, read-only router without vault initialization or page-view tracking. */
export function isDocsArea(path: string): boolean {
  return path === "/docs" || path.startsWith("/docs/");
}
