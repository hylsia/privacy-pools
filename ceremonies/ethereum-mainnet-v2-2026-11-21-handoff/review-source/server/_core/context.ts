import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

/**
 * The tRPC context: the request and the response, nothing else. There is no session, so the server never reads a
 * cookie or ties a request to a person (readme.txt 9.1).
 */
export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  return {
    req: opts.req,
    res: opts.res,
  };
}
