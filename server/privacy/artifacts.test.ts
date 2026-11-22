import { createHash } from "node:crypto";
import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createArtifactLoader } from "../../client/src/privacy/artifacts";
import { PROTOCOL_VERSION } from "../../shared/privacy/constants";
import {
  V2_PROTOCOL,
  type PrivacyProtocol,
} from "../../shared/privacy/protocols";
import { DEPLOYMENTS } from "../../shared/privacy/deployments";

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const text = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
function published(protocol: PrivacyProtocol = PROTOCOL_VERSION) {
  const files = new Map<string, Uint8Array>();
  const base = protocol === V2_PROTOCOL ? "/zk-v2-dev" : "/zk";
  const circuits = Object.fromEntries(
    (["withdraw", "commitment"] as const).map(name => {
      const nPublic = name === "withdraw" ? 6 : 4;
      const blobs = {
        wasm: text([protocol, name, "wasm"]),
        zkey: text([protocol, name, "zkey"]),
        vkey: text({ protocol: "groth16", curve: "bn128", nPublic }),
      };
      const entry = Object.fromEntries(
        Object.entries(blobs).map(([kind, bytes]) => {
          const path = name + "." + (kind === "vkey" ? "vkey.json" : kind);
          files.set(base + "/" + path, bytes);
          return [kind, { path, bytes: bytes.length, sha256: sha(bytes) }];
        })
      );
      return [name, { ...entry, nPublic }];
    })
  );
  const manifest = {
    protocol,
    builtAt: "2026-11-21T00:00:00Z",
    ...(protocol === V2_PROTOCOL
      ? { status: "development", productionReady: false }
      : {}),
    circuits,
  } as any;
  const fetcher = vi.fn(async (url: string, _options?: RequestInit) => {
    if (url === base + "/manifest.json") return Response.json(manifest);
    const bytes = files.get(url);
    return bytes
      ? new Response(bytes.slice())
      : new Response(null, { status: 404 });
  });
  vi.stubGlobal("fetch", fetcher);
  const pins = {
    withdraw: manifest.circuits.withdraw.vkey.sha256,
    commitment: manifest.circuits.commitment.vkey.sha256,
  };
  return { manifest, files, fetcher, base, pins };
}
afterEach(() => vi.unstubAllGlobals());

