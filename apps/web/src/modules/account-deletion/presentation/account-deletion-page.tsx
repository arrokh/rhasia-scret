"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { AlertTriangle, Archive, ArrowLeft, Check, Download, LoaderCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUnlockedVaultWorkspace, VaultWorkspaceUnlock } from "@/modules/authenticator-account";
import type { UnlockedVaultWorkspace } from "@/modules/sync";
import { recordVaultArchiveExport } from "@/modules/audit";
import {
  clearBrowserPreparedVaultArchive,
  prepareBrowserEncryptedVaultArchive,
  downloadPreparedVaultArchive,
  type PreparedVaultArchive,
} from "@/modules/vault-archive";
import { browserDownload } from "@/shared/infrastructure/browser-platform-ports";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { AppPage, PageHeader, SectionHeading, StatusBanner, SurfaceCard } from "@/shared/presentation/app-ui";
import {
  clearDeletedBrowserState,
  deleteAccount,
  loadAccountDeletionPreview,
  requestAccountDeletionOtp,
  startAccountDeletionOidcReauthentication,
  verifyAccountDeletionOtp,
} from "../infrastructure/browser-account-deletion-client";
import type { AccountDeletionPreview } from "../application/account-deletion-repository";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  type AccountDeletionAuthBackend,
  type AccountDeletionRequest,
  type OwnedSharedVaultDecision,
} from "../domain/account-deletion-policy";

const FLOW_STORAGE_KEY = "rhasia-scret-account-deletion-flow";

type Translation = (key: string, values?: Record<string, string | number>) => string;
type Step = "choice" | "backup" | "resolution" | "reauth" | "confirm";
type BackupState = Readonly<{ mode: "BACKUP" | "SKIP"; completedVaultIds: readonly string[] }>;
type PersistedFlow = Readonly<{
  backup: BackupState | null;
  decisions: readonly OwnedSharedVaultDecision[];
}>;

