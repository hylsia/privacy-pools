import { useMemo, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import type { RelayerQuotesAnswer } from "@shared/privacy/api";
import { listRelayers, remoteRelayerClient, selectedRelayer, subscribeRelayers, type RelayerEntry } from "./relayers";

/** The relayer list, re-read on every change (snapshot by value: the entries are rebuilt on each read). */
export function useRelayerList(): RelayerEntry[] {
  const key = useSyncExternalStore(
    subscribeRelayers,
    () => listRelayers().map((r) => r.id).join("\n"),
    () => "self",
  );
  return useMemo(() => listRelayers(), [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function useSelectedRelayer(): RelayerEntry {
  const id = useSyncExternalStore(subscribeRelayers, () => selectedRelayer().id, () => "self");
  return useMemo(() => selectedRelayer(), [id]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** One relayer's quotes (input-less). `enabled` false asks nothing. */
export function useQuotesOf(relayer: RelayerEntry, enabled = true) {
  const utils = trpc.useUtils();
  return useQuery<RelayerQuotesAnswer>({
    queryKey: ["hylsia-relayer-quotes", relayer.id],
    queryFn: () => (relayer.origin ? remoteRelayerClient(relayer.origin).privacy.relayer.quote.query() : utils.privacy.relayer.quote.fetch()),
    staleTime: 30_000,
    retry: false,
    enabled,
  });
}

/** The chosen relayer's quotes: what the Withdraw form shows and what a relayed withdrawal uses. */
export function useRelayerQuotes() {
  return useQuotesOf(useSelectedRelayer());
}
