/**
 * privacy.* — the public tRPC surface of the relayer, the association-set publisher and the pools explorer, for every
 * served network (Robinhood Chain Testnet; local anvil chains in development).
 *
 * Every query that covers all pools takes no network input and answers the same for every visitor; a pool whose
 * chain fails is listed under `unavailable` without failing the call. Only poolDetail (the public page being viewed),
 * relayer.submit and relayer.status (inherent: the withdrawal is public on its chain seconds later) name a chain.
 * The output types are in shared/privacy/api.ts.
 */
import { TRPCError } from "@trpc/server";
import { isAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import type {
  AssociationSetsAnswer,
  ASPStatusAnswer,
  NetworksAnswer,
  PoolActivityAnswer,
  PoolDetailAnswer,
  PoolsAnswer,
  PublishAnswer,
  RelayerQuotesAnswer,
  RelayStatusAnswer,
  RelaySubmitAnswer,
} from "../../shared/privacy/api";
import { SNARK_SCALAR_FIELD } from "../../shared/privacy/constants";
import { networkById } from "../../shared/privacy/networks";
import { publicProcedure, router } from "../_core/trpc";
import { describeError, getASPStatuses, getPublicAssociationSets, publishBehindRoots } from "./asp";
import { getNetworks, getPoolActivity, getPoolDetail, listPools, POOL_INTERVALS, type PoolInterval } from "./pools";
import { getQuotes, getRelayStatus, relayWithdrawal } from "./relayer";

const fieldElement = z.bigint().nonnegative().refine((v) => v < SNARK_SCALAR_FIELD, "not a field element");
const address = z.string().refine((v): v is Address => isAddress(v), "invalid address");
const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((v) => v as Hex);
const chainId = z.number().int().positive();
const interval = z.enum(Object.keys(POOL_INTERVALS) as [PoolInterval, ...PoolInterval[]]);
const g1 = z.tuple([z.bigint(), z.bigint()]);
const proofSchema = z.object({ pA: g1, pB: z.tuple([g1, g1]), pC: g1 });

export const privacyRouter = router({
  /** Every served network's public configuration and live pool state, in registry order. The landing's request. */
  networks: publicProcedure.query((): Promise<NetworksAnswer> => getNetworks()),

  /** Pools explorer: per-pool public statistics, one entry per served pool. */
  pools: publicProcedure
    .input(z.object({ interval: interval.default("24h") }).optional())
    .query(({ input }): Promise<PoolsAnswer> => listPools(input?.interval ?? "24h")),

  /** One pool, by chain and address: time series, full public activity, ASP root history, privacy-health heuristics. */
  poolDetail: publicProcedure
    .input(z.object({ chainId, pool: address, interval: interval.default("7d") }))
    .query(({ input }): Promise<PoolDetailAnswer> => getPoolDetail(input.chainId, input.pool, input.interval)),

  /**
   * Public deposits/exits with amounts and times, one list per pool. Parameterless and the same for every caller:
   * the vault's privacy check reads its active pool's entry on the device.
   */
  poolActivity: publicProcedure.query((): Promise<PoolActivityAnswer> => getPoolActivity()),

  /**
   * Association set (screening policy v1). There is deliberately no per-label proof or per-label state here: asking
   * for the proof or the state of one label tells the server which deposit is about to be spent. Devices rebuild every
   * root's list from their own public events and its recipe cid, build the proof themselves
   * (shared/privacy/associationSet.ts) and work out whether a deposit is waiting or excluded on the device.
   */
  asp: router({
    /**
     * Every pool's status with its screening block (policy, snapshot, the root on-chain as the server checks it,
     * rootDue, the excluded deposits with reason codes): input-less, the same for every visitor.
     */
    status: publicProcedure.query((): Promise<ASPStatusAnswer> => getASPStatuses()),
    /** Every pool's current on-chain root with its cid (and its list), the same for every caller. */
    set: publicProcedure.query((): Promise<AssociationSetsAnswer> => getPublicAssociationSets()),
    /**
     * Idempotent, label-free and input-less: publishes on every served pool whose root is due (postman key configured
     * and able to pay for one publish, publishing not paused), so the request does not say which network a withdrawal
     * will be on.
     */
    publish: publicProcedure.mutation((): Promise<PublishAnswer> => publishBehindRoots()),
  }),

  relayer: router({
    /** One quote per served network (available: false with relayer_unfunded when the relayer cannot pay for one). */
    quote: publicProcedure.query((): Promise<RelayerQuotesAnswer> => getQuotes()),
    submit: publicProcedure
      .input(
        z.object({
          chainId,
          withdrawal: z.object({ recipient: address, relayer: address, fee: z.bigint().nonnegative(), deadline: z.bigint().nonnegative() }),
          proof: proofSchema,
          pubSignals: z.array(fieldElement).length(6),
        }),
      )
      .mutation(async ({ input }): Promise<RelaySubmitAnswer> => {
        try {
          return await relayWithdrawal(input);
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          const name = networkById(input.chainId)?.name ?? `network ${input.chainId}`;
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Relay failed on ${name}: ${describeError(err)}` });
        }
      }),
    status: publicProcedure
      .input(z.object({ chainId, txHash }))
      .query(({ input }): Promise<RelayStatusAnswer> => getRelayStatus(input.txHash, input.chainId)),
  }),
});