export function AccountDeletionPage({
  email,
  authBackend,
  initialReauthenticated = false,
}: {
  email: string;
  authBackend: AccountDeletionAuthBackend;
  initialReauthenticated?: boolean;
}) {
  const t = useTranslations("AccountDeletion.page") as unknown as Translation;
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  const persisted = readPersistedFlow();
  const [preview, setPreview] = useState<AccountDeletionPreview | null>(null);
  const [step, setStep] = useState<Step>(initialReauthenticated ? "confirm" : "choice");
  const [backup, setBackup] = useState<BackupState | null>(persisted?.backup ?? null);
  const [decisions, setDecisions] = useState<readonly OwnedSharedVaultDecision[]>(persisted?.decisions ?? []);
  const [reauthenticated, setReauthenticated] = useState(initialReauthenticated);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadAccountDeletionPreview()
      .then((nextPreview) => {
        setPreview(nextPreview);
        setDecisions((current) =>
          current.length === nextPreview.ownedSharedVaults.length
            ? current
            : nextPreview.ownedSharedVaults.map(({ id }) => ({ vaultId: id, action: "DELETE" as const })),
        );
      })
      .catch(() => setError("loadFailed"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (initialReauthenticated) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [initialReauthenticated]);

  useEffect(() => {
    writePersistedFlow({ backup, decisions });
  }, [backup, decisions]);

  if (loading) return <PageState message={t("loading")} />;
  if (error || !preview) return <PageState message={t(error ?? "loadFailed")} danger />;

  return (
    <AppPage>
      <PageHeader backHref="/vaults" title={t("title")} description={t("description", { email })} />
      <div className="grid gap-5">
        <StatusBanner tone="danger" title={t("warningTitle")}>
          {t("warningDescription")}
        </StatusBanner>
        {step === "choice" && (
          <ChoiceStep
            t={t}
            backup={backup}
            onChoose={(mode) => {
              const next = { mode, completedVaultIds: [] } as const;
              setBackup(next);
              setStep(mode === "BACKUP" ? "backup" : "resolution");
            }}
          />
        )}
        {step === "backup" && preview && (
          <BackupStep
            t={t}
            preview={preview}
            workspace={workspace}
            setWorkspace={setWorkspace}
            backup={backup}
            onChange={setBackup}
            onContinue={() => setStep("resolution")}
            onBack={() => setStep("choice")}
          />
        )}
        {step === "resolution" && (
          <ResolutionStep
            t={t}
            preview={preview}
            workspace={workspace}
            decisions={decisions}
            onContinue={(next) => {
              setDecisions(next);
              setStep("reauth");
            }}
            onBack={() => setStep(backup?.mode === "BACKUP" ? "backup" : "choice")}
          />
        )}
        {step === "reauth" && (
          <ReauthenticationStep
            t={t}
            authBackend={authBackend}
            onComplete={() => {
              setReauthenticated(true);
              setStep("confirm");
            }}
            onBack={() => setStep("resolution")}
          />
        )}
        {step === "confirm" && reauthenticated && (
          <ConfirmationStep t={t} decisions={decisions} onBack={() => setStep("reauth")} />
        )}
      </div>
    </AppPage>
  );
}

function ChoiceStep({
  t,
  backup,
  onChoose,
}: {
  t: Translation;
  backup: BackupState | null;
  onChoose(mode: "BACKUP" | "SKIP"): void;
}) {
  const [skipAcknowledged, setSkipAcknowledged] = useState(false);
  return (
    <SurfaceCard className="grid gap-5 p-5 sm:p-6">
      <SectionHeading icon={Archive} title={t("backupTitle")} description={t("backupDescription")} />
      {backup?.mode === "BACKUP" && backup.completedVaultIds.length > 0 && (
        <StatusBanner tone="info">{t("backupProgress", { count: backup.completedVaultIds.length })}</StatusBanner>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Button type="button" onClick={() => onChoose("BACKUP")}>
          <Download aria-hidden="true" />
          {t("backupFirst")}
        </Button>
        <div className="grid gap-3">
          <Button type="button" variant="outline" onClick={() => onChoose("SKIP")} disabled={!skipAcknowledged}>
            {t("skipBackup")}
          </Button>
          <div className="flex items-start gap-3">
            <Checkbox
              id="account-deletion-skip-backup-ack"
              checked={skipAcknowledged}
              onCheckedChange={(value) => setSkipAcknowledged(value === true)}
            />
            <Label htmlFor="account-deletion-skip-backup-ack" className="leading-5">
              {t("skipBackupAcknowledgement")}
            </Label>
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}

function BackupStep({
  t,
  preview,
  workspace,
  setWorkspace,
  backup,
  onChange,
  onContinue,
  onBack,
}: {
  t: Translation;
  preview: AccountDeletionPreview;
  workspace: UnlockedVaultWorkspace | null;
  setWorkspace: (workspace: UnlockedVaultWorkspace) => void;
  backup: BackupState | null;
  onChange(next: BackupState): void;
  onContinue(): void;
  onBack(): void;
}) {
  const [prepared, setPrepared] = useState<PreparedVaultArchive | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const activeRef = useRef(true);
  const personalVaultId = preview.personalVaultId;
  const vaultIds = [personalVaultId, ...preview.ownedSharedVaults.map(({ id }) => id)].filter((id): id is string =>
    Boolean(id),
  );
  const completed = new Set(backup?.completedVaultIds ?? []);
  const currentId = vaultIds.find((id) => !completed.has(id));

  const preparedRef = useRef<PreparedVaultArchive | null>(null);
  useEffect(
    () => () => {
      activeRef.current = false;
      clearBrowserPreparedVaultArchive(preparedRef.current);
    },
    [],
  );

  if (!workspace) {
    if (vaultIds.length === 0)
      return (
        <SurfaceCard className="grid gap-4 p-5 sm:p-6">
          <StatusBanner tone="success">{t("backupComplete")}</StatusBanner>
          <Button type="button" onClick={onContinue}>
            {t("continue")}
          </Button>
        </SurfaceCard>
      );
    if (!personalVaultId) return <PageState message={t("workspaceUnavailable")} danger />;
    return (
      <SurfaceCard className="grid gap-4 p-5 sm:p-6">
        <SectionHeading icon={ShieldCheck} title={t("unlockTitle")} description={t("unlockDescription")} />
        <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          {t("back")}
        </Button>
      </SurfaceCard>
    );
  }
  if (workspace.syncState !== "CURRENT") return <PageState message={t("offlineBlocked")} danger />;
  if (!currentId) {
    return (
      <SurfaceCard className="grid gap-4 p-5 sm:p-6">
        <StatusBanner tone="success">{t("backupComplete")}</StatusBanner>
        <Button type="button" onClick={onContinue}>
          {t("continue")}
        </Button>
      </SurfaceCard>
    );
  }
  const activeVaultId = currentId;
  const vault = workspace.vaults.find(({ id }) => id === activeVaultId);
  if (!vault) return <PageState message={t("vaultUnavailable")} danger />;
  const selectedVault = vault;
  const activeWorkspace = workspace;

  async function prepare() {
    setPending(true);
    setMessage(null);
    let next: PreparedVaultArchive | null = null;
    try {
      next = await prepareBrowserEncryptedVaultArchive(
        selectedVault,
        activeWorkspace.accounts.filter((account) => account.vaultId === selectedVault.id),
      );
      await recordVaultArchiveExport(selectedVault.id);
      if (activeRef.current) {
        clearBrowserPreparedVaultArchive(preparedRef.current);
        preparedRef.current = next;
        setPrepared(next);
        next = null;
      } else {
        clearBrowserPreparedVaultArchive(next);
        next = null;
      }
    } catch {
      clearBrowserPreparedVaultArchive(next);
      setMessage("backupFailed");
    } finally {
      setPending(false);
    }
  }

  function completeCurrentVault() {
    if (!prepared || !acknowledged || !backup) return;
    clearBrowserPreparedVaultArchive(prepared);
    preparedRef.current = null;
    setPrepared(null);
    setAcknowledged(false);
    onChange({ mode: "BACKUP", completedVaultIds: [...backup.completedVaultIds, activeVaultId] });
  }

  return (
    <SurfaceCard className="grid gap-5 p-5 sm:p-6">
      <SectionHeading
        icon={Archive}
        title={t("vaultTitle", { name: selectedVault.name })}
        description={t("vaultDescription")}
      />
      {!prepared ? (
        <Button type="button" onClick={() => void prepare()} disabled={pending} aria-busy={pending}>
          {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {pending ? t("preparing") : t("prepare")}
        </Button>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Button type="button" onClick={() => downloadPreparedVaultArchive(prepared)}>
              <Download aria-hidden="true" />
              {t("downloadArchive")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                browserDownload.download({
                  bytes: new TextEncoder().encode(`${prepared.keyMaterial}\n`),
                  filename: prepared.filename.replace(/\.rhasia-vault$/, ".key.txt"),
                  mediaType: "text/plain",
                })
              }
            >
              <Download aria-hidden="true" />
              {t("downloadKey")}
            </Button>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox
              id="account-deletion-backup-ack"
              checked={acknowledged}
              onCheckedChange={(value) => setAcknowledged(value === true)}
            />
            <Label htmlFor="account-deletion-backup-ack" className="leading-5">
              {t("backupAcknowledgement")}
            </Label>
          </div>
          <Button type="button" onClick={completeCurrentVault} disabled={!acknowledged}>
            <Check aria-hidden="true" />
            {t("saved")}
          </Button>
        </>
      )}
      {message && <StatusBanner tone="danger">{t(message)}</StatusBanner>}
      <Button type="button" variant="ghost" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
        {t("back")}
      </Button>
    </SurfaceCard>
  );
}

function ResolutionStep({
  t,
  preview,
  workspace,
  decisions,
  onContinue,
  onBack,
}: {
  t: Translation;
  preview: AccountDeletionPreview;
  workspace: UnlockedVaultWorkspace | null;
  decisions: readonly OwnedSharedVaultDecision[];
  onContinue(next: readonly OwnedSharedVaultDecision[]): void;
  onBack(): void;
}) {
  const form = useForm({
    defaultValues: { decisions },
    onSubmit: async ({ value }) => onContinue(value.decisions),
  });
  useEffect(() => form.reset({ decisions }), [decisions, form]);
  const nameFor = (id: string) => workspace?.vaults.find((vault) => vault.id === id)?.name ?? id;
  return (
    <SurfaceCard className="grid gap-5 p-5 sm:p-6">
      <SectionHeading icon={AlertTriangle} title={t("resolutionTitle")} description={t("resolutionDescription")} />
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field
          name="decisions"
          validators={{
            onSubmit: ({ value }) =>
              value.length === preview.ownedSharedVaults.length &&
              value.every((decision) => decision.action === "DELETE" || Boolean(decision.transferToUserId))
                ? undefined
                : t("decisionRequired"),
          }}
        >
          {(field) => (
            <div className="grid gap-4">
              {preview.ownedSharedVaults.map((vault, index) => {
                const decision = field.state.value[index] ?? { vaultId: vault.id, action: "DELETE" as const };
                return (
                  <div key={vault.id} className="grid gap-3 rounded-md border border-border p-4">
                    <h3 className="font-semibold text-ink-strong">{nameFor(vault.id)}</h3>
                    <Select
                      value={decision.action}
                      onValueChange={(action: "DELETE" | "TRANSFER") => {
                        const next = [...field.state.value];
                        next[index] =
                          action === "DELETE"
                            ? { vaultId: vault.id, action }
                            : { vaultId: vault.id, action, transferToUserId: vault.viewerCandidates[0]?.id };
                        field.handleChange(next);
                      }}
                    >
                      <SelectTrigger aria-label={t("decisionLabel", { name: nameFor(vault.id) })}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DELETE">{t("deleteVault")}</SelectItem>
                        {vault.viewerCandidates.length > 0 && (
                          <SelectItem value="TRANSFER">{t("transferVault")}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {decision.action === "TRANSFER" && (
                      <Select
                        value={decision.transferToUserId}
                        onValueChange={(transferToUserId) =>
                          field.handleChange(
                            field.state.value.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, transferToUserId } : item,
                            ),
                          )
                        }
                      >
                        <SelectTrigger aria-label={t("transferTargetLabel", { name: nameFor(vault.id) })}>
                          <SelectValue placeholder={t("chooseViewer")} />
                        </SelectTrigger>
                        <SelectContent>
                          {vault.viewerCandidates.map((candidate) => (
                            <SelectItem key={candidate.id} value={candidate.id}>
                              {candidate.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                );
              })}
              {preview.ownedSharedVaults.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("noSharedVaults")}</p>
              )}
              <FormFieldError id="account-deletion-vault-decisions-error" errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button type="submit">{t("continue")}</Button>
          <Button type="button" variant="ghost" onClick={onBack}>
            {t("back")}
          </Button>
        </div>
      </form>
    </SurfaceCard>
  );
}

function ReauthenticationStep({
  t,
  authBackend,
  onComplete,
  onBack,
}: {
  t: Translation;
  authBackend: AccountDeletionAuthBackend;
  onComplete(): void;
  onBack(): void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "verifying" | "error">("idle");
  const form = useForm({
    defaultValues: { otp: "" },
    onSubmit: async ({ value }) => {
      setStatus("verifying");
      try {
        await verifyAccountDeletionOtp(value.otp);
        onComplete();
      } catch {
        setStatus("error");
      }
    },
  });
  async function sendOtp() {
    setStatus("sending");
    try {
      await requestAccountDeletionOtp();
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }
  async function startOidc() {
    setStatus("sending");
    try {
      await startAccountDeletionOidcReauthentication();
      router.push("/auth/oidc?next=/account/delete/reauth");
    } catch {
      setStatus("error");
    }
  }
  return (
    <SurfaceCard className="grid gap-5 p-5 sm:p-6">
      <SectionHeading icon={ShieldCheck} title={t("reauthTitle")} description={t("reauthDescription")} />
      {authBackend === "passwordless" ? (
        <>
          <Button type="button" onClick={() => void sendOtp()} disabled={status === "sending"}>
            {status === "sending" && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {status === "sent" ? t("resendCode") : t("sendCode")}
          </Button>
          <form
            noValidate
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <form.Field
              name="otp"
              validators={{ onSubmit: ({ value }) => (/^\d{6}$/.test(value) ? undefined : t("otpInvalid")) }}
            >
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor="account-deletion-otp">{t("otpLabel")}</Label>
                  <Input
                    id="account-deletion-otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    aria-invalid={field.state.meta.errors.length > 0}
                    aria-describedby="account-deletion-otp-error"
                  />
                  <FormFieldError id="account-deletion-otp-error" errors={field.state.meta.errors} />
                </div>
              )}
            </form.Field>
            <Button type="submit" disabled={status === "verifying"}>
              {status === "verifying" ? t("verifying") : t("verifyCode")}
            </Button>
          </form>
        </>
      ) : (
        <Button type="button" onClick={() => void startOidc()} disabled={status === "sending"}>
          {status === "sending" && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {t("reauthenticateWithProvider")}
        </Button>
      )}
      {status === "error" && <StatusBanner tone="danger">{t("reauthError")}</StatusBanner>}
      <Button type="button" variant="ghost" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
        {t("back")}
      </Button>
    </SurfaceCard>
  );
}

function ConfirmationStep({
  t,
  decisions,
  onBack,
}: {
  t: Translation;
  decisions: readonly OwnedSharedVaultDecision[];
  onBack(): void;
}) {
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const form = useForm({
    defaultValues: { confirmation: "", acknowledged: false },
    onSubmit: async ({ value }) => {
      setStatus("submitting");
      setErrorCode(null);
      const request: AccountDeletionRequest = { ...value, vaultDecisions: decisions };
      try {
        const result = await deleteAccount(request);
        let cleanupWarning = false;
        try {
          await clearDeletedBrowserState();
        } catch {
          cleanupWarning = true;
        }
        clearPersistedFlow();
        const params = new URLSearchParams({ receipt: result.receiptId });
        if (cleanupWarning) params.set("cleanup", "warning");
        window.location.replace(`/account/delete/complete?${params.toString()}`);
      } catch (error) {
        setStatus("error");
        setErrorCode(accountDeletionErrorKey(error instanceof BrowserApiError ? error.code : undefined));
      }
    },
  });
  return (
    <SurfaceCard className="grid gap-5 p-5 sm:p-6">
      <SectionHeading icon={AlertTriangle} title={t("confirmTitle")} description={t("confirmDescription")} />
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Field
          name="confirmation"
          validators={{
            onSubmit: ({ value }) => (value === ACCOUNT_DELETION_CONFIRMATION ? undefined : t("confirmationInvalid")),
          }}
        >
          {(field) => (
            <div className="grid gap-2">
              <Label htmlFor="account-deletion-confirmation">
                {t("confirmationLabel", { phrase: ACCOUNT_DELETION_CONFIRMATION })}
              </Label>
              <Input
                id="account-deletion-confirmation"
                autoComplete="off"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                aria-invalid={field.state.meta.errors.length > 0}
                aria-describedby="account-deletion-confirmation-error"
              />
              <FormFieldError id="account-deletion-confirmation-error" errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <form.Field
          name="acknowledged"
          validators={{ onSubmit: ({ value }) => (value ? undefined : t("acknowledgementRequired")) }}
        >
          {(field) => (
            <div className="grid gap-2">
              <div className="flex items-start gap-3">
                <Checkbox
                  id="account-deletion-final-ack"
                  checked={field.state.value}
                  onCheckedChange={(value) => field.handleChange(value === true)}
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby="account-deletion-final-ack-error"
                />
                <Label htmlFor="account-deletion-final-ack" className="leading-5">
                  {t("acknowledgement")}
                </Label>
              </div>
              <FormFieldError id="account-deletion-final-ack-error" errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>
        <Button
          type="submit"
          variant="destructive"
          disabled={status === "submitting"}
          aria-busy={status === "submitting"}
        >
          {status === "submitting" && <LoaderCircle className="animate-spin" aria-hidden="true" />}
          {status === "submitting" ? t("deleting") : t("deleteAccount")}
        </Button>
      </form>
      {status === "error" && <StatusBanner tone="danger">{t(errorCode ?? "deleteFailed")}</StatusBanner>}
      <Button type="button" variant="ghost" onClick={onBack}>
        <ArrowLeft aria-hidden="true" />
        {t("back")}
      </Button>
    </SurfaceCard>
  );
}

function accountDeletionErrorKey(code: string | undefined): string {
  switch (code) {
    case "deletion_reauthentication_required":
      return "deletionReauthenticationRequired";
    case "deletion_plan_stale":
      return "deletionPlanStale";
    case "invalid_confirmation":
      return "confirmationInvalid";
    case "acknowledgement_required":
      return "acknowledgementRequired";
    case "invalid_vault_decisions":
    case "invalid_transfer_target":
      return "decisionRequired";
    default:
      return "deleteFailed";
  }
}

function PageState({ message, danger = false }: { message: string; danger?: boolean }) {
  return (
    <SurfaceCard className="p-5 sm:p-6">
      <StatusBanner tone={danger ? "danger" : "info"}>{message}</StatusBanner>
    </SurfaceCard>
  );
}

function readPersistedFlow(): PersistedFlow | null {
  if (typeof window === "undefined") return null;
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(FLOW_STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    return {
      backup: record.backup && typeof record.backup === "object" ? (record.backup as BackupState) : null,
      decisions: Array.isArray(record.decisions) ? (record.decisions as OwnedSharedVaultDecision[]) : [],
    };
  } catch {
    return null;
  }
}

function writePersistedFlow(flow: PersistedFlow): void {
  try {
    sessionStorage.setItem(FLOW_STORAGE_KEY, JSON.stringify(flow));
  } catch {
    // The flow remains usable without non-sensitive session progress persistence.
  }
}

function clearPersistedFlow(): void {
  try {
    sessionStorage.removeItem(FLOW_STORAGE_KEY);
  } catch {
    // There is no sensitive material in this progress record.
  }
}
