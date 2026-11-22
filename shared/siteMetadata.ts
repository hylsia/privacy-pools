/** Public site identity and US-English search/social metadata. No account, vault or request data is used. */
export const SITE_ORIGIN = "https://www.hylsiapools.tech";
export const SITE_TITLE = "Hylsia Privacy Pools | Robinhood Chain Testnet";
export const SITE_DESCRIPTION =
  "Native ETH privacy pools built for Robinhood Chain Testnet. Explore private withdrawals, backup recovery, and transparent privacy limits. Testnet only. Not audited.";
export const SHARE_IMAGE = {
  path: "/web-share.png",
  width: 1774,
  height: 887,
  alt: "Hylsia Privacy Pools: a white fox in a violet outfit beside a glowing purple pool, with Robinhood branding.",
};
export interface PageMetadata {
  path: string;
  title: string;
  description: string;
  index?: boolean;
}
const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!
  );

export function renderSiteMetadata(page: PageMetadata): string {
  const url = new URL(page.path, SITE_ORIGIN);
  if (url.origin !== SITE_ORIGIN)
    throw new Error("Metadata must use the Hylsia site origin");
  url.search = "";
  url.hash = "";
  const image = `${SITE_ORIGIN}${SHARE_IMAGE.path}`;
  const title = escapeHtml(page.title),
    description = escapeHtml(page.description);
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    '<meta http-equiv="content-language" content="en-US" />',
    '<meta name="language" content="English (United States)" />',
    // A legacy geographic hint, not a guarantee of Google country targeting or rankings.
    '<meta name="geo.region" content="US" />',
    `<meta name="robots" content="${page.index === false ? "noindex, nofollow" : "index, follow, max-image-preview:large"}" />`,
    `<link rel="canonical" href="${escapeHtml(url.href)}" />`,
    `<link rel="alternate" hreflang="en-US" href="${escapeHtml(url.href)}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Hylsia Privacy Pools" />',
    '<meta property="og:locale" content="en_US" />',
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${escapeHtml(url.href)}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:secure_url" content="${image}" />`,
    '<meta property="og:image:type" content="image/png" />',
    `<meta property="og:image:width" content="${SHARE_IMAGE.width}" />`,
    `<meta property="og:image:height" content="${SHARE_IMAGE.height}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(SHARE_IMAGE.alt)}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="twitter:site" content="@hylsiapools" />',
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(SHARE_IMAGE.alt)}" />`,
  ].join("\n    ");
}

export const METADATA_START = "<!-- hylsia:metadata:start -->";
export const METADATA_END = "<!-- hylsia:metadata:end -->";
export function applySiteMetadata(html: string, page: PageMetadata): string {
  const start = html.indexOf(METADATA_START),
    end = html.indexOf(METADATA_END);
  if (start < 0 || end < start)
    throw new Error("HTML metadata markers are missing");
  return (
    html.slice(0, start + METADATA_START.length) +
    "\n    " +
    renderSiteMetadata(page) +
    "\n    " +
    html.slice(end)
  );
}
export function shouldIndexPath(path: string): boolean {
  return !/^\/(?:api|health|zk)(?:\/|$)|^\/(?:privacy(?:\/|$)|pools\/(?:vault|portfolio)(?:\/|$))/.test(
    path
  );
}
