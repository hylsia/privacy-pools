/** One LOCAL OPERATOR contribution per circuit, never a claim of independent participants or final production keys. */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { zKey } from "snarkjs";
import { readContributions } from "../scripts/privacy/v2/read-contributions.ts";
import { assertPublicPhase1, hashFile } from "../scripts/privacy/v2/ceremony-policy.ts";

const root = path.resolve(import.meta.dirname, "..");
const base = path.join(root, "ceremonies/robinhood-mainnet-v2-2026-11-21-challenges");
const out = path.join(root, "ceremonies/ethereum-mainnet-v2-2026-11-21-operator");
const phase1Run = JSON.parse(fs.readFileSync(path.join(base, "phase1-verification-run.json"), "utf8"));
const phase1Log = fs.readFileSync(path.join(root, phase1Run.log), "utf8").replace(/\x1b\[[0-9;]*m/g, "");
if (phase1Run.status !== "passed" || phase1Run.exitCode !== 0 || !phase1Log.includes("Powers of Tau Ok!")) throw new Error("Full phase-1 verification must finish successfully before this contribution");
const ptau = path.join(base, "phase1.ptau");
assertPublicPhase1(await hashFile(ptau, "blake2b512"));
const originalManifestSha256 = await hashFile(path.join(base, "manifest.json"));
if(originalManifestSha256 !== "a9d41a1c509d2753e7fbbef58e0b1585d964ff062da328068327f2d2722f5ce5") throw new Error("Unexpected source ceremony manifest");
const setup = JSON.parse(fs.readFileSync(path.join(base, "manifest.json"), "utf8"));
for(const name of ["withdraw", "commitment"]) {
  const input = path.join(base,`${name}/${name}_0000.zkey`);
  const meta = await readContributions(input);
  if(meta.contributions.length !== 0) throw new Error("Unexpected initial contribution chain");
  for(const relative of [`${name}/${name}_0000.zkey`,`${name}/${name}.r1cs`]) {
    if(await hashFile(path.join(base,relative)) !== setup.circuits[name].files[relative].sha256) throw new Error("Source ceremony artifact changed");
  }
}
fs.mkdirSync(out);
const record = {
  schemaVersion:1,
  targetChainId:1,
  targetProtocol:"hylsia-pp-v2-eth",
  purpose:"One local operator contribution, awaiting independent participants and finalization",
  createdAt:new Date().toISOString(),
  originalCeremonyManifestSha256:originalManifestSha256,
  phase1Sha256:await hashFile(ptau),
  phase1VerificationLogSha256:await hashFile(path.join(root, phase1Run.log)),
  productionReady:false,
  reviewedRelease:false,
  broadcastAllowed:false,
  independentlyReviewed:false,
  independentParticipantCountEstablished:false,
  circuits:{},
};
const manifest = path.join(out,"operator-contribution.json");
const save=()=>fs.writeFileSync(manifest,JSON.stringify(record,null,2)+"\n");
save();
for(const name of ["withdraw", "commitment"]) {
  const input = path.join(base,`${name}/${name}_0000.zkey`);
  const output = path.join(out,`${name}_0001.zkey`);
  const random = randomBytes(64);
  let entropy = random.toString("hex");
  random.fill(0);
  console.log(`Creating a single LOCAL OPERATOR contribution: ${name}`);
  const contribution = await zKey.contribute(input,output,"hylsia-local-operator-2026-11-21",entropy);
  entropy = undefined;
  const log = path.join(out,`${name}-verify.log`);
  const fd = fs.openSync(log,"wx");
  try {
    execFileSync(process.execPath,[path.join(root,"node_modules/snarkjs/build/cli.cjs"),"zkey","verify",path.join(base,`${name}/${name}.r1cs`),ptau,output],{cwd:root,env:{PATH:process.env.PATH ?? ""},stdio:["ignore",fd,fd]});
  } finally {fs.closeSync(fd);}
  const meta = await readContributions(output);
  if(meta.contributions.length !== 1 || meta.contributions[0].type !== 0) throw new Error("Unexpected operator contribution transcript");
  const challenge = path.join(out,`${name}_0001.mpcparams`);
  execFileSync(process.execPath,[path.join(root,"node_modules/snarkjs/build/cli.cjs"),"zkey","export","bellman",output,challenge],{cwd:root,env:{PATH:process.env.PATH ?? ""},stdio:"ignore"});
  record.circuits[name]={
    key:path.basename(output),bytes:fs.statSync(output).size,sha256:await hashFile(output),
    contributionHash:Buffer.from(contribution).toString("hex"),
    contributionCount:1,
    transcript:meta.contributions[0],
    verifiedAgainstR1csAndPhase1:true,
    verificationLog:path.basename(log),verificationLogSha256:await hashFile(log),
    bellmanChallenge:path.basename(challenge),bellmanChallengeBytes:fs.statSync(challenge).size,bellmanChallengeSha256:await hashFile(challenge),
  };
  save();
  console.log(`${name}: one local operator contribution verified; not a final key`);
}
record.finishedAt=new Date().toISOString();
save();
console.log(JSON.stringify({operatorManifest:path.relative(root,manifest),sha256:await hashFile(manifest),productionReady:false,broadcastAllowed:false}));
process.exit(0);
