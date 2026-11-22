/**
 * Page-view analytics (Umami), only when VITE_ANALYTICS_ENDPOINT and VITE_ANALYTICS_WEBSITE_ID are set, and never in
 * the privacy area (/pools, /pools/*, /privacy) or documentation (/docs and its chapters).
 *
 *   - The tracker is loaded on the first page view outside the privacy area, so a visit that starts in it never
 *     contacts the analytics host.
 *   - It tracks nothing on its own (data-auto-track="false"): no history hook, so the in-app links into the vault
 *     (/pools/vault#network=<slug>, which the app strips on arrival) and every page of the privacy area stay unseen.
 *   - The landing's router (App.tsx) reports page views, with the path alone: no query string, no hash.
 */
import { isDocsArea, isPrivacyArea } from "./areas";

type AnalyticsEnv = {
  endpoint?: string;
  websiteId?: string;
};

type Payload = Record<string, unknown>;
/** The parts of Umami's tracker this uses (v2 `track`, v1 `trackView`). */
type Tracker = { track?: (fn: (props: Payload) => Payload) => unknown; trackView?: (url: string) => unknown };

const readAnalyticsEnv = (): AnalyticsEnv => {
  const endpoint = (import.meta as any)?.env?.VITE_ANALYTICS_ENDPOINT as string | undefined;
  const websiteId = (import.meta as any)?.env?.VITE_ANALYTICS_WEBSITE_ID as string | undefined;
  return { endpoint, websiteId };
};

const normalizeEndpoint = (endpoint: string): string => endpoint.replace(/\/+$/, "");

let tracker: Promise<Tracker | null> | null = null;

function loadTracker(endpoint: string, websiteId: string): Promise<Tracker | null> {
  if (tracker) return tracker;
  tracker = new Promise((resolve) => {
    const script = document.createElement("script");
    script.defer = true;
    script.src = `${normalizeEndpoint(endpoint)}/umami`;
    script.dataset.websiteId = websiteId;
    script.dataset.autoTrack = "false";
    script.dataset.excludeSearch = "true";
    script.dataset.excludeHash = "true";
    script.onload = () => resolve(((window as unknown as { umami?: Tracker }).umami ?? null) as Tracker | null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });
  return tracker;
}

/** One page view, by path only, outside the privacy area (inside it: nothing is loaded or sent). */
export function trackPageView(path: string): void {
  if (typeof document === "undefined" || isPrivacyArea(path) || isDocsArea(path)) return;
  const { endpoint, websiteId } = readAnalyticsEnv();
  if (!endpoint || !websiteId) return;
  void loadTracker(endpoint, websiteId).then((umami) => {
    // the person may have moved into the privacy area while the tracker loaded: then nothing is sent
    if (!umami || isPrivacyArea(window.location.pathname) || isDocsArea(window.location.pathname)) return;
    try {
      if (typeof umami.track === "function") umami.track((props) => ({ ...props, url: path, title: document.title }));
      else if (typeof umami.trackView === "function") umami.trackView(path);
    } catch {
      /* analytics never breaks the page */
    }
  });
}
