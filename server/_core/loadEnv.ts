import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadRuntimeSecrets } from "./runtimeSecrets";

// By default, Node's fetch gives each connection attempt only 250 ms (Happy Eyeballs). On slower connections, the
// public testnet RPCs take 0.4-0.5 s to connect, so every attempt was cut off and requests failed with
// "fetch failed" / "HTTP request failed." (ETIMEDOUT). 1 s per attempt fixes it for the server and every script that
// loads this file first. The project .npmrc sets the same for npm scripts.
try {
  net.setDefaultAutoSelectFamilyAttemptTimeout(1000);
} catch {
  // Node versions without this setting keep their default
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true });
dotenv.config({ path: path.join(repoRoot, ".env.local"), override: true,
  quiet: true,
});

loadRuntimeSecrets();
