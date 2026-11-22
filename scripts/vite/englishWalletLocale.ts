import type { Plugin } from "vite";

/** Keep the wallet UI's production assets in the same language as the application. */
export function englishWalletLocalePlugin(): Plugin {
  return {
    name: "hylsia-wallet-english-only",
    enforce: "pre",
    transform(source, id) {
      const file = id.split("?")[0].replaceAll("\\", "/");
      if (!file.endsWith("/@rainbow-me/rainbowkit/dist/index.js")) return null;

      // RainbowKit loads its translation dictionaries as separate dynamic chunks.
      const english = source.match(/import\((["'])(\.\/en_US-[^"']+\.js)\1\)/);
      if (!english)
        this.error("Unable to locate the wallet's English translation module");

      const code = source.replace(
        /import\((["'])\.\/[a-z]{2}_[A-Za-z0-9]+-[^"']+\.js\1\)/g,
        () => `import(${JSON.stringify(english[2])})`
      );
      return { code, map: null };
    },
  };
}
