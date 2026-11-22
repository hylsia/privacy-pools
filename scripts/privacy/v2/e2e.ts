/** Local v2 app/server acceptance. Own Anvil only; no public RPC, owner key or mainnet transaction path. */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  zeroAddress,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvilKey } from "../anvilKeys";
import { forgeChildEnv } from "../deploymentRecords";
import { anvil } from "../../../shared/privacy/chains";
import {
  buildStateTree,
  fetchPoolEvents,
  privateBalance,
} from "../../../shared/privacy/indexer";
import { computeContext, computeScope } from "../../../shared/privacy/context";
import { protocolRuntime } from "../../../shared/privacy/runtime";
import { V2_PROTOCOL, V2_ETH_PROTOCOL } from "../../../shared/privacy/protocols";
import { V2_DEV_KEY_PINS } from "../../../shared/privacy/v2/devKeyPins";
import { proveWithdraw, proveCommitment } from "../../../shared/privacy/prover";
import { buildAssociationProof } from "../../../shared/privacy/associationSet";
import { createArtifactLoader } from "../../../client/src/privacy/artifacts";
import { publishWalletRoot } from "../../../client/src/privacy/publishRoot";
import type { PoolRef } from "../../../client/src/privacy/config";
import { networkById } from "../../../shared/privacy/networks";
import { loadV2DevelopmentAssets } from "../../../server/privacy/devArtifacts";

import { DEPLOYMENTS } from "../../../shared/privacy/deployments";
import { contentId } from "./release-policy";
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== "--native-eth-local")) throw new Error("Only --native-eth-local is supported");
const nativeETH = args[0] === "--native-eth-local";
const protocol = nativeETH ? V2_ETH_PROTOCOL : V2_PROTOCOL;
const previousLocalRecord = DEPLOYMENTS[31337];
const root = path.resolve(import.meta.dirname, "../../..");
const runtime = protocolRuntime(protocol);
const port = Number(process.env.PRIVACY_V2_E2E_PORT ?? 8550);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid local v2 E2E port");
const rpc = `http://127.0.0.1:${port}`;
const client = createPublicClient({
  chain: anvil,
  transport: http(rpc, { retryCount: 0, timeout: 3000 }),
});
const wallet = (i: number) =>
  createWalletClient({
    chain: anvil,
    account: privateKeyToAccount(anvilKey(i)),
    transport: http(rpc),
  });
const check = (ok: unknown, message: string) => {
  if (!ok) throw new Error(message);
};
const record = `deployments/local/v2-e2e-${port}.json`;
const recordPath = path.join(root, "contracts", record);

