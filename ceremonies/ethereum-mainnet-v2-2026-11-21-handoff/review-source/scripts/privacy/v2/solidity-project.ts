import fs from "node:fs";
import path from "node:path";

/** Snapshot deployment sources and dependencies beside the exact generated verifier sources. */
export function writeSolidityProject(root: string, project: string) {
  const copy = (source: string, relative: string) => {
    const target = path.join(project, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
  };
  for (const file of [
    "src/v2/PrivacyPoolV2.sol",
    "src/v2/PrivacyPoolV2ETH.sol",
    "src/MerkleTreeWithHistory.sol",
    "src/interfaces/IVerifiers.sol",
  ])
    copy(path.join(root, "contracts", file), file);
  copy(
    path.join(root, "scripts/privacy/v2/templates/DeployV2ETH.s.sol"),
    "script/DeployV2ETH.s.sol"
  );
  for (const name of ["PoseidonT3", "PoseidonT4"])
    copy(
      path.join(root, `node_modules/poseidon-solidity/${name}.sol`),
      `lib/poseidon-solidity/${name}.sol`
    );
  fs.cpSync(
    path.join(root, "contracts/lib/forge-std/src"),
    path.join(project, "lib/forge-std"),
    { recursive: true, dereference: false }
  );
  fs.writeFileSync(
    path.join(project, "foundry.toml"),
    '[profile.default]\nsrc="src"\nscript="script"\nsolc_version="0.8.28"\nevm_version="shanghai"\noptimizer=true\noptimizer_runs=200\nremappings=["forge-std/=lib/forge-std/", "poseidon-solidity/=lib/poseidon-solidity/"]\n',
    { flag: "wx" }
  );
}
