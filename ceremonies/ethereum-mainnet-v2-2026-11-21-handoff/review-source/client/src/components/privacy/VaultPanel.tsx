/**
 * The vault, split across the workspace (/pools/vault):
 *   - VaultSetup   action panel while there is no vault or it is locked: create or unlock, or restore
 *   - BackupStep   action panel, Deposit tab, while the backup is not verified yet: export and verify
 *   - VaultBackup  the "Backup & recovery" tab: identity, lock, forget; export and re-verify once the backup is verified
 * Every action calls the same PrivacyProvider function, with the same checks and messages, as before.
 */
import { useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileCheck2,
  Fingerprint,
  KeyRound,
  Lock,
  LockOpen,
  Trash2,
  Upload,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { namesList } from "@/components/pools/NetworkMenu";
import { MULTI_NETWORK, PRIVACY_NETWORKS } from "@/privacy/config";
import { usePrivacy, type VaultState } from "@/privacy/PrivacyProvider";
import {
  CTA,
  CTA_SM,
  DANGER_FILL,
  FIELD_BOX,
  FIELD_INPUT,
  FILE_INPUT,
  FILLED,
  FieldLabel,
  HINT,
  INSET,
  InfoNote,
  OrDivider,
  Pill,
  QUIET_HOVER,
  Stepper,
  TONE_TEXT,
  type Step,
} from "./ui";

/** One name for the one password: it encrypts the seed on this device and the backup file. */
const VAULT_PASSWORD = "Vault password";
/** Small outline / ghost buttons in the Backup tab: pill-shaped, with the landing's quiet hover. */
const SMALL_BTN = `rounded-full ${QUIET_HOVER}`;

const errMsg = (e: unknown) => (e as Error)?.message ?? String(e);

/** Where the user is in "1 Create vault · 2 Verify backup · 3 Deposit". */
export function setupSteps(vault: VaultState): Step[] {
  const open = vault.status === "unlocked";
  const verified = vault.status !== "none" && vault.backupVerified;
  return [
    { label: vault.status === "locked" ? "Unlock vault" : "Create vault", state: open ? "done" : "current" },
    { label: "Verify backup", state: verified ? "done" : open ? "current" : "todo" },
    { label: "Deposit", state: open && verified ? "current" : "todo" },
  ];
}

const SEED_TEXT = (
  <>
    Your pool secrets are derived from one random seed created on this device. The seed is stored here only in encrypted form, and it is{" "}
    <strong className="font-semibold text-foreground">not</strong> recoverable from your wallet. Without the backup file and your vault password, deposited
    funds cannot be withdrawn.
  </>
);

/** The networks this build offers, by name ("Robinhood Chain Testnet"; several in a local multi-network build). */
const NETWORK_NAMES = namesList(PRIVACY_NETWORKS.map(n => n.network.name));

/**
 * How the activity log is kept, in the code's own terms (wherever the log is described): encrypted at rest with a key
 * from the seed (client/src/privacy/activityStore.ts), which does not hide it from whoever has the vault open.
 */
export const ACTIVITY_LOG_TEXT =
  "Your activity log is kept on this device, encrypted with a key from your vault: it can be read only while the vault is unlocked, and forgetting the vault deletes it. That protects the log at rest, not from someone using your unlocked vault.";

/**
 * What a Lock button does while an operation runs: the provider locks once the operation has written its outcome
 * with the vault's key (PrivacyProvider `lock`, `lockPending`).
 */
export const LOCK_LATER = "Locks as soon as the operation in progress has finished";

/** Lock, or, while an operation runs, ask for the lock and say when it happens (also on touch screens, which show no tooltip). */
export function lockOrSay(lock: () => boolean) {
  if (!lock()) toast("The vault locks as soon as the operation in progress has finished.");
}

function WhatTheBackupContains() {
  return (
    <InfoNote icon={FileCheck2} title="What the backup contains">
      One encrypted 32-byte seed.{" "}
      {MULTI_NETWORK
        ? `It recovers your notes in the pool on each network (${NETWORK_NAMES}); the pools stay separate.`
        : `It recovers your notes in the ${NETWORK_NAMES} pool.`}{" "}
      Your notes, spent status, change notes and recoverable balance are rebuilt from public chain data. The backup does not contain this device's full
      activity history. Use one browser profile for deposits from this backup;
      separate devices or profiles cannot coordinate pending deposits. Settle
      wallet requests before restoring elsewhere. A wallet password or a
      different wallet account does not replace this file.
    </InfoNote>
  );
}

function FilePasswordForm({
  title,
  description,
  cta,
  primary = false,
  onSubmit,
}: {
  title: string;
  description: string;
  cta: string;
  /** the step's main action (filled) rather than an alternative (outline) */
  primary?: boolean;
  onSubmit: (fileText: string, password: string) => Promise<void>;
}) {
  const uid = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return toast.error("Choose a backup file first");
    setBusy(true);
    try {
      await onSubmit(await file.text(), password);
      setPassword("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div>
        <FieldLabel htmlFor={`${uid}-file`} label="Backup file (.json)" />
        <div className={FIELD_BOX}>
          <input id={`${uid}-file`} ref={fileRef} type="file" accept="application/json,.json" required className={FILE_INPUT} />
        </div>
      </div>
      <div>
        <FieldLabel htmlFor={`${uid}-pw`} label={VAULT_PASSWORD} />
        <div className={FIELD_BOX}>
          <input
            id={`${uid}-pw`}
            type="password"
            autoComplete="off"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            aria-describedby={`${uid}-pw-hint`}
            className={FIELD_INPUT}
          />
        </div>
        <p id={`${uid}-pw-hint`} className={HINT}>
          The password you created the vault with: it also encrypts the backup file.
        </p>
      </div>
      <Button type="submit" variant={primary ? "default" : "outline"} className={primary ? `${CTA_SM} ${FILLED}` : `${CTA_SM} ${QUIET_HOVER}`} disabled={busy}>
        <Upload className="h-3.5 w-3.5" aria-hidden /> {busy ? "Working…" : cta}
      </Button>
    </form>
  );
}

/** Side panel while there is no vault on this device, or it is locked. */
export function VaultSetup() {
  const { vault, createVault, unlock, importBackup } = usePrivacy();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const none = vault.status === "none";

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      await createVault(pw);
      setPw("");
      setPw2("");
      toast.success("Vault created. Export and verify your backup before depositing.");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  const onUnlock = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await unlock(pw);
      setPw("");
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Stepper label="Vault setup" steps={setupSteps(vault)} />

      {none ? (
        <form onSubmit={onCreate} className="flex flex-col gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <KeyRound className="h-3.5 w-3.5 text-primary" aria-hidden />{" "}
              Create a new vault
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{SEED_TEXT}</p>
          </div>
          <div>
            <FieldLabel htmlFor="vault-pw" label={`${VAULT_PASSWORD} (min. 8 characters)`} />
            <div className={FIELD_BOX}>
              <input
                id="vault-pw"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={pw}
                onChange={e => setPw(e.target.value)}
                required
                className={FIELD_INPUT}
              />
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="vault-pw2" label={`Repeat ${VAULT_PASSWORD.toLowerCase()}`} />
            <div className={FIELD_BOX}>
              <input
                id="vault-pw2"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={pw2}
                onChange={e => setPw2(e.target.value)}
                required
                className={FIELD_INPUT}
              />
            </div>
          </div>
          <Button type="submit" className={CTA} disabled={busy}>
            {busy ? "Creating…" : "Create vault"}
          </Button>
        </form>
      ) : (
        <form onSubmit={onUnlock} className="flex flex-col gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Lock className="h-3.5 w-3.5 text-primary" aria-hidden /> Unlock your vault
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Notes and your activity log are decrypted in this tab only. Nothing secret is sent anywhere.
            </p>
          </div>
          <div>
            <FieldLabel htmlFor="unlock-pw" label={VAULT_PASSWORD} />
            <div className={FIELD_BOX}>
              <input
                id="unlock-pw"
                type="password"
                autoComplete="current-password"
                value={pw}
                onChange={e => setPw(e.target.value)}
                required
                className={FIELD_INPUT}
              />
            </div>
          </div>
          <Button type="submit" className={CTA} disabled={busy}>
            <LockOpen className="h-4 w-4" aria-hidden />{" "}
            {busy ? "Unlocking…" : "Unlock"}
          </Button>
        </form>
      )}

      <OrDivider />

      <FilePasswordForm
        title={none ? "Restore from a backup" : "Restore a different backup"}
        description={none ? "Import a backup made on another device. Notes are rediscovered from the chain." : "Replaces the vault stored on this device."}
        cta="Restore"
        onSubmit={async (t, p) => {
          await importBackup(t, p);
          toast.success(none ? "Vault restored. Syncing notes from the chain…" : "Vault restored.");
        }}
      />
    </div>
  );
}

/** Where the Backup tab sends the user to finish step 2 (the action panel's Export button). */
export const BACKUP_STEP_ID = "vault-export";

/** Side panel, Deposit tab: the vault is open but deposits wait for a verified backup. */
export function BackupStep() {
  const { vault, exportBackup, verifyBackup } = usePrivacy();
  return (
    <div className="flex flex-col gap-4">
      <Stepper label="Vault setup" steps={setupSteps(vault)} />
      <div className="flex flex-col gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Download className="h-3.5 w-3.5 text-primary" aria-hidden /> Export your backup
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Without the backup file and your vault password, deposited funds cannot be withdrawn. A wallet password or a different wallet account does not
            replace this file.
          </p>
        </div>
        <Button id={BACKUP_STEP_ID} variant="outline" className={`${CTA_SM} ${QUIET_HOVER}`} onClick={exportBackup}>
          <Download className="h-3.5 w-3.5" aria-hidden /> Export backup
        </Button>
      </div>
      <div className="h-px bg-border/60" aria-hidden />
      <FilePasswordForm
        title="Verify your backup"
        description="Select the file you just exported and enter your vault password. We decrypt it locally and confirm it restores this exact vault — only then are deposits enabled."
        cta="Verify backup"
        primary
        onSubmit={async (t, p) => {
          await verifyBackup(t, p);
          toast.success("Backup verified. You can deposit now.");
        }}
      />
    </div>
  );
}

/**
 * The "Backup & recovery" tab. It never repeats what the action panel already shows: without a
 * vault the panel's Create form already explains the seed, and while the backup is not verified the panel's
 * step 2 holds the export and verify forms, so the tab points there instead (`onShowBackupStep`).
 */
export function VaultBackup({ onShowBackupStep }: { onShowBackupStep: () => void;
}) {
  const { vault, lock, lockPending, exportBackup, verifyBackup, forgetVault, pools, busy } = usePrivacy();
  const [confirmForget, setConfirmForget] = useState(false);
  const none = vault.status === "none";

  /** Moves focus to the first field of the setup form above (the browser scrolls it into view). */
  const toSetup = () => document.getElementById(none ? "vault-pw" : "unlock-pw")?.focus();

  return (
    <div className="flex flex-col gap-3">
      {!none && (
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">{SEED_TEXT}</p>
      )}

      {vault.status !== "unlocked" ? (
        <div className="flex flex-col gap-4">
          <section className={`${INSET} flex flex-col items-start gap-3 p-4`}>
            <div>
              <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                {none ? (
                  <KeyRound className="h-3.5 w-3.5 text-primary" aria-hidden />
                ) : (
                  <Lock className="h-3.5 w-3.5 text-primary" aria-hidden />
                )}
                {none ? "No vault on this device" : "The vault is locked"}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {none
                  ? "Create a vault, or restore one from a backup file. Export and verify your backup before depositing."
                  : "Unlock it to export or verify a backup, lock it again or forget it on this device."}
              </p>
            </div>
            <Button variant="outline" size="sm" className={SMALL_BTN} onClick={toSetup}>
              {none ? "Create or restore a vault" : "Unlock the vault"}
            </Button>
          </section>
          <WhatTheBackupContains />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              title={vault.fingerprint ?? undefined}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2 font-mono text-muted-foreground"
            >
              <Fingerprint className="h-3 w-3" aria-hidden /> vault {" "}
              {vault.fingerprint?.slice(0, 10)}…
            </span>
            {vault.backupVerified ? (
              <Pill tone="profit" icon={CheckCircle2}>
                backup verified
              </Pill>
            ) : (
              <Pill tone="destructive" icon={AlertTriangle}>
                backup not verified — deposits disabled
              </Pill>
            )}
          </div>
          {/* one line per pool: the seed recovers notes in each, and the pools stay separate (one pool: no network prefix) */}
          {pools.some(v => v.state.status === "ready") && (
            <ul className="space-y-0.5 text-xs text-muted-foreground">
              {pools
                .filter(v => v.state.status === "ready")
                .map(v => (
                  <li key={v.ref.key}>
                    {MULTI_NETWORK && `${v.ref.network.name}: `}
                    {v.notes.list.length} note(s) discovered · next deposit index {v.notes.nextDepositIndex}
                  </li>
                ))}
            </ul>
          )}

          <div className="flex flex-col gap-4">
            <div className={`${INSET} flex flex-col divide-y divide-border/50`}>
              {vault.backupVerified ? (
                <section className="flex flex-col items-start gap-3 p-4">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <Download className="h-3.5 w-3.5 text-primary" aria-hidden />{" "}
                      Export backup
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Downloads the encrypted backup file of this vault. Keep it together with your vault password: without both, deposited funds cannot be
                      withdrawn.
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className={SMALL_BTN} onClick={exportBackup}>
                    <Download className="h-3.5 w-3.5" aria-hidden /> Export backup
                  </Button>
                </section>
              ) : (
                <section className="flex flex-col items-start gap-3 p-4">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <FileCheck2 className="h-3.5 w-3.5 text-primary" aria-hidden />{" "}
                      Step 2: export and verify your backup
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Both happen in the Deposit panel: export the backup file, then verify it with your vault password. Deposits stay disabled until the
                      backup is verified.
                    </p>
                  </div>
                  <Button size="sm" variant="outline" className={SMALL_BTN} onClick={onShowBackupStep}>
                    Go to step 2{" "}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </section>
              )}
              <section className="flex flex-1 flex-col items-start gap-3 p-4">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <KeyRound className="h-3.5 w-3.5 text-primary" aria-hidden />{" "}
                    This device
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Locking clears your keys, notes and decrypted activity from this tab; the encrypted vault stays on this device. {" "}
                    {ACTIVITY_LOG_TEXT}
                    Forgetting also removes the encrypted seed from this browser.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className={SMALL_BTN}
                    onClick={() => lockOrSay(lock)}
                    disabled={lockPending}
                    title={busy || lockPending ? LOCK_LATER : undefined}
                  >
                    <Lock className="h-3.5 w-3.5" aria-hidden />{" "}
                    {lockPending ? "Locks when the operation ends" : "Lock"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className={`rounded-full ${TONE_TEXT.destructive} hover:bg-destructive/10 dark:hover:bg-destructive/15`}
                    onClick={() => setConfirmForget(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden /> Forget vault on this device
                  </Button>
                </div>
              </section>
            </div>

            {vault.backupVerified ? (
              <section className={`${INSET} p-4`}>
                <FilePasswordForm
                  title="Re-verify a backup file"
                  description="Select a backup file of this vault and enter your vault password. We decrypt it locally and confirm it restores this exact vault."
                  cta="Verify backup"
                  onSubmit={async (t, p) => {
                    await verifyBackup(t, p);
                    toast.success("Backup verified. You can deposit now.");
                  }}
                />
              </section>
            ) : (
              <div className="min-w-0 self-start">
                <WhatTheBackupContains />
              </div>
            )}
          </div>

          {vault.backupVerified && <WhatTheBackupContains />}
        </>
      )}

      <Dialog open={confirmForget} onOpenChange={setConfirmForget}>
        {/* app-root: the dialog is portaled outside the shell, so it carries the heading roll-back itself */}
        <DialogContent className="app-root">
          <DialogHeader>
            <DialogTitle>Forget this vault?</DialogTitle>
            <DialogDescription>
              The encrypted seed and this device&apos;s encrypted activity log will be removed from this browser. If you have not exported and verified a backup, any
              funds still in {" "}
              {MULTI_NETWORK ? "the pools under this vault, on any network," : "the pool under this vault"}{" "} become unrecoverable.
              {busy && " An operation is in progress: it may still complete on the chain, but nothing more of it is kept on this device."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" className={QUIET_HOVER} onClick={() => setConfirmForget(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className={DANGER_FILL}
              onClick={() => {
                forgetVault();
                setConfirmForget(false);
                toast("Vault removed from this device");
              }}
            >
              Forget vault
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
