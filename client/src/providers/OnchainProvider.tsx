import type { ReactNode } from "react";
import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, cssStringFromTheme, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider, type Config } from "wagmi";

// ─── RainbowKit theme ─────────────────────────────────────────────────────────
// Built from the app's tokens (index.css :root / .dark) so the wallet button reads like the landing's CTA pill:
// Inter, rounded-full, the theme's primary with its own foreground; the modal on the app's card colours.

type ThemeVars = ReturnType<typeof darkTheme>;

/** Shared by both themes: the app's font and the landing's radii (pills for buttons, 24px cards). */
function appTheme(base: ThemeVars, colors: Partial<ThemeVars["colors"]>): ThemeVars {
  return {
    ...base,
    colors: { ...base.colors, ...colors },
    fonts: { body: '"Inter", ui-sans-serif, system-ui, sans-serif' },
    radii: { ...base.radii, actionButton: "9999px", connectButton: "9999px", menuButton: "9999px", modal: "24px", modalMobile: "24px" },
  };
}

/** Night (the default, like the landing): lavender primary #AEB4FF on navy, card #10133A, border #23265C. */
const nightTheme = appTheme(darkTheme({ accentColor: "#AEB4FF", accentColorForeground: "#0A0C2A", borderRadius: "large", overlayBlur: "small" }), {
  modalBackground: "#10133A",
  modalBorder: "#23265C",
  modalText: "#ECEBFF",
  modalTextSecondary: "#8D92C8",
  generalBorder: "#23265C",
  menuItemBackground: "#171A47",
  connectButtonBackground: "#10133A",
  connectButtonInnerBackground: "#171A47",
  connectButtonText: "#ECEBFF",
  actionButtonSecondaryBackground: "#171A47",
  profileForeground: "#10133A",
  modalBackdrop: "rgba(4, 5, 26, 0.6)",
});

/** Day: indigo primary #4A44C4 with white text, white card, border #D2CFF5, navy text. */
const dayTheme = appTheme(lightTheme({ accentColor: "#4A44C4", accentColorForeground: "#FFFFFF", borderRadius: "large", overlayBlur: "small" }), {
  modalBackground: "#FFFFFF",
  modalBorder: "#D2CFF5",
  modalText: "#14143F",
  modalTextSecondary: "#5E5F8F",
  generalBorder: "#D2CFF5",
  menuItemBackground: "#E8E6FF",
  connectButtonBackground: "#FFFFFF",
  connectButtonInnerBackground: "#E8E6FF",
  connectButtonText: "#14143F",
  actionButtonSecondaryBackground: "#E8E6FF",
  profileForeground: "#FFFFFF",
  modalBackdrop: "rgba(20, 20, 63, 0.35)",
});

/**
 * The provider injects the night theme on [data-rk]; the theme switch is a class on <html> (ThemeContext), which
 * RainbowKit's own light/dark option (prefers-color-scheme) cannot follow, so the day values ride on html.light.
 * The last rule gives RainbowKit's full-screen overlay (it carries role="dialog") its translucent backdrop back:
 * index.css paints every [role="dialog"] with an opaque card background, meant for the app's own dialogs.
 */
const THEME_CSS = [
  `html.light [data-rk]{${cssStringFromTheme(dayTheme, { extends: nightTheme })}}`,
  `[data-rk][role="dialog"]{background:var(--rk-colors-modalBackdrop) !important;border:0 !important;backdrop-filter:var(--rk-blurs-modalOverlay) !important}`,
].join("");

/** Wallet and RainbowKit providers, for Hylsia's wallet config (App.tsx passes privacyWagmiConfig). */
export function OnchainProvider({ children, config }: { children: ReactNode; config: Config }) {
  return (
    <WagmiProvider config={config}>
      <RainbowKitProvider theme={nightTheme} locale="en-US">
        <style dangerouslySetInnerHTML={{ __html: THEME_CSS }} />
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
}
