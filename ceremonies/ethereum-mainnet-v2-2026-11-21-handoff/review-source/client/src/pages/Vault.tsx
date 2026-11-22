/**
 * My vault (/pools/vault): the privacy vault inside the Pools dashboard, laid
 * out as a workspace:
 *   - pool strip: which pool on which network (its name; a switcher only in a
 *     build with several networks), the vault and sync state, the active
 *     pool's figures at a glance
 *   - action panel: deposit and withdraw, after the vault setup
 *     (1 create or unlock, 2 verify the backup, 3 deposit); both forms carry the
 *     privacy guidance (standard amounts, pool size, the privacy check)
 *   - details card: notes, activity, backup & recovery, privacy & trust
 * With several networks one vault covers them all and acts on one at a time
 * (the active pool, kept in memory only; a #network=<slug> link chooses it
 * once). Before the pool is deployed the same reading order says so plainly and points
 * at what already works without it. /privacy and /pools/simulator redirect here.
 */
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useSearch } from "wouter";
import PoolsShell from "@/components/pools/PoolsShell";
import ActivityPanel from "@/components/privacy/ActivityPanel";
import DepositPanel from "@/components/privacy/DepositPanel";
import GetStarted from "@/components/privacy/GetStarted";
import NotesPanel from "@/components/privacy/NotesPanel";
import PoolHeader from "@/components/privacy/PoolHeader";
import PrivacyNotice from "@/components/privacy/PrivacyNotice";
import { BACKUP_STEP_ID, BackupStep, VaultBackup, VaultSetup } from "@/components/privacy/VaultPanel";
import { useActivePool, useVaultPoolActivity } from "@/components/privacy/PrivacyCheck";
import WithdrawPanel from "@/components/privacy/WithdrawPanel";
import { CARD, DeploymentPending, INSET, TabCount, TabPanel, UnderlineTabs } from "@/components/privacy/ui";
import { usePrivacy } from "@/privacy/PrivacyProvider";

type SideTab = "deposit" | "withdraw";
type DetailTab = "notes" | "activity" | "backup" | "trust";

/** Facts from the vault, deposit and withdraw copy, one line each. */
const HOW = [
  { title: "Create vault", text: "One random seed, created on this device and stored here only in encrypted form." },
  { title: "Verify backup", text: "Export the encrypted backup file and verify it locally; only then are deposits enabled." },
  { title: "Deposit", text: "The pool records a commitment to your note. The form shows the pool size first and suggests standard amounts, with how many others used each." },
  {
    title: "Withdraw",
    text: "A zero-knowledge proof made on this device hides which deposit is spent; a relayer pays the gas and sends the funds to a fresh address. A privacy check first estimates your anonymity set and how long to wait.",
  },
];

// ─── deployed pool ────────────────────────────────────────────────────────────

function ActionPanel({ tab, setTab }: { tab: SideTab; setTab: (t: SideTab) => void;
}) {
  const { vault } = usePrivacy();
  const ref = useActivePool();
  const open = vault.status === "unlocked";

  return (
    <section className={`${CARD} @container flex min-w-0 flex-col gap-5 p-4 sm:p-6`} aria-label="Vault actions">
      <UnderlineTabs
        id="vault-action"
        size="lg"
        className="-mt-1"
        label="Pool action"
        value={tab}
        onChange={setTab}
        items={[
          { key: "deposit", label: "Deposit", disabled: !open },
          { key: "withdraw", label: "Withdraw", disabled: !open },
        ]}
        trailing={open ? "testnet ETH only" : vault.status === "none" ? "create a vault first" : "unlock first"}
      />
      {open ? (
        <TabPanel id="vault-action" value={tab}>
          {tab === "withdraw" ? (
            <WithdrawPanel />
          ) : vault.backupVerified ? (
            <DepositPanel />
          ) : (
            <BackupStep />
          )}
        </TabPanel>
      ) : (
        <>
          {/* The first-time steps precede setup on every screen size. */}
          {vault.status === "none" && ref && (
            <GetStarted network={ref.network} chainId={ref.chainId} />
          )}
          <VaultSetup />
        </>
      )}
    </section>
  );
}

