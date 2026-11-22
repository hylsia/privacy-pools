/**
 * Protocol-bound proving-artifact loader. Every byte is checked against the manifest;
 * recorded pools additionally pin the verification key to their deployment.
 */
import { PROTOCOL_VERSION } from "@shared/privacy/constants";
import {
  protocolDefinition,
  V2_ETH_PROTOCOL,
  isV2Protocol,
  type PrivacyProtocol,
} from "@shared/privacy/protocols";
import type { ProvingArtifacts } from "@shared/privacy/prover";

export type CircuitName = "withdraw" | "commitment";
type ArtifactKind = "wasm" | "zkey" | "vkey";
interface FileEntry {
  path: string;
  sha256: string;
  bytes: number;
}
interface ManifestEntry {
  wasm: FileEntry;
  zkey: FileEntry;
  vkey: FileEntry;
  nPublic: number;
}
export interface ZkManifest {
  protocol: PrivacyProtocol;
  builtAt: string;
  status?: "development" | "ceremony-verified";
  productionReady?: false;
  releaseId?: string;
  circuits: Record<CircuitName, ManifestEntry>;
}
export interface ArtifactBinding {
  protocol: PrivacyProtocol;
  vkeySha256?: Readonly<Record<CircuitName, string>>;
  releaseId?: string;
  manifestSha256?: string;
}
export interface LoadProgress {
  file: string;
  loaded: number;
  total: number;
}

const NO_COOKIES = { credentials: "omit" } as const;
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const PUBLIC_SIGNALS: Record<CircuitName, number> = {
  withdraw: 6,
  commitment: 4,
};
const DIGEST = /^[0-9a-f]{64}$/i;

