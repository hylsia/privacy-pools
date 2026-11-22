import {
  applicationProfileHref,
  selectedApplicationProfile,
  mainnetApplicationEnabled,
} from "@shared/privacy/applicationProfiles";

export const MAINNET_APPLICATION_ENABLED = mainnetApplicationEnabled(
  import.meta.env.VITE_PRIVACY_ENABLE_MAINNET_APP,
  import.meta.env.PROD
);
export const APPLICATION_PROFILE =
  MAINNET_APPLICATION_ENABLED && typeof window !== "undefined"
    ? selectedApplicationProfile(
        window.location.search,
        window.location.pathname
      )
    : null;
export const profileHref = (href: string) =>
  applicationProfileHref(href, APPLICATION_PROFILE);