describe("protocol-bound proving-artifact downloads", () => {
  it("loads the actual frozen v1 artifacts with the recorded testnet key pins", async () => {
    const loader = createArtifactLoader(
      { protocol: PROTOCOL_VERSION, vkeySha256: DEPLOYMENTS[46630].vkeySha256 },
      async path => {
        if (!/^\/zk\/[a-z.]+$/.test(path))
          throw new Error("Unexpected local artifact path");
        return new Response(
          new Uint8Array(fs.readFileSync("client/public" + path))
        );
      }
    );
    const artifacts = await loader.loadArtifacts("withdraw");
    const manifest = JSON.parse(
      fs.readFileSync("client/public/zk/manifest.json", "utf8")
    );
    expect(sha(artifacts.wasm)).toBe(manifest.circuits.withdraw.wasm.sha256);
    expect(sha(artifacts.zkey)).toBe(manifest.circuits.withdraw.zkey.sha256);
  });

  it("loads matching pinned bytes once and omits credentials on every request", async () => {
    const pub = published();
    const progress = vi.fn();
    const loader = createArtifactLoader({
      protocol: PROTOCOL_VERSION,
      vkeySha256: pub.pins,
    });
    const [a, b] = await Promise.all([
      loader.loadArtifacts("withdraw", progress),
      loader.loadArtifacts("withdraw"),
    ]);
    expect(a).toBe(b);
    expect(a.wasm).toEqual(pub.files.get("/zk/withdraw.wasm"));
    expect(pub.fetcher).toHaveBeenCalledTimes(4); // manifest, pinned verification key, wasm, zkey
    expect(
      pub.fetcher.mock.calls.every(
        ([, options]) => options?.credentials === "omit"
      )
    ).toBe(true);
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ file: "withdraw.wasm", total: a.wasm.length })
    );
  });

  it("refuses a different protocol before downloading any key or proving file", async () => {
    const pub = published();
    pub.manifest.protocol = V2_PROTOCOL;
    await expect(
      createArtifactLoader({ protocol: PROTOCOL_VERSION }).loadArtifacts(
        "withdraw"
      )
    ).rejects.toThrow("protocol does not match");
    expect(pub.fetcher).toHaveBeenCalledTimes(1);
  });

  it("isolates v2 downloads to their own namespace and requires an explicit development manifest", async () => {
    const pub = published(V2_PROTOCOL);
    const loader = createArtifactLoader({
      protocol: V2_PROTOCOL,
      vkeySha256: pub.pins,
    });
    await loader.loadArtifacts("commitment");
    expect(
      pub.fetcher.mock.calls.every(([url]) => url.startsWith("/zk-v2-dev/"))
    ).toBe(true);
    pub.manifest.productionReady = true;
    const rejected = createArtifactLoader({
      protocol: V2_PROTOCOL,
      vkeySha256: pub.pins,
    });
    await expect(rejected.loadManifest()).rejects.toThrow("development-only");
  });

  it("requires explicit v2 verification-key pins before making any request", () => {
    const pub = published(V2_PROTOCOL);
    expect(() => createArtifactLoader({ protocol: V2_PROTOCOL })).toThrow(
      "explicit verification-key pins"
    );
    expect(pub.fetcher).not.toHaveBeenCalled();
  });

  it("rejects a changed deployment key pin before fetching artifact bytes", async () => {
    const pub = published();
    await expect(
      createArtifactLoader({
        protocol: PROTOCOL_VERSION,
        vkeySha256: { ...pub.pins, withdraw: "f".repeat(64) },
      }).loadArtifacts("withdraw")
    ).rejects.toThrow("pool deployment");
    expect(pub.fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    "../withdraw.wasm",
    "https://example.com/withdraw.wasm",
    "/zk/withdraw.wasm",
  ])("rejects unsafe artifact paths: %s", async path => {
    const pub = published();
    pub.manifest.circuits.withdraw.wasm.path = path;
    await expect(
      createArtifactLoader({ protocol: PROTOCOL_VERSION }).loadArtifacts(
        "withdraw"
      )
    ).rejects.toThrow("unsafe");
    expect(pub.fetcher).toHaveBeenCalledTimes(1);
  });

  it("checks the actual verification key before fetching the wasm and zkey", async () => {
    const pub = published();
    const original = pub.files.get("/zk/withdraw.vkey.json")!;
    pub.files.set(
      "/zk/withdraw.vkey.json",
      original.map(byte => byte ^ 1)
    );
    await expect(
      createArtifactLoader({
        protocol: PROTOCOL_VERSION,
        vkeySha256: pub.pins,
      }).loadArtifacts("withdraw")
    ).rejects.toThrow("Integrity check");
    expect(pub.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["wasm", "zkey"])(
    "rejects a corrupt %s and allows a corrected download to retry",
    async kind => {
      const pub = published();
      const path = "/zk/withdraw." + kind;
      const original = pub.files.get(path)!;
      pub.files.set(
        path,
        original.map(byte => byte ^ 1)
      );
      const loader = createArtifactLoader({ protocol: PROTOCOL_VERSION });
      await expect(loader.loadArtifacts("withdraw")).rejects.toThrow(
        "Integrity check"
      );
      pub.files.set(path, original);
      await expect(loader.loadArtifacts("withdraw")).resolves.toHaveProperty(
        "wasm"
      );
    }
  );

  it("bounds streamed file sizes and rejects truncated files", async () => {
    for (const delta of [-1, 1]) {
      const pub = published();
      pub.manifest.circuits.withdraw.wasm.bytes += delta;
      await expect(
        createArtifactLoader({ protocol: PROTOCOL_VERSION }).loadArtifacts(
          "withdraw"
        )
      ).rejects.toThrow(/byte length/);
    }
  });

  it("rejects malformed manifests, oversized entries and wrong public signal counts", async () => {
    const changes = [
      (m: any) => {
        m.circuits.withdraw.nPublic = 4;
      },
      (m: any) => {
        m.circuits.withdraw.wasm.bytes = 2 ** 40;
      },
      (m: any) => {
        m.circuits.withdraw.zkey.sha256 = "bad";
      },
    ];
    for (const change of changes) {
      const pub = published();
      change(pub.manifest);
      await expect(
        createArtifactLoader({ protocol: PROTOCOL_VERSION }).loadArtifacts(
          "withdraw"
        )
      ).rejects.toThrow();
      expect(pub.fetcher).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects a wrong verification-key layout even if its manifest digest matches", async () => {
    const pub = published();
    const key = text({ protocol: "groth16", curve: "bn128", nPublic: 4 });
    pub.files.set("/zk/withdraw.vkey.json", key);
    pub.manifest.circuits.withdraw.vkey = {
      path: "withdraw.vkey.json",
      bytes: key.length,
      sha256: sha(key),
    };
    await expect(
      createArtifactLoader({ protocol: PROTOCOL_VERSION }).loadArtifacts(
        "withdraw"
      )
    ).rejects.toThrow("verification-key protocol");
    expect(pub.fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not keep a rejected manifest cached across a corrected retry", async () => {
    const pub = published();
    const loader = createArtifactLoader({ protocol: PROTOCOL_VERSION });
    pub.manifest.protocol = V2_PROTOCOL;
    await expect(loader.loadArtifacts("withdraw")).rejects.toThrow();
    pub.manifest.protocol = PROTOCOL_VERSION;
    await expect(loader.loadArtifacts("withdraw")).resolves.toHaveProperty(
      "zkey"
    );
  });

  it("copies key pins so later caller mutations cannot change the loader's binding", async () => {
    const pub = published();
    const pins = { ...pub.pins };
    const loader = createArtifactLoader({
      protocol: PROTOCOL_VERSION,
      vkeySha256: pins,
    });
    pins.withdraw = "f".repeat(64);
    await expect(loader.loadArtifacts("withdraw")).resolves.toHaveProperty(
      "wasm"
    );
  });

  it("does not allow validated manifest paths to be changed after the protocol check", async () => {
    published();
    const loader = createArtifactLoader({ protocol: PROTOCOL_VERSION });
    const manifest = await loader.loadManifest();
    expect(() => {
      manifest.circuits.withdraw.wasm.path = "../changed.wasm";
    }).toThrow();
    await expect(loader.loadArtifacts("withdraw")).resolves.toHaveProperty(
      "wasm"
    );
  });
});
