import { useState } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { ETHEREUM_APPLICATION_RELEASE } from "@shared/privacy/applicationProfiles";
import { usePrivacy } from "@/privacy/PrivacyProvider";
import { useASPStatusOf } from "./Screening";

export default function WalletPublisher() {
  const { activePool, busy, publishEligibilityRoot } = usePrivacy();
  const { address } = useAccount();
  const { screening } = useASPStatusOf(activePool);
  const [message, setMessage] = useState("");
  if (
    activePool?.chainId !== 1 ||
    address?.toLowerCase() !==
      ETHEREUM_APPLICATION_RELEASE.aspPostman.toLowerCase()
  )
    return null;
  return (
    <section
      className="rounded-xl border border-primary/30 bg-primary/5 p-4"
      aria-label="ASP publisher controls"
    >
      <h2 className="text-sm font-semibold">ASP publisher</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Publish the verified eligibility set with your wallet. Each publication
        requires your approval and Ethereum gas. This action does not send your
        publisher key to the server.
      </p>
      {screening && (
        <p className="mt-2 text-xs text-muted-foreground">
          {screening.snapshot.memberCount.toLocaleString("en-US")} eligible
          deposits · Snapshot block {screening.snapshot.asOfBlock}
        </p>
      )}
      <Button
        className="mt-3"
        size="sm"
        disabled={
          busy || !screening?.rootDue || screening.walletPublishable !== true
        }
        onClick={async () => {
          setMessage("");
          try {
            const hash = await publishEligibilityRoot();
            setMessage(
              hash
                ? "Eligibility root confirmed on Ethereum."
                : "The root is already current or has no eligible deposits."
            );
          } catch {
            setMessage(
              "Publication did not complete. Check your wallet, wait for pending transactions, then sync before trying again."
            );
          }
        }}
      >
        {busy
          ? "Waiting for the current transaction…"
          : "Publish eligibility root"}
      </Button>
      {!screening?.rootDue && (
        <p className="mt-2 text-xs text-muted-foreground">
          No eligible root update is due.
        </p>
      )}
      {message && (
        <p role="status" className="mt-2 text-xs">
          {message}
        </p>
      )}
    </section>
  );
}
