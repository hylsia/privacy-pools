import fs from "node:fs";
import path from "node:path";
import { hashFile } from "./ceremony-policy";
import {
  assertReleasePackage,
  safeFile,
  type ReleaseFile,
  type ReleasePackage,
} from "./release-policy";

export async function listFiles(
  base: string,
  relative = ""
): Promise<Record<string, ReleaseFile>> {
  const files: Record<string, ReleaseFile> = {};
  for (const name of fs.readdirSync(path.join(base, relative)).sort()) {
    const key = relative ? relative + "/" + name : name;
    const file = path.join(base, key);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error("Symlinked release input");
    if (stat.isDirectory()) Object.assign(files, await listFiles(base, key));
    else if (stat.isFile())
      files[key] = { sha256: await hashFile(file), bytes: stat.size };
    else throw new Error("Non-file release input");
  }
  return files;
}

export async function verifyReleaseDirectory(
  base: string
): Promise<ReleasePackage> {
  const raw = JSON.parse(
    fs.readFileSync(safeFile(base, "release.json"), "utf8")
  );
  assertReleasePackage(raw);
  for (const [name, expected] of Object.entries(raw.identity.files)) {
    const file = safeFile(base, name);
    if (
      fs.statSync(file).size !== expected.bytes ||
      (await hashFile(file)) !== expected.sha256
    )
      throw new Error("Release integrity mismatch: " + name);
  }
  // Forge compiles every source in these trees, including unimported Solidity. Bind the complete inventory.
  for (const directory of [
    "solidity/src",
    "solidity/script",
    "solidity/lib",
    "artifacts",
  ])
    for (const name of Object.keys(await listFiles(base, directory))) {
      if (name !== "artifacts/manifest.json" && !raw.identity.files[name])
        throw new Error("Unbound release source: " + name);
    }
  const manifest = safeFile(base, "artifacts/manifest.json");
  if ((await hashFile(manifest)) !== raw.artifactManifestSha256)
    throw new Error("Release artifact manifest drift");
  const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (
    m.protocol !== raw.protocol ||
    m.releaseId !== raw.releaseId ||
    m.status !== raw.status ||
    m.productionReady !== false
  )
    throw new Error("Artifact manifest release mismatch");
  for (const name of ["withdraw", "commitment"]) {
    if (m.circuits?.[name]?.nPublic !== (name === "withdraw" ? 6 : 4))
      throw new Error("Wrong release signal layout");
    for (const kind of ["wasm", "zkey", "vkey"]) {
      const filename = name + "." + (kind === "vkey" ? "vkey.json" : kind);
      const entry = m.circuits[name][kind];
      const pin = raw.identity.files["artifacts/" + filename];
      if (
        entry?.path !== filename ||
        entry.sha256 !== pin.sha256 ||
        entry.bytes !== pin.bytes
      )
        throw new Error("Unbound proving artifact");
    }
  }
  return raw;
}
