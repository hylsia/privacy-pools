/** Deployment-key diagnostics: only public address and per-network balances leave this process. */
import "./loadDeploymentEnv";
import { createPublicClient, formatEther, http } from "viem";
import { MAINNET_TARGETS } from "../../shared/privacy/mainnetTargets";
import { urlHost } from "../../shared/privacy/networks";
import { readEnvDeployer } from "./env-deployer";
import { selectMainnetTarget } from "./mainnet-target";

async function main() {
  const { args, target } = selectMainnetTarget(process.argv.slice(2));
  if (args.some(arg => arg !== "--all" && arg !== "--offline"))
    throw new Error(
      "Usage: npm run zk:mainnet:wallet -- [--network ethereum-mainnet|robinhood-mainnet] [--all] [--offline]"
    );
  const { address } = readEnvDeployer(name => process.env[name]);
  const reports = await Promise.all(
    (args.includes("--all") ? Object.values(MAINNET_TARGETS) : [target]).map(
      async selected => {
        const rpc =
          process.env[`PRIVACY_DEPLOY_RPC_URL_${selected.chainId}`]?.trim() ||
          process.env[`PRIVACY_RPC_URL_${selected.chainId}`]?.trim() ||
          selected.chain.rpcUrls.default.http[0];
        const report = {
          network: selected.slug,
          expectedChainId: selected.chainId,
          address,
          rpcHost: urlHost(rpc),
          rpcCheck: "not_checked",
          observedChainId: null as number | null,
          latestBlock: null as string | null,
          balanceETH: null as string | null,
          pendingBalanceETH: null as string | null,
        };
        if (!args.includes("--offline")) {
          try {
            const client = createPublicClient({
              transport: http(rpc, { retryCount: 0, timeout: 15000 }),
            });
            report.observedChainId = await client.getChainId();
            if (report.observedChainId !== selected.chainId)
              report.rpcCheck = "wrong_chain";
            else {
              const balance = await client.getBalance({ address });
              report.rpcCheck = "ok";
              report.balanceETH = formatEther(balance);
              try {
                report.latestBlock = (await client.getBlockNumber()).toString();
              } catch {}
              try {
                report.pendingBalanceETH = formatEther(
                  await client.getBalance({ address, blockTag: "pending" })
                );
              } catch {}
            }
          } catch {
            report.rpcCheck = "unavailable";
          }
          if (report.rpcCheck !== "ok") process.exitCode = 1;
        }
        return report;
      }
    )
  );
  console.log(
    JSON.stringify(
      {
        keyVariable: "DEPLOY_PRIVATE_KEY_MAINNET",
        valid: true,
        signedTransactions: 0,
        networks: reports,
      },
      null,
      2
    )
  );
}
main().catch(() => {
  console.error(
    "Wallet check failed. DEPLOY_PRIVATE_KEY_MAINNET must contain a valid private key; no key value was printed and no transaction was signed."
  );
  process.exitCode = 1;
});