function DetailsCard({ onShowBackupStep }: { onShowBackupStep: () => void }) {
  const { vault, notes, activity } = usePrivacy();
  const [tab, setTab] = useState<DetailTab>("notes");
  return (
    <section className={`${CARD} @container flex min-w-0 flex-col`} aria-label="Notes, activity and backup">
      <UnderlineTabs
        id="vault-details"
        className="px-4 pt-1"
        label="Vault details"
        value={tab}
        onChange={setTab}
        items={[
          { key: "notes", label: (
              <>Notes<TabCount n={vault.status === "unlocked" ? notes.list.length : 0} /></>
            ),
          },
          // this device's activity log is shown only while the vault is unlocked (and Forget deletes it)
          { key: "activity", label: (
              <>Activity<TabCount n={vault.status === "unlocked" ? activity.length : 0} /></>
            ),
          },
          {
            key: "backup",
            label: (
              <>
                <span className="@md:hidden">Backup</span>
                <span className="hidden @md:inline">Backup &amp; recovery</span>
              </>
            ),
          },
          {
            key: "trust",
            label: (
              <>
                <span className="@md:hidden">Privacy</span>
                <span className="hidden @md:inline">Privacy &amp; trust</span>
              </>
            ),
          },
        ]}
      />
      <TabPanel id="vault-details" value={tab} className="flex flex-1 flex-col p-4">
        {tab === "notes" ? (
          <NotesPanel />
        ) : tab === "activity" ? (
          <ActivityPanel />
        ) : tab === "backup" ? (
          <VaultBackup onShowBackupStep={onShowBackupStep} />
        ) : (
          <PrivacyNotice />
        )}
      </TabPanel>
    </section>
  );
}

/** The action panel precedes the details card at every viewport width. */
function Workspace({ intent }: { intent: SideTab }) {
  const { vault } = usePrivacy();
  // The public activity list (every deposit's amount and block time) for the forms' privacy guidance: fetched when
  // the vault opens and then once a minute, the same for every visitor whatever the tab, the notes or the input.
  useVaultPoolActivity();
  // A ?action=withdraw link is honoured only once the backup is verified: until then the Deposit tab holds
  // step 2 (export, then verify), which matters most right after a vault is created.
  const [tab, setTab] = useState<SideTab>(vault.status === "unlocked" && !vault.backupVerified ? "deposit" : intent);

  // As on the old page: the moment the vault opens (created, unlocked or restored) the action shows,
  // Deposit unless the link asked for Withdraw and the backup is already verified.
  const was = useRef(vault.status);
  useEffect(() => {
    if (vault.status === "unlocked" && was.current !== "unlocked") setTab(vault.backupVerified ? intent : "deposit");
    was.current = vault.status;
  }, [vault.status, vault.backupVerified, intent]);

  /** From the Backup tab: show step 2 above and focus its Export button (scrolled into view). */
  const showBackupStep = () => {
    flushSync(() => setTab("deposit"));
    document.getElementById(BACKUP_STEP_ID)?.focus();
  };

  return (
    <>
      <ActionPanel tab={tab} setTab={setTab} />
      <DetailsCard onShowBackupStep={showBackupStep} />
    </>
  );
}

// ─── pool not deployed yet ────────────────────────────────────────────────────

function PendingPanel() {
  return (
    <section className={`${CARD} flex min-w-0 flex-col gap-4 p-4 sm:p-6`} aria-label="Vault actions">
      <UnderlineTabs
        id="vault-action"
        size="lg"
        className="-mt-1"
        label="Pool action"
        value="deposit"
        onChange={() => undefined}
        items={[
          { key: "deposit", label: "Deposit", disabled: true },
          { key: "withdraw", label: "Withdraw", disabled: true },
        ]}
        trailing="available once deployed"
      />
      <div>
        <h2 className="text-sm font-semibold tracking-tight text-foreground">How the vault works</h2>
        <ol className="mt-3 space-y-2">
          {HOW.map((s, i) => (
            <li key={s.title} className={`${INSET} flex items-start gap-3 px-3 py-2.5`}>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-xs font-semibold text-primary">
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{s.title}</span>
                <span className="block text-xs leading-relaxed text-muted-foreground">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <p className="text-center text-xs text-muted-foreground">Testnet only. Not audited. Development trusted setup. Do not use real
        funds.</p>
    </section>
  );
}

/** The dashboard's one pending story (shared with /pools and My notes), while no network has a pool yet. */
function PendingCard() {
  return (
    <section className={`${CARD} flex min-w-0 flex-col justify-center`} aria-labelledby="vault-pending-title">
      {/* the strip right above carries the Deployment pending pill */}
      <DeploymentPending titleId="vault-pending-title" pill={false} note="Your vault, deposits and withdrawals open here once a pool is live." />
    </section>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Vault() {
  const { configured } = usePrivacy();
  const search = useSearch();
  const intent: SideTab = new URLSearchParams(search).get("action") === "withdraw" ? "withdraw" : "deposit";

  return (
    <PoolsShell>
      <div className="mx-auto max-w-4xl">
        <header className="mb-6">
          <h1 className="font-display text-2xl font-semibold tracking-[-0.03em] sm:text-3xl">My vault</h1>
          <p className="mt-2 text-base leading-relaxed text-muted-foreground">Manage your vault, deposit testnet ETH, and withdraw from your notes.</p>
        </header>
        <div className="flex min-w-0 flex-col gap-5">
          <PoolHeader />
          {configured ? (
            <Workspace intent={intent} />
          ) : (
            <>
              <PendingCard />
              <PendingPanel />
            </>
          )}
        </div>
      </div>
    </PoolsShell>
  );
}
