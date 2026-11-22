/** Validate user-supplied paths before parsing a ceremony or opening any proving key. */
import fs from "node:fs";
import path from "node:path";

export function resolveReleaseInputs(
  root: string,
  ceremonyArg: string,
  withdrawArg: string,
  commitmentArg: string
) {
  const ceremony = path.resolve(root, ceremonyArg);
  const finals = {
    withdraw: path.resolve(root, withdrawArg),
    commitment: path.resolve(root, commitmentArg),
  };
  const issues: string[] = [];
  const existsAs = (file: string, kind: "file" | "directory") => {
    try {
      const stat = fs.statSync(file);
      return kind === "file" ? stat.isFile() : stat.isDirectory();
    } catch (error) {
      if (
        ["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code ?? ""
        )
      )
        return false;
      throw error;
    }
  };
  if (!existsAs(ceremony, "directory"))
    issues.push(`--ceremony: directory does not exist: ${ceremonyArg}`);
  else if (!existsAs(path.join(ceremony, "manifest.json"), "file"))
    issues.push(`--ceremony: manifest.json is missing from ${ceremonyArg}`);
  if (!existsAs(finals.withdraw, "file"))
    issues.push(
      `--withdraw-zkey: final key file does not exist: ${withdrawArg}`
    );
  if (!existsAs(finals.commitment, "file"))
    issues.push(
      `--commitment-zkey: final key file does not exist: ${commitmentArg}`
    );
  if (issues.length)
    throw new Error(
      [
        "Release inputs are incomplete:",
        ...issues.map(issue => "  " + issue),
        "Use actual file paths; documentation examples are placeholders.",
        "Final zkeys must come from the completed phase-2 ceremony. Initial *_0000.zkey and development keys cannot replace them.",
        "See docs/privacy-pools/native-eth-v2.md. No output directory was created.",
      ].join("\n")
    );
  return { ceremony: fs.realpathSync(ceremony), finals };
}
