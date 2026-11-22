/** Publish only the exact, user-authorized final-key Ethereum artifact bundle. Never signs transactions. */
import fs from "node:fs";
import path from "node:path";
import { verifyReleaseDirectory } from "./release-files";
import { hashFile } from "./ceremony-policy";
import {
  ETHEREUM_APPLICATION_RELEASE,
  isAuthorizedApplicationRelease,
} from "../../../shared/privacy/applicationProfiles";

const root = path.resolve(import.meta.dirname, "../../..");
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--release")
    throw new Error(
      "Usage: stage-application.ts --release <final-release-directory>"
    );
  const directory = fs.realpathSync(path.resolve(root, args[1]));
  const release = await verifyReleaseDirectory(directory);
  const record = ETHEREUM_APPLICATION_RELEASE;
  if (
    !isAuthorizedApplicationRelease(record) ||
    release.identity.targetChainId !== 1 ||
    release.releaseId !== record.releaseId ||
    release.artifactManifestSha256 !== record.artifactManifestSha256
  )
    throw new Error(
      "Application activation requires the exact authorized Ethereum final-key package"
    );
  const target = path.join(root, "client/public/zk-v2-eth", release.releaseId);
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(path.join(directory, "artifacts"))) {
    const source = path.join(directory, "artifacts", name),
      output = path.join(target, name);
    if (
      !fs.statSync(source).isFile() ||
      !/^(manifest\.json|(?:withdraw|commitment)\.(?:wasm|zkey|vkey\.json))$/.test(
        name
      )
    )
      throw new Error("Unexpected release artifact");
    if (fs.existsSync(output)) {
      if (
        fs.lstatSync(output).isSymbolicLink() ||
        (await hashFile(output)) !== (await hashFile(source))
      )
        throw new Error("Refusing to overwrite different staged artifacts");
    } else fs.copyFileSync(source, output, fs.constants.COPYFILE_EXCL);
  }
  if (
    (await hashFile(path.join(target, "manifest.json"))) !==
    record.artifactManifestSha256
  )
    throw new Error("Staged manifest mismatch");
  console.log(
    `Staged exact final-key Ethereum application artifacts at ${path.relative(root, target)}. No transaction sent; no independent review claimed.`
  );
}
main().catch(error => {
  console.error(
    error instanceof Error ? error.message : "Artifact staging failed"
  );
  process.exitCode = 1;
});
