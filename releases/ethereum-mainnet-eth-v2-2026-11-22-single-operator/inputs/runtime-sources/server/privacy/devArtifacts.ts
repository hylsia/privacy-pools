/** Isolated local-development artifact serving. Never publishes or copies dev keys into production assets. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Express } from "express";
import { V2_PROTOCOL } from "../../shared/privacy/protocols";
import { V2_DEV_KEY_PINS } from "../../shared/privacy/v2/devKeyPins";
import { privacyConfig, repoRoot } from "./config";

export function loadV2DevelopmentAssets(root: string) {
  const base = path.join(root, "circuits/v2/build");
  const raw = JSON.parse(
    fs.readFileSync(path.join(base, "manifest.json"), "utf8")
  );
  if (
    raw.protocol !== V2_PROTOCOL ||
    raw.status !== "development" ||
    raw.productionReady !== false
  )
    throw new Error("V2 development setup is incomplete");
  const files = new Map<string, Uint8Array>();
  const circuits = Object.fromEntries(
    (["withdraw", "commitment"] as const).map(name => {
      if (raw.circuits[name]?.vkeySha256 !== V2_DEV_KEY_PINS[name])
        throw new Error("V2 development key pins do not match this build");
      const sources = {
        wasm: `${name}_js/${name}.wasm`,
        zkey: `${name}_final.zkey`,
        vkey: `${name}_verification_key.json`,
      };
      const entries = Object.fromEntries(
        (["wasm", "zkey", "vkey"] as const).map(kind => {
          const bytes = new Uint8Array(
            fs.readFileSync(path.join(base, sources[kind]))
          );
          const sha256 = createHash("sha256").update(bytes).digest("hex");
          if (sha256 !== raw.circuits[name][`${kind}Sha256`])
            throw new Error("V2 development artifact integrity mismatch");
          const publicName = `${name}.${kind === "vkey" ? "vkey.json" : kind}`;
          files.set(publicName, bytes);
          return [kind, { path: publicName, bytes: bytes.length, sha256 }];
        })
      );
      return [name, { ...entries, nPublic: name === "withdraw" ? 6 : 4 }];
    })
  );
  return {
    files,
    manifest: {
      protocol: V2_PROTOCOL,
      status: "development",
      productionReady: false,
      builtAt: "development",
      circuits,
    },
  };
}

export function registerV2DevelopmentAssets(app: Express): void {
  if (
    process.env.NODE_ENV !== "development" ||
    privacyConfig().protocol !== V2_PROTOCOL
  )
    return;
  app.get("/zk-v2-dev/:file", (req, res) => {
    const peer = req.socket.remoteAddress ?? "";
    if (!(peer === "::1" || /^(?:::ffff:)?127\./.test(peer))) {
      res.sendStatus(403);
      return;
    }
    try {
      const assets = loadV2DevelopmentAssets(repoRoot());
      res.setHeader("Cache-Control", "no-store");
      if (req.params.file === "manifest.json") {
        res.json(assets.manifest);
        return;
      }
      const bytes = assets.files.get(req.params.file);
      if (!bytes) {
        res.sendStatus(404);
        return;
      }
      res.type(
        req.params.file.endsWith(".json")
          ? "application/json"
          : "application/octet-stream"
      );
      res.send(Buffer.from(bytes));
    } catch {
      res
        .status(503)
        .json({
          error: "V2 development artifacts unavailable or inconsistent",
        });
    }
  });
}
