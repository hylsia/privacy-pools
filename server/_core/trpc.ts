import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
// Every Hylsia procedure is public: there is no sign-in and no session (readme.txt 9.1).
export const publicProcedure = t.procedure;
