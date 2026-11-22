/** Inspect the actual zkey contribution section, rather than trusting an operator's JSON count. */
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { CeremonyContribution } from "./release-policy";

export async function readContributions(
  file: string
): Promise<{
  nPublic: number;
  circuitHash: string;
  contributions: CeremonyContribution[];
}> {
  const root = path.resolve(import.meta.dirname, "../../..");
  const requireSnark = createRequire(
    path.join(root, "node_modules/snarkjs/package.json")
  );
  const { readBinFile } = requireSnark("@iden3/binfileutils");
  const utils = await import(
    pathToFileURL(path.join(root, "node_modules/snarkjs/src/zkey_utils.js"))
      .href
  );
  const { fd, sections } = await readBinFile(file, "zkey", 2);
  let header: any;
  try {
    header = await utils.readHeader(fd, sections, false, {
      singleThread: true,
    });
    if (header.protocol !== "groth16")
      throw new Error("Expected Groth16 final key");
    const mpc = await utils.readMPCParams(fd, header.curve, sections);
    return {
      nPublic: header.nPublic,
      circuitHash: Buffer.from(mpc.csHash).toString("hex"),
      contributions: mpc.contributions.map((c: any) => ({
        type: c.type,
        transcript: Buffer.from(c.transcript).toString("hex"),
        ...(c.name ? { name: c.name } : {}),
        ...(c.type === 1
          ? {
              beaconHash: Buffer.from(c.beaconHash).toString("hex"),
              numIterationsExp: c.numIterationsExp,
            }
          : {}),
      })),
    };
  } finally {
    await fd.close();
    await header?.curve?.terminate();
  }
}
