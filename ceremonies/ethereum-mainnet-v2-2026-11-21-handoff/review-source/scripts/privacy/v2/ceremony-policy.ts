/** Provenance and filesystem policy for an unapproved phase-2 preparation workspace. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// Published by snarkjs for the public, prepared power-16 transcript. This is BLAKE2b-512.
export const PUBLIC_PHASE1 = Object.freeze({
  url: "https://circom.info/powersOfTau28_hez_final_16.ptau",
  provenance: "https://github.com/iden3/snarkjs#7-prepare-phase-2",
  blake2b512:
    "6a6277a2f74e1073601b4f9fed6e1e55226917efb0f0db8a07d98ab01df1ccf43eb0e8c3159432acd4960e2f29fe84a4198501fa54c8dad9e43297453efec125",
});

export function assertPublicPhase1(digest: string) {
  if (digest !== PUBLIC_PHASE1.blake2b512)
    throw new Error(
      "Phase-1 transcript differs from the pinned public ceremony. Local development ptau is not accepted."
    );
}

export async function hashFile(file: string, algorithm = "sha256") {
  const hash = createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

/** Refuse existing workspaces and symlinks, including symlinked ancestors. No force option. */
export function reserveCeremonyWorkspace(root: string, requested: string) {
  const base = path.join(path.resolve(root), "ceremonies");
  const out = path.resolve(root, requested);
  const relative = path.relative(base, out);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Output must be a new directory under ceremonies/.");
  let current = base;
  for (const part of ["", ...relative.split(path.sep)]) {
    current = part ? path.join(current, part) : current;
    if (!fs.existsSync(current)) {
      // lstat also catches a dangling symlink that existsSync would miss.
      try {
        fs.lstatSync(current);
        throw new Error("Symlinked output is forbidden.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      fs.mkdirSync(current);
    } else {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error("Output ancestors must be real directories.");
      if (current === out)
        throw new Error(
          "Ceremony output already exists; choose a new directory."
        );
    }
  }
  return out;
}
