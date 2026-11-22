/** User-directed Ethereum finalization. Both local contributions are from ONE operator, never independent participants. */
import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createPublicClient, http } from "viem";
import { zKey } from "snarkjs";
import { ethereumMainnet } from "../../../shared/privacy/chains";
import { V2_ETH_PROTOCOL } from "../../../shared/privacy/protocols";
import { hashFile, reserveCeremonyWorkspace } from "./ceremony-policy";
import { verifiedPhase1Evidence } from "./verified-phase1";
import { readContributions } from "./read-contributions";
import { checkContributionChain } from "./release-policy";

const root = path.resolve(import.meta.dirname, "../../..");
const source = path.join(
  root,
  "ceremonies/ethereum-mainnet-v2-2026-11-21-operator"
);
const original = path.join(
  root,
  "ceremonies/robinhood-mainnet-v2-2026-11-21-challenges"
);
const client = createPublicClient({
  chain: ethereumMainnet,
  transport: http(undefined, { retryCount: 0, timeout: 15000 }),
});

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--out")
    throw new Error(
      "Usage: finalize-single-operator.ts --out ceremonies/<new-session>"
    );
  const ptau = path.join(original, "phase1.ptau");
  await verifiedPhase1Evidence(root, ptau);
  const prior = JSON.parse(
    fs.readFileSync(path.join(source, "operator-contribution.json"), "utf8")
  );
  for (const name of ["withdraw", "commitment"] as const) {
    const input = path.join(source, `${name}_0001.zkey`);
    if (
      (await hashFile(input)) !== prior.circuits[name].sha256 ||
      (await readContributions(input)).contributions.length !== 1
    )
      throw new Error("Initial local operator response changed");
  }
  const out = reserveCeremonyWorkspace(root, args[1]);
  const record: Record<string, any> = {
    schemaVersion: 1,
    protocol: V2_ETH_PROTOCOL,
    targetChainId: 1,
    trustModel: "single-operator",
    independentParticipants: 0,
    independentReview: false,
    authorization:
      "Project owner instructed Ethereum mainnet deployment without independent ceremony contributors.",
    productionReady: false,
    reviewedRelease: false,
    createdAt: new Date().toISOString(),
    status: "contributing",
    circuits: {},
  };
  const manifest = path.join(out, "single-operator-finalization.json");
  const save = () =>
    fs.writeFileSync(manifest, JSON.stringify(record, null, 2) + "\n");
  save();
  const snark = path.join(root, "node_modules/snarkjs/build/cli.cjs");
  function verify(name: string, key: string, stage: string) {
    const fd = fs.openSync(path.join(out, `${name}-${stage}.log`), "wx");
    try {
      execFileSync(
        process.execPath,
        [
          snark,
          "zkey",
          "verify",
          path.join(original, `${name}/${name}.r1cs`),
          ptau,
          key,
        ],
        {
          cwd: root,
          env: { PATH: process.env.PATH ?? "" },
          stdio: ["ignore", fd, fd],
        }
      );
    } finally {
      fs.closeSync(fd);
    }
  }
  for (const name of ["withdraw", "commitment"] as const) {
    console.log(
      "Creating a second contribution from the SAME local operator: " + name
    );
    const random = randomBytes(64);
    let entropy: string | undefined = random.toString("hex");
    random.fill(0);
    const key = path.join(out, `${name}_0002.zkey`);
    await zKey.contribute(
      path.join(source, `${name}_0001.zkey`),
      key,
      "hylsia-SAME-LOCAL-OPERATOR-second-contribution",
      entropy
    );
    entropy = undefined;
    verify(name, key, "response-verify");
    record.circuits[name] = {
      response: path.basename(key),
      responseSha256: await hashFile(key),
      operatorCustodies: 1,
    };
    save();
  }
  if ((await client.getChainId()) !== 1)
    throw new Error("Beacon RPC is not Ethereum mainnet");
  const head = await client.getBlockNumber();
  record.beaconPlan = {
    committedAt: new Date().toISOString(),
    observedHead: head.toString(),
    blockNumber: (head + 3n).toString(),
    confirmations: 2,
    derivation:
      "SHA256(hylsia-eth-single-operator-v1:blockHash:withdrawResponseSha256:commitmentResponseSha256)",
  };
  record.status = "awaiting-precommitted-future-Ethereum-block";
  save();
  console.log(
    "Awaiting precommitted Ethereum beacon block " +
      record.beaconPlan.blockNumber
  );
  const target = BigInt(record.beaconPlan.blockNumber);
  while ((await client.getBlockNumber({ cacheTime: 0 })) < target + 2n)
    await new Promise(resolve => setTimeout(resolve, 5000));
  const block = await client.getBlock({ blockNumber: target });
  if (!block.hash) throw new Error("Beacon block has no hash");
  const beacon = createHash("sha256")
    .update(
      [
        "hylsia-eth-single-operator-v1",
        block.hash,
        record.circuits.withdraw.responseSha256,
        record.circuits.commitment.responseSha256,
      ].join(":")
    )
    .digest("hex");
  record.beacon = {
    blockNumber: target.toString(),
    blockHash: block.hash,
    value: beacon,
    iterationsExponent: 10,
  };
  record.status = "applying-final-beacon";
  save();
  for (const name of ["withdraw", "commitment"] as const) {
    console.log("Applying and verifying the final public beacon: " + name);
    const final = path.join(out, `${name}_final.zkey`);
    const result = await zKey.beacon(
      path.join(out, `${name}_0002.zkey`),
      final,
      "hylsia-single-operator-Ethereum-final-beacon",
      beacon,
      10
    );
    if (!result) throw new Error("Final beacon generation failed");
    verify(name, final, "final-verify");
    const transcript = await readContributions(final);
    checkContributionChain(transcript.contributions);
    if (
      transcript.contributions.length !== 3 ||
      transcript.contributions.at(-1)?.beaconHash !== beacon
    )
      throw new Error("Unexpected final single-operator transcript");
    Object.assign(record.circuits[name], {
      final: path.basename(final),
      finalSha256: await hashFile(final),
      transcript,
      verifiedAgainstR1csAndPhase1: true,
    });
    save();
  }
  const canonical = await client.getBlock({ blockNumber: target });
  if (canonical.hash !== block.hash)
    throw new Error("Beacon block changed; finalization is not accepted");
  record.status = "finalized-single-operator";
  record.finishedAt = new Date().toISOString();
  save();
  console.log(
    JSON.stringify({
      manifest: path.relative(root, manifest),
      sha256: await hashFile(manifest),
      trustModel: "single-operator",
      independentReview: false,
    })
  );
}
main()
  .then(() => process.exit(0))
  .catch(() => {
    console.error(
      "Single-operator finalization did not complete. Inspect its public status/log files; no mainnet transaction was sent."
    );
    process.exit(1);
  });