function parseManifest(raw: unknown, binding: ArtifactBinding): ZkManifest {
  if (!raw || typeof raw !== "object")
    throw new Error("Malformed proving-artifact manifest");
  const manifest = raw as Record<string, unknown>;
  if (manifest.protocol !== binding.protocol)
    throw new Error(
      "Proving-artifact protocol does not match the selected pool"
    );
  const definition = protocolDefinition(binding.protocol);
  if (
    binding.protocol === V2_ETH_PROTOCOL &&
    (manifest.status !== "ceremony-verified" ||
      manifest.productionReady !== false ||
      manifest.releaseId !== binding.releaseId)
  )
    throw new Error(
      "Native ETH v2 requires the exact ceremony-verified release manifest"
    );
  if (
    definition.candidate &&
    (manifest.status !== "development" || manifest.productionReady !== false)
  ) {
    throw new Error(
      "V2 candidate artifacts must be explicitly marked development-only"
    );
  }
  if (
    typeof manifest.builtAt !== "string" ||
    !manifest.circuits ||
    typeof manifest.circuits !== "object"
  ) {
    throw new Error("Malformed proving-artifact manifest");
  }
  const circuits = manifest.circuits as Record<string, unknown>;
  const checked = {} as Record<CircuitName, ManifestEntry>;
  for (const name of ["withdraw", "commitment"] as const) {
    const entry = circuits[name] as Record<string, unknown> | undefined;
    if (!entry || entry.nPublic !== PUBLIC_SIGNALS[name])
      throw new Error("Unexpected circuit public-signal layout");
    const files = {} as Record<ArtifactKind, FileEntry>;
    for (const kind of ["wasm", "zkey", "vkey"] as const) {
      const file = entry[kind] as Record<string, unknown> | undefined;
      const expectedPath = name + "." + (kind === "vkey" ? "vkey.json" : kind);
      if (
        !file ||
        file.path !== expectedPath ||
        typeof file.sha256 !== "string" ||
        !DIGEST.test(file.sha256) ||
        typeof file.bytes !== "number" ||
        !Number.isSafeInteger(file.bytes) ||
        file.bytes < 1 ||
        file.bytes > MAX_ARTIFACT_BYTES
      ) {
        throw new Error("Malformed or unsafe proving-artifact entry");
      }
      files[kind] = Object.freeze({
        path: expectedPath,
        sha256: file.sha256.toLowerCase(),
        bytes: file.bytes,
      });
    }
    const pin = binding.vkeySha256?.[name];
    if (pin && files.vkey.sha256 !== pin)
      throw new Error("Verification key does not match the pool deployment");
    checked[name] = Object.freeze({ ...files, nPublic: PUBLIC_SIGNALS[name] });
  }
  return Object.freeze({
    protocol: binding.protocol,
    builtAt: manifest.builtAt,
    circuits: Object.freeze(checked),
    ...(definition.candidate
      ? { status: "development" as const, productionReady: false as const }
      : {}),
    ...(binding.protocol === V2_ETH_PROTOCOL
      ? {
          status: "ceremony-verified" as const,
          productionReady: false as const,
          releaseId: binding.releaseId,
        }
      : {}),
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function readPinnedManifest(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new Error("Artifact manifest body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 65536) {
        await reader.cancel().catch(() => {});
        throw new Error("Artifact manifest exceeds size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** A loader's manifest and cache belong to one immutable protocol/key binding. */
export function createArtifactLoader(
  expected: ArtifactBinding,
  fetchFile: (path: string, options?: RequestInit) => Promise<Response> = (
    path,
    options
  ) => fetch(path, options)
) {
  const definition = protocolDefinition(expected.protocol);
  const pins = expected.vkeySha256;
  if (isV2Protocol(expected.protocol) && !pins)
    throw new Error(
      "V2 candidate artifacts require explicit verification-key pins"
    );
  if (
    expected.protocol === V2_ETH_PROTOCOL &&
    (!expected.releaseId ||
      !/^[0-9a-f]{64}$/.test(expected.releaseId) ||
      !expected.manifestSha256 ||
      !/^[0-9a-f]{64}$/.test(expected.manifestSha256))
  )
    throw new Error(
      "Native ETH v2 requires a release ID and exact manifest SHA-256 pin"
    );
  if (
    pins &&
    (typeof pins.withdraw !== "string" ||
      typeof pins.commitment !== "string" ||
      !DIGEST.test(pins.withdraw) ||
      !DIGEST.test(pins.commitment))
  )
    throw new Error("Invalid deployment verification-key pins");
  const binding: ArtifactBinding = {
    protocol: expected.protocol,
    ...(expected.protocol === V2_ETH_PROTOCOL
      ? {
          releaseId: expected.releaseId,
          manifestSha256: expected.manifestSha256,
        }
      : {}),
    ...(pins
      ? {
          vkeySha256: Object.freeze({
            withdraw: pins.withdraw.toLowerCase(),
            commitment: pins.commitment.toLowerCase(),
          }),
        }
      : {}),
  };
  const base =
    definition.artifactBase +
    (binding.releaseId ? "/" + binding.releaseId : "");
  const cache = new Map<CircuitName, Promise<ProvingArtifacts>>();
  const verificationKeys = new Map<CircuitName, Promise<unknown>>();
  let manifestPromise: Promise<ZkManifest> | null = null;

  function loadManifest(): Promise<ZkManifest> {
    if (!manifestPromise) {
      const pending = (async () => {
        const response = await fetchFile(base + "/manifest.json", {
          cache: "no-cache",
          ...NO_COOKIES,
        });
        if (!response.ok)
          throw new Error(
            "Proving artifacts are not published for " +
              binding.protocol +
              ". Restore the matching frozen artifacts."
          );
        if (binding.manifestSha256) {
          const bytes = await readPinnedManifest(response);
          if (
            bytes.byteLength > 65536 ||
            (await sha256Hex(bytes)) !== binding.manifestSha256
          )
            throw new Error("Artifact manifest integrity check failed");
          return parseManifest(
            JSON.parse(new TextDecoder().decode(bytes)),
            binding
          );
        }
        return parseManifest(await response.json(), binding);
      })();
      manifestPromise = pending;
      pending.catch(() => {
        if (manifestPromise === pending) manifestPromise = null;
      });
    }
    return manifestPromise;
  }

  async function fetchVerified(
    entry: FileEntry,
    onProgress?: (p: LoadProgress) => void
  ): Promise<Uint8Array> {
    const response = await fetchFile(base + "/" + entry.path, NO_COOKIES);
    if (!response.ok || !response.body)
      throw new Error(
        "Failed to download " + entry.path + " (" + response.status + ")"
      );
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.byteLength;
        if (loaded > entry.bytes) {
          await reader.cancel().catch(() => {});
          throw new Error(
            "Artifact exceeds its declared byte length: " + entry.path
          );
        }
        chunks.push(value);
        onProgress?.({ file: entry.path, loaded, total: entry.bytes });
      }
    } finally {
      reader.releaseLock();
    }
    if (loaded !== entry.bytes)
      throw new Error(
        "Artifact byte length does not match manifest: " + entry.path
      );
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if ((await sha256Hex(bytes)) !== entry.sha256)
      throw new Error("Integrity check failed for " + entry.path);
    return bytes;
  }

  function loadVerificationKey(name: CircuitName): Promise<unknown> {
    let pending = verificationKeys.get(name);
    if (!pending) {
      pending = (async () => {
        const manifest = await loadManifest();
        const bytes = await fetchVerified(manifest.circuits[name].vkey);
        const key = JSON.parse(new TextDecoder().decode(bytes));
        if (
          !key ||
          key.protocol !== "groth16" ||
          key.curve !== "bn128" ||
          key.nPublic !== PUBLIC_SIGNALS[name]
        ) {
          throw new Error(
            "Unexpected verification-key protocol or public-signal layout"
          );
        }
        return key;
      })();
      verificationKeys.set(name, pending);
      pending.catch(() => verificationKeys.delete(name));
    }
    return pending;
  }

  function loadArtifacts(
    name: CircuitName,
    onProgress?: (p: LoadProgress) => void
  ): Promise<ProvingArtifacts> {
    let pending = cache.get(name);
    if (!pending) {
      pending = (async () => {
        const manifest = await loadManifest();
        // Check the pinned key's actual bytes before loading any proving material.
        await loadVerificationKey(name);
        const entry = manifest.circuits[name];
        const [wasm, zkey] = await Promise.all([
          fetchVerified(entry.wasm, onProgress),
          fetchVerified(entry.zkey, onProgress),
        ]);
        return { wasm, zkey };
      })();
      cache.set(name, pending);
      pending.catch(() => cache.delete(name));
    }
    return pending;
  }
  return { loadManifest, loadArtifacts, loadVerificationKey };
}

const loaders = new Map<string, ReturnType<typeof createArtifactLoader>>();
function loader(binding: ArtifactBinding) {
  const key = JSON.stringify([
    binding.protocol,
    binding.vkeySha256?.withdraw,
    binding.vkeySha256?.commitment,
    binding.releaseId,
    binding.manifestSha256,
  ]);
  let result = loaders.get(key);
  if (!result) {
    result = createArtifactLoader(binding);
    loaders.set(key, result);
  }
  return result;
}
const V1: ArtifactBinding = Object.freeze({ protocol: PROTOCOL_VERSION });

/** Existing callers remain explicitly v1 unless they supply a different binding. */
export const loadManifest = (
  binding: ArtifactBinding = V1
): Promise<ZkManifest> => loader(binding).loadManifest();
export const loadVerificationKey = (
  name: CircuitName,
  binding: ArtifactBinding = V1
): Promise<unknown> => loader(binding).loadVerificationKey(name);
export const loadArtifacts = (
  name: CircuitName,
  onProgress?: (p: LoadProgress) => void,
  binding: ArtifactBinding = V1
): Promise<ProvingArtifacts> => loader(binding).loadArtifacts(name, onProgress);
