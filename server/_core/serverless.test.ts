import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("Vercel production artifact", () => {
  it("serves health and tRPC with native Node, without TypeScript source or a loader", () => {
    const deployment = mkdtempSync(path.join(tmpdir(), "hylsia-serverless-"));
    // Deliberately omit .env, NODE_OPTIONS, service keys and the parent's hosting environment.
    const env = { PATH: process.env.PATH };
    try {
      execFileSync("npm", ["run", "build:serverless"], { cwd: root, env, stdio: "pipe" });
      const hosting = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
      expect(hosting.functions["api/index.js"].includeFiles).toBe("dist/serverless/**");
      expect(hosting.rewrites.find((r: { source: string }) => r.source === "/api/:path*").destination).toBe("/api/index.js");

      mkdirSync(path.join(deployment, "api"));
      mkdirSync(path.join(deployment, "dist/serverless"), { recursive: true });
      cpSync(path.join(root, "api/index.js"), path.join(deployment, "api/index.js"));
      cpSync(path.join(root, "dist/serverless/index.mjs"), path.join(deployment, "dist/serverless/index.mjs"));
      writeFileSync(path.join(deployment, "package.json"), JSON.stringify({ type: "module" }));
      symlinkSync(path.join(root, "node_modules"), path.join(deployment, "node_modules"), "dir");

      const output = execFileSync(process.execPath, ["--input-type=module", "--eval", `
        import assert from "node:assert/strict";
        import { createServer } from "node:http";
        import { existsSync } from "node:fs";
        import handler from "./api/index.js";

        assert.equal(process.env.NODE_ENV, "production");
        for (const name of ["server", "shared", "contracts", ".env"]) {
          assert.equal(existsSync(name), false);
        }
        const server = createServer(handler);
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        try {
          const base = "http://127.0.0.1:" + server.address().port;
          const request = async (route) => {
            const response = await fetch(base + route, { signal: AbortSignal.timeout(5000) });
            assert.equal(response.status, 200, await response.clone().text());
            assert.equal(response.headers.get("content-type").split(";")[0], "application/json");
            return response.json();
          };
          assert.equal((await request("/api/health")).ok, true);
          const pools = await request("/api/trpc/privacy.pools");
          assert.deepEqual(pools.result.data.json.pools, []);
          assert.deepEqual(pools.result.data.json.unavailable, []);
          const networks = await request("/api/trpc/privacy.networks");
          assert.deepEqual(networks.result.data.json.networks, [{ chainId: 31337, configured: false }]);
          const batch = await request("/api/trpc/privacy.pools,privacy.asp.status?batch=1");
          assert.equal(batch.length, 2);
          for (const entry of batch) assert.deepEqual(entry.result.data.json.pools, []);
          const preflight = await fetch(base + "/api/trpc/privacy.relayer.submit", {
            method: "OPTIONS",
            headers: { Origin: "https://client.example", "Access-Control-Request-Method": "POST" },
            signal: AbortSignal.timeout(5000),
          });
          assert.equal(preflight.status, 204);
          assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
          const publicQuery = await fetch(base + "/api/trpc/privacy.pools", {
            headers: { Origin: "https://client.example" },
            signal: AbortSignal.timeout(5000),
          });
          assert.equal(publicQuery.headers.get("access-control-allow-origin"), null);
          await publicQuery.text();
          console.log("Native serverless health, pools, networks and batched ASP requests passed");
        } finally {
          server.closeAllConnections();
          await new Promise(resolve => server.close(resolve));
        }
      `], {
        cwd: deployment,
        env: { ...env, PRIVACY_CHAIN_IDS: "31337", PRIVACY_ENABLE_MAINNET_APP: "false" },
        encoding: "utf8",
        timeout: 15_000,
        stdio: "pipe",
      });
      expect(output).toContain("Native serverless health, pools, networks and batched ASP requests passed");
    } finally {
      rmSync(deployment, { recursive: true, force: true });
    }
  });
});
