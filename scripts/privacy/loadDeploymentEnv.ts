/** Deployment/readiness tools load configuration without opening runtime service-key secret files. */
import dotenv from "dotenv";
import net from "node:net";
import path from "node:path";
try {
  net.setDefaultAutoSelectFamilyAttemptTimeout(1000);
} catch {}
const root = path.resolve(import.meta.dirname, "../..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });
dotenv.config({
  path: path.join(root, ".env.local"),
  override: true,
  quiet: true,
});