async function main() {
  check(
    !fs.existsSync(recordPath),
    "A v2 E2E record already exists; reconcile it before retrying"
  );
  try {
    await client.getChainId();
    throw new Error("V2 E2E port already in use; choose an unused port");
  } catch (error) {
    if ((error as Error).message.includes("already in use")) throw error;
  }
  const child = spawn(
    "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "31337",
      "--silent",
    ],
    { stdio: "ignore" }
  );
  try {
    let started = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        started = (await client.getChainId()) === 31337;
        if (started) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    check(started && child.exitCode === null, "Local Anvil did not start");
    const env = forgeChildEnv(process.env);
    delete env.PRIVACY_DEPLOYER_PRIVATE_KEY;
    env.PRIVACY_V2_NATIVE_ETH_LOCAL = nativeETH ? "true" : "false";
    env.PRIVACY_ASP_POSTMAN = wallet(1).account.address;
    env.PRIVACY_V2_DEV_RECORD = record;
    execFileSync(
      "forge",
      [
        "script",
        "--root",
        path.join(root, "contracts"),
        "script/DeployV2Dev.s.sol:DeployV2Dev",
        "--rpc-url",
        rpc,
        "--unlocked",
        "--sender",
        wallet(0).account.address,
        "--broadcast",
        "--slow",
      ],
      {
        cwd: path.join(root, "contracts"),
        env,
        stdio: "pipe",
        maxBuffer: 1 << 24,
      }
    );
    const deployment = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    const pool = deployment.pool as Address;
    check(
      deployment.protocol === protocol &&
        (await client.getCode({ address: pool })),
      "V2 local deployment failed"
    );
    const scope = computeScope(pool, 31337);
    check(BigInt(deployment.scope) === scope, "Local v2 scope mismatch");
    if (nativeETH) {
      // In-memory metadata for this owned local chain only. Development keys remain explicitly local.
      DEPLOYMENTS[31337] = {
        chainId: 31337, protocol, pool, scope: scope.toString(), deployBlock: "0", minDepositWei: "0",
        owner: wallet(0).account.address, aspPostman: wallet(1).account.address,
        withdrawVerifier: deployment.withdrawVerifier, commitmentVerifier: deployment.commitmentVerifier,
        releaseId: contentId({ purpose: "LOCAL-DEVELOPMENT-ONLY", protocol, pool }),
        artifactManifestSha256: contentId({ purpose: "LOCAL-DEVELOPMENT-ONLY", keys: V2_DEV_KEY_PINS }),
        vkeySha256: { ...V2_DEV_KEY_PINS },
      };
    }
    Object.assign(process.env, {
      PRIVACY_PROTOCOL: protocol,
      PRIVACY_CHAIN_IDS: "31337",
      PRIVACY_RPC_URL_31337: rpc,
      PRIVACY_POOL_ADDRESS_31337: pool,
      PRIVACY_RELAYER_PRIVATE_KEY_31337: anvilKey(2),
      PRIVACY_ASP_POSTMAN_PRIVATE_KEY_31337: nativeETH ? "" : anvilKey(1),
      PRIVACY_ASP_AUTO_PUBLISH_SECONDS: "0",
      PRIVACY_ASP_INCLUSION_DELAY_SECONDS_31337: "0",
    });
    delete process.env.PRIVACY_ASP_EXCLUSIONS_FILE;
    delete process.env.PRIVACY_ASP_EXCLUSIONS_JSON;
    if (nativeETH) delete process.env.PRIVACY_ASP_POSTMAN_PRIVATE_KEY;
    const asp = await import("../../../server/privacy/asp");
    const relayer = await import("../../../server/privacy/relayer");
    const seed = runtime.generateSeed();
    const file = JSON.stringify(
      await runtime.encryptSeed(seed, "v2-local-e2e-password")
    );
    const restored = await runtime.decryptSeed(
      runtime.parseBackup(file),
      "v2-local-e2e-password"
    );
    const keys = runtime.deriveMasterKeys(restored);
    const prepared = runtime.prepareDeposit(keys, scope, -1);
    check(
      prepared.recoveryNonce !== undefined,
      "V2 deposit is missing recovery nonce"
    );
    // Two independent wallets intentionally submit the same pair: neither deposit may consume the other's nullifier.
    for (const depositor of [wallet(3), wallet(4)]) {
      const hash = await depositor.writeContract({
        address: pool,
        abi: runtime.abi,
        functionName: "deposit",
        args: [prepared.precommitment, prepared.recoveryNonce!],
        value: parseEther("1"),
      });
      check(
        (await client.waitForTransactionReceipt({ hash })).status === "success",
        "V2 deposit failed"
      );
    }
    if (nativeETH) {
      const unsigned = await asp.publishBehindRoots();
      check(unsigned.results.some(result => result.status === "no_key"), "Native local server unexpectedly has a publisher signing key");
      const snapshot = await asp.getScreenedSet({ chainId: 31337, fresh: true });
      const published = await publishWalletRoot({
        ref: { chainId: 31337, pool, protocol, network: networkById(31337)! } as PoolRef,
        events: snapshot.events, screening: asp.screeningOf(snapshot), client,
        getWallet: async () => wallet(1),
      });
      check(published && (await client.waitForTransactionReceipt({ hash: published })).status === "success", "Wallet-signed native eligibility publication failed");
      await asp.getScreenedSet({ chainId: 31337, fresh: true });
    } else {
      const publication = await asp.publishBehindRoots();
      check(publication.results.some(r => r.status === "published"), "V2 publisher did not publish");
    }
    const events = await fetchPoolEvents(
      client,
      pool,
      0n,
      await client.getBlockNumber({ cacheTime: 0 }),
      { protocol }
    );
    const notes = runtime.discover(keys, scope, events).notes;
    check(
      notes.length === 2 && notes[0].nullifierHash !== notes[1].nullifierHash,
      "V2 duplicated deposits share a spend nullifier"
    );
    const state = buildStateTree(events);
    const association = await buildAssociationProof({
      events,
      label: notes[0].label,
      currentRoot: await client.readContract({
        address: pool,
        abi: runtime.abi,
        functionName: "currentASPRoot",
      }),
      isKnownRoot: root =>
        client.readContract({
          address: pool,
          abi: runtime.abi,
          functionName: "isKnownASPRoot",
          args: [root],
        }),
    });
    const stateProof = state.proof(notes[0].leafIndex);
    const next = runtime.nextSecrets(keys, scope, notes[0]);
    const quote = (await relayer.getQuotes()).quotes[0];
    check(quote.available, "V2 relayer is unavailable");
    if (!quote.available) throw new Error("No v2 quote");
    const amount = parseEther("0.4");
    const minimumFee = BigInt(quote.minFeeWei);
    const fee =
      (amount * BigInt(quote.feeBps)) / 10000n > minimumFee
        ? (amount * BigInt(quote.feeBps)) / 10000n
        : minimumFee;
    const withdrawal = {
      recipient: wallet(5).account.address,
      relayer: quote.relayer!,
      fee,
      deadline: BigInt(quote.expiresAt),
    };
    const bundle = loadV2DevelopmentAssets(root);
    const loader = createArtifactLoader(
      { protocol: V2_PROTOCOL, vkeySha256: V2_DEV_KEY_PINS },
      async url => {
        if (url === "/zk-v2-dev/manifest.json")
          return Response.json(bundle.manifest);
        const bytes = bundle.files.get(url.slice("/zk-v2-dev/".length));
        return bytes
          ? new Response(bytes.slice())
          : new Response(null, { status: 404 });
      }
    );
    const proof = await proveWithdraw(
      {
        withdrawnValue: amount,
        stateRoot: state.root,
        ASPRoot: association.root,
        context: computeContext(scope, withdrawal),
        label: notes[0].label,
        existingValue: notes[0].value,
        existingNullifier: notes[0].nullifier,
        existingSecret: notes[0].secret,
        newNullifier: next.nullifier,
        newSecret: next.secret,
        stateSiblings: stateProof.siblings,
        stateIndex: stateProof.index,
        ASPSiblings: association.siblings,
        ASPIndex: association.index,
      },
      await loader.loadArtifacts("withdraw")
    );
    const submitted = await relayer.relayWithdrawal({
      chainId: 31337,
      withdrawal,
      proof: proof.proof,
      pubSignals: proof.publicSignals,
    });
    check(
      (await client.waitForTransactionReceipt({ hash: submitted.txHash }))
        .status === "success",
      "V2 relayed withdrawal failed"
    );
    const untouched = notes[1];
    const exit = await proveCommitment(
      {
        value: untouched.value,
        label: untouched.label,
        nullifier: untouched.nullifier,
        secret: untouched.secret,
      },
      await loader.loadArtifacts("commitment")
    );
    const hash = await wallet(4).writeContract({
      address: pool,
      abi: runtime.abi,
      functionName: "ragequit",
      args: [
        exit.proof,
        exit.publicSignals as [bigint, bigint, bigint, bigint],
      ],
    });
    check(
      (await client.waitForTransactionReceipt({ hash })).status === "success",
      "Second duplicated deposit could not ragequit"
    );
    const finalEvents = await fetchPoolEvents(
      client,
      pool,
      0n,
      await client.getBlockNumber({ cacheTime: 0 }),
      { protocol }
    );
    const recovered = runtime.discover(
      runtime.deriveMasterKeys(
        await runtime.decryptSeed(
          runtime.parseBackup(file),
          "v2-local-e2e-password"
        )
      ),
      scope,
      finalEvents
    );
    check(
      privateBalance(recovered.notes) === parseEther("0.6"),
      "V2 restored change balance mismatch"
    );
    check(
      (await client.getBalance({ address: pool })) === parseEther("0.6"),
      "V2 pool liabilities mismatch"
    );
    if (nativeETH) {
      const change = recovered.notes.find(note => !note.spent && note.value > 0n)!;
      check(change, "Native change note was not recovered");
      const tree = buildStateTree(finalEvents);
      const membership = await buildAssociationProof({ events: finalEvents, label: change.label,
        currentRoot: await client.readContract({ address: pool, abi: runtime.abi, functionName: "currentASPRoot" }),
        isKnownRoot: root => client.readContract({ address: pool, abi: runtime.abi, functionName: "isKnownASPRoot", args: [root] }),
      });
      const leaf = tree.proof(change.leafIndex), secrets = runtime.nextSecrets(keys, scope, change);
      const request = { recipient: wallet(6).account.address, relayer: zeroAddress, fee: 0n, deadline: (await client.getBlock()).timestamp + 600n };
      const before = await client.getBalance({ address: request.recipient });
      const selfProof = await proveWithdraw({ withdrawnValue: change.value, stateRoot: tree.root, ASPRoot: membership.root,
        context: computeContext(scope, request), label: change.label, existingValue: change.value,
        existingNullifier: change.nullifier, existingSecret: change.secret, newNullifier: secrets.nullifier, newSecret: secrets.secret,
        stateSiblings: leaf.siblings, stateIndex: leaf.index, ASPSiblings: membership.siblings, ASPIndex: membership.index,
      }, await loader.loadArtifacts("withdraw"));
      const paid = await wallet(7).writeContract({ address: pool, abi: runtime.abi, functionName: "withdraw",
        args: [request, selfProof.proof, selfProof.publicSignals as [bigint, bigint, bigint, bigint, bigint, bigint]],
      });
      check((await client.waitForTransactionReceipt({ hash: paid })).status === "success", "Native self-paid withdrawal failed");
      check(await client.getBalance({ address: request.recipient }) === before + change.value, "Native self-paid recipient amount mismatch");
      check(await client.getBalance({ address: pool }) === 0n, "Native self-paid exit left an incorrect liability");
    }
    console.log(
      (nativeETH ? "Native ETH v2 LOCAL DEVELOPMENT E2E passed: " : "V2 local E2E passed: ") + " deploy, encrypted backup, duplicated deposits, publisher, real relayed proof, ragequit, restored change balance." + (nativeETH ? " Wallet-only ASP publication and self-paid withdrawal passed without a server publisher key." : "") + " No public chain was contacted."
    );
  } finally {
    if (previousLocalRecord) DEPLOYMENTS[31337] = previousLocalRecord;
    else delete DEPLOYMENTS[31337];
    child.kill("SIGTERM");
    if (fs.existsSync(recordPath)) fs.unlinkSync(recordPath);
  }
}
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(
      error instanceof Error ? error.message : "V2 local E2E failed"
    );
    process.exit(1);
  });
