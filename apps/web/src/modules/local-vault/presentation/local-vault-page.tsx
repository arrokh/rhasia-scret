"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useLocale, useTranslations } from "next-intl";
import { Download, KeyRound, LockKeyhole, Plus, Settings, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { AppPage, PageHeader, SectionHeading, StatusBanner, SurfaceCard } from "@/shared/presentation/app-ui";
import { formatLocalDateTime } from "@/i18n/format";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { PasswordInput } from "@/shared/presentation/password-input";
import {
  parseTotpUri,
  TotpConfigurationError,
  type TotpConfiguration,
  type TotpConfigurationErrorCode,
} from "@/modules/otp-runtime";
import { TotpAccountButton } from "@/modules/otp-runtime";
import { requestLocalVaultLock, subscribeToLocalVaultLock, VaultStatusIndicator } from "@/modules/sync";
import {
  AccountDirectorySearch,
  AccountSearchEmptyState,
  AccountTagsEditor,
  AccountTagsFilter,
  QrImportInput,
  type AccountPayloadConfiguration,
} from "@/modules/authenticator-account";
import {
  AccountTagValidationError,
  matchesAuthenticatorAccountSearch,
  matchesAuthenticatorAccountTagFilter,
  normalizeAuthenticatorAccountTags,
} from "@rhasia-scret/client-vault-core";
import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";
import {
  addLocalAccount,
  deleteLocalAccount,
  exportLocalVault,
  importLocalVaultArchive,
  LocalVaultConcurrentAccountUpdateError,
  LocalVaultMigrationRequiredError,
  LocalVaultSessionLockedError,
  recordLocalArchiveExport,
  previewLocalVaultArchiveImport,
  renameLocalVault,
  updateLocalAccount,
  type LocalVaultArchiveImportReview,
  type UnlockedLocalVault,
  type UnlockedLocalVaultAccount,
} from "@/modules/local-vault";
import { browserDownload } from "@/shared/infrastructure/browser-platform-ports";
import { useLocalVaultSession } from "./use-local-vault-session";
import { localVaultArchiveImportFeedback } from "./local-vault-archive-import-feedback";
import { BrowserOriginStoragePersistenceNotice } from "./browser-origin-storage-persistence-notice";

export function LocalVaultPage({ backHref = "/sign-in" }: { backHref?: string } = {}) {
  const t = useTranslations("LocalVault");
  const {
    discoveryError,
    session,
    state: { available, discovered, migrationRequired, record, lastArchiveExportAt, vault },
  } = useLocalVaultSession();
  const [message, setMessage] = useState<{ tone: "danger" | "success" | "warning"; text: string } | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [editing, setEditing] = useState<UnlockedLocalVaultAccount | null>(null);
  const displayedMessage = message ?? (discoveryError ? { tone: "danger" as const, text: t("storageError") } : null);

  useEffect(
    () =>
      subscribeToLocalVaultLock(() => {
        setEditing(null);
        setClearOpen(false);
        setMessage(null);
      }),
    [],
  );

  function lock() {
    requestLocalVaultLock();
    setEditing(null);
    setMessage(null);
    captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultLocked);
  }

  async function create(passphrase: string, name: string) {
    setMessage(null);
    try {
      await session.create(passphrase, name);
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultCreated);
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultUnlocked, { method: "passphrase" });
    } catch {
      setMessage({ tone: "danger", text: t("storageError") });
    }
  }

  async function unlock(passphrase: string) {
    setMessage(null);
    try {
      await session.unlock(passphrase);
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultUnlocked, { method: "passphrase" });
    } catch (error) {
      const migrationFailure = error instanceof LocalVaultMigrationRequiredError;
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultUnlockFailed, {
        method: "passphrase",
        failure_code: migrationFailure ? "migration_required" : "unknown",
      });
      setMessage({ tone: "danger", text: migrationRequired ? t("migrationRequired") : t("unlockError") });
    }
  }

  async function migrate(passphrase: string) {
    setMessage(null);
    try {
      await session.migrate(passphrase);
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultMigrated);
    } catch {
      setMessage({ tone: "danger", text: t("unlockError") });
    }
  }

  async function handleClear() {
    setClearing(true);
    try {
      await session.clear();
      setClearOpen(false);
      setMessage({ tone: "success", text: t("clear") });
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultCleared);
    } catch {
      setMessage({ tone: "danger", text: t("storageError") });
    } finally {
      setClearing(false);
    }
  }

  if (!discovered && !discoveryError)
    return (
      <AppPage>
        <PageHeader title={t("title")} />
        <SurfaceCard className="p-6">
          <p role="status">{t("loading")}</p>
        </SurfaceCard>
      </AppPage>
    );
  if (!available)
    return (
      <AppPage>
        <PageHeader title={t("title")} />
        <SurfaceCard className="p-6">
          <StatusBanner tone="danger" role="alert">
            {t("unsupported")}
          </StatusBanner>
        </SurfaceCard>
      </AppPage>
    );

  return (
    <AppPage>
      <PageHeader title={t("title")} description={t("description")} backHref={backHref} />
      <BrowserOriginStoragePersistenceNotice />
      {displayedMessage && (
        <div className="mb-5">
          <StatusBanner tone={displayedMessage.tone} role={displayedMessage.tone === "danger" ? "alert" : "status"}>
            {displayedMessage.text}
          </StatusBanner>
        </div>
      )}
      <VaultStatusIndicator origin="LOCAL" className="mb-5" />
      {!record && (
        <SurfaceCard className="grid gap-5 p-5 sm:p-6">
          <CreateLocalVaultForm onCreate={create} />
        </SurfaceCard>
      )}
      {record && !vault && (
        <SurfaceCard className="grid gap-5 p-5 sm:p-6">
          <UnlockLocalVaultForm onUnlock={unlock} onMigrate={migrationRequired ? migrate : undefined} />
        </SurfaceCard>
      )}
      {record && vault && (
        <UnlockedLocalVaultView
          vault={vault}
          lastArchiveExportAt={lastArchiveExportAt}
          onLock={lock}
          onClear={() => setClearOpen(true)}
          runMutation={(operation) => session.mutate(operation)}
          performSensitiveWorkflow={(operation, clearStaleResult) =>
            session.performSensitiveWorkflow(operation, clearStaleResult)
          }
          refresh={() => session.refresh()}
          onRename={async (name) => {
            await session.mutate((current) => renameLocalVault(current, name));
            captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultRenamed);
          }}
          onEdit={setEditing}
          onError={(text) => setMessage({ tone: "danger", text })}
          onStatus={(tone, text) => setMessage({ tone, text })}
        />
      )}
      {clearOpen && (
        <ConfirmationDialog
          title={t("clearTitle")}
          description={t("clearDescription")}
          confirmLabel={t("clearConfirm")}
          danger
          pending={clearing}
          onCancel={() => setClearOpen(false)}
          onConfirm={() => void handleClear()}
        />
      )}
      {vault && editing && (
        <LocalAccountEditor
          account={editing}
          onCancel={() => setEditing(null)}
          onDelete={async () => {
            await session.mutate((current) => deleteLocalAccount(current, editing.id));
            captureAnalyticsEvent(ANALYTICS_EVENTS.localAuthenticatorAccountDeleted);
            setEditing(null);
          }}
          onSave={async (configuration) => {
            await session.mutate((current) => updateLocalAccount(current, editing.id, configuration));
            captureAnalyticsEvent(ANALYTICS_EVENTS.localAuthenticatorAccountUpdated);
            setEditing(null);
          }}
          onError={(text) => setMessage({ tone: "danger", text })}
        />
      )}
    </AppPage>
  );
}

function CreateLocalVaultForm({ onCreate }: { onCreate: (passphrase: string, name: string) => Promise<void> }) {
  const t = useTranslations("LocalVault");
  const [visible, setVisible] = useState(false);
  const form = useForm({
    defaultValues: { name: "", passphrase: "", confirmation: "" },
    onSubmit: async ({ value }) => onCreate(value.passphrase, value.name),
  });
  useEffect(
    () =>
      subscribeToLocalVaultLock(() => {
        form.reset();
        setVisible(false);
      }),
    [form],
  );
  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <SectionHeading icon={ShieldCheck} title={t("createTitle")} description={t("createDescription")} />
      <form.Field name="name" validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : t("nameRequired")) }}>
        {(field) => (
          <div className="grid gap-2">
            <Label htmlFor="local-vault-name">{t("name")}</Label>
            <Input
              id="local-vault-name"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
              aria-describedby="local-vault-name-help local-vault-name-error"
              required
            />
            <p id="local-vault-name-help" className="text-xs leading-5 text-muted-foreground">
              {t("nameHelp")}
            </p>
            <FormFieldError id="local-vault-name-error" errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field
        name="passphrase"
        validators={{ onSubmit: ({ value }) => (value.trim().length >= 3 ? undefined : t("passphraseRequired")) }}
      >
        {(field) => (
          <div className="grid gap-2">
            <Label htmlFor="local-vault-passphrase">{t("passphrase")}</Label>
            <PasswordInput
              id="local-vault-passphrase"
              label={t("passphrase")}
              visible={visible}
              onToggleVisibility={() => setVisible((current) => !current)}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
              aria-describedby="local-vault-passphrase-help local-vault-passphrase-error"
              required
            />
            <p id="local-vault-passphrase-help" className="text-xs leading-5 text-muted-foreground">
              {t("passphraseHelp")}
            </p>
            <FormFieldError id="local-vault-passphrase-error" errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Field
        name="confirmation"
        validators={{
          onSubmit: ({ value }) => (value === form.state.values.passphrase ? undefined : t("passphraseMismatch")),
        }}
      >
        {(field) => (
          <div className="grid gap-2">
            <Label htmlFor="local-vault-passphrase-confirm">{t("passphraseConfirm")}</Label>
            <PasswordInput
              id="local-vault-passphrase-confirm"
              label={t("passphraseConfirm")}
              visible={visible}
              onToggleVisibility={() => setVisible((current) => !current)}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
              aria-describedby="local-vault-passphrase-confirm-error"
              required
            />
            <FormFieldError id="local-vault-passphrase-confirm-error" errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? t("creating") : t("create")}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

function UnlockLocalVaultForm({
  onUnlock,
  onMigrate,
}: {
  onUnlock: (passphrase: string) => Promise<void>;
  onMigrate?: (passphrase: string) => Promise<void>;
}) {
  const t = useTranslations("LocalVault");
  const [visible, setVisible] = useState(false);
  const form = useForm({
    defaultValues: { passphrase: "" },
    onSubmit: async ({ value }) => onUnlock(value.passphrase),
  });
  useEffect(
    () =>
      subscribeToLocalVaultLock(() => {
        form.reset();
        setVisible(false);
      }),
    [form],
  );
  return (
    <form
      noValidate
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <SectionHeading icon={LockKeyhole} title={t("unlockTitle")} description={t("unlockDescription")} />
      <form.Field
        name="passphrase"
        validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : t("passphraseRequired")) }}
      >
        {(field) => (
          <div className="grid gap-2">
            <Label htmlFor="local-vault-unlock">{t("passphrase")}</Label>
            <PasswordInput
              id="local-vault-unlock"
              label={t("passphrase")}
              visible={visible}
              onToggleVisibility={() => setVisible((current) => !current)}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
              aria-describedby="local-vault-unlock-error"
              required
            />
            <FormFieldError id="local-vault-unlock-error" errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <>
            <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
              {isSubmitting ? t("unlocking") : t("unlock")}
            </Button>
            {onMigrate && (
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => void onMigrate(form.state.values.passphrase)}
              >
                {t("migrate")}
              </Button>
            )}
          </>
        )}
      </form.Subscribe>
    </form>
  );
}

type LocalVaultOperationExecutor = <Result>(
  operation: (vault: UnlockedLocalVault) => Promise<Result>,
  clearStaleResult?: (result: Result) => void,
) => Promise<Result>;

function clearArchiveExportResult(result: { archive: Uint8Array; key: Uint8Array }): void {
  result.archive.fill(0);
  result.key.fill(0);
}

function UnlockedLocalVaultView({
  vault,
  lastArchiveExportAt,
  onLock,
  onClear,
  onRename,
  runMutation,
  performSensitiveWorkflow,
  refresh,
  onEdit,
  onError,
  onStatus,
}: {
  vault: UnlockedLocalVault;
  lastArchiveExportAt: string | null | undefined;
  onLock: () => void;
  onClear: () => void;
  onRename: (name: string) => Promise<void>;
  runMutation: <Result>(operation: (vault: UnlockedLocalVault) => Promise<Result>) => Promise<Result>;
  performSensitiveWorkflow: <Result>(
    operation: (vault: UnlockedLocalVault) => Promise<Result>,
    clearStaleResult?: (result: Result) => void,
  ) => Promise<Result>;
  refresh: () => Promise<void>;
  onEdit: (account: UnlockedLocalVaultAccount) => void;
  onError: (message: string) => void;
  onStatus: (tone: "success" | "warning", message: string) => void;
}) {
  const t = useTranslations("LocalVault");
  const locale = useLocale();
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [activeTab, setActiveTab] = useState("vault");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTagFilters, setSelectedTagFilters] = useState<string[]>([]);
  const [reminderDismissed, setReminderDismissed] = useState(false);
  const availableTags = [...new Set(vault.accounts.flatMap((account) => account.tags ?? []))];
  const activeTagFilters = selectedTagFilters.filter((tag) => availableTags.includes(tag));
  const visibleAccounts = vault.accounts.filter(
    (account) =>
      matchesAuthenticatorAccountTagFilter(account.tags, activeTagFilters) &&
      matchesAuthenticatorAccountSearch(account, searchQuery),
  );
  const hasSearchQuery = searchQuery.trim().length > 0;
  async function add(configuration: TotpConfiguration): Promise<boolean> {
    try {
      await runMutation((current) => addLocalAccount(current, configuration));
      captureAnalyticsEvent(ANALYTICS_EVENTS.localAuthenticatorAccountCreated);
      setActiveTab("vault");
      return true;
    } catch {
      configuration.secret.fill(0);
      onError(t("duplicate"));
      return false;
    }
  }
  async function backup() {
    setExporting(true);
    try {
      let result: { archive: Uint8Array; key: Uint8Array } | undefined;
      try {
        result = await performSensitiveWorkflow((current) => exportLocalVault(current), clearArchiveExportResult);
        download(result.archive, "local-vault.rhasia-vault");
        const encodedKey = new TextEncoder().encode(bytesToBase64(result.key));
        try {
          download(encodedKey, "local-vault.key.txt", "text/plain");
        } finally {
          encodedKey.fill(0);
        }
      } catch (error) {
        if (!(error instanceof LocalVaultSessionLockedError)) onError(t("backupError"));
        return;
      } finally {
        result?.archive.fill(0);
        result?.key.fill(0);
      }

      try {
        await runMutation((current) => recordLocalArchiveExport(current, new Date().toISOString()));
      } catch (error) {
        if (!(error instanceof LocalVaultSessionLockedError)) onError(t("archiveExportMarkerError"));
        return;
      }
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultArchiveExportPrepared, { account_count: vault.accounts.length });
      onStatus("success", t("archiveReady"));
    } finally {
      setExporting(false);
    }
  }
  const tAccounts = useTranslations("AuthenticatorAccount.accounts");
  return (
    <SurfaceCard className="p-0">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mx-5 mt-5 grid-cols-4 sm:mx-6 sm:mt-6">
          <TabsTrigger value="vault">{vault.name}</TabsTrigger>
          <TabsTrigger value="add">{t("addTab")}</TabsTrigger>
          <TabsTrigger value="backup">{t("backupTab")}</TabsTrigger>
          <TabsTrigger value="advanced" aria-label={t("advancedTab")} title={t("advancedTab")}>
            {t("advancedTab")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="vault" className="mt-0">
          <div className="grid gap-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">{t("deviceOnly")}</p>
                <h2 className="mt-1 text-xl font-bold text-ink-strong">{vault.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("offline")}</p>
              </div>
              <div className="flex items-center gap-2">
                <AccountTagsFilter
                  availableTags={availableTags}
                  selectedTags={activeTagFilters}
                  onSelectedTagsChange={setSelectedTagFilters}
                />
                <Button type="button" onClick={() => setActiveTab("add")}>
                  <Plus aria-hidden="true" />
                  {t("addTab")}
                </Button>
              </div>
            </div>
            <AccountDirectorySearch
              query={searchQuery}
              inputId="local-vault-account-search"
              panelId="local-vault-account-search-panel"
              onQueryChange={setSearchQuery}
            />
            {!reminderDismissed && (
              <StatusBanner tone="info" title={t("archiveReminderTitle")} role="status">
                <p>{t("archiveReminderDescription")}</p>
                <p className="mt-1">
                  {lastArchiveExportAt === undefined
                    ? t("archiveReminderMarkerUnavailable")
                    : lastArchiveExportAt
                      ? t("archiveReminderLastExport", { date: formatLocalDateTime(lastArchiveExportAt, locale) })
                      : t("archiveReminderNoExport")}
                </p>
                <p className="mt-1">{t("archiveReminderCaveat")}</p>
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setReminderDismissed(true)}>
                    {t("dismissArchiveReminder")}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setActiveTab("backup")}>
                    {t("openArchiveTools")}
                  </Button>
                </div>
              </StatusBanner>
            )}
          </div>
          <div className="border-t border-border">
            {visibleAccounts.length ? (
              <ul className="grid list-none gap-3 p-5 sm:p-6">
                {visibleAccounts.map((account) => (
                  <li key={account.id}>
                    <TotpAccountButton
                      configuration={account}
                      vaultName={vault.name}
                      onManage={() => onEdit(account)}
                    />
                  </li>
                ))}
              </ul>
            ) : hasSearchQuery ? (
              <AccountSearchEmptyState
                onClearSearch={() => setSearchQuery("")}
                onClearFilters={
                  activeTagFilters.length > 0
                    ? () => {
                        setSearchQuery("");
                        setSelectedTagFilters([]);
                      }
                    : undefined
                }
              />
            ) : vault.accounts.length > 0 ? (
              <div className="grid justify-items-center gap-3 p-6 text-center">
                <p className="font-bold text-foreground">{tAccounts("emptyTagged")}</p>
                <Button type="button" variant="outline" onClick={() => setSelectedTagFilters([])}>
                  {tAccounts("clearTags")}
                </Button>
              </div>
            ) : (
              <div className="grid justify-items-center gap-3 p-6 text-center">
                <p className="text-sm text-muted-foreground">{t("empty")}</p>
                <Button type="button" onClick={() => setActiveTab("add")}>
                  {t("addTitle")}
                </Button>
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="add" className="mt-0">
          <AddLocalAccountForm onAdd={add} />
        </TabsContent>
        <TabsContent value="backup" className="mt-0 p-5 sm:p-6">
          <div className="mb-4">
            <h2 className="font-bold text-ink-strong">{t("backupTitle")}</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{t("backupDescription")}</p>
          </div>
          <div className="grid gap-4">
            <section className="grid gap-3 rounded-md border border-border p-4">
              <h3 className="font-bold text-ink-strong">{t("export")}</h3>
              <p className="text-sm leading-5 text-muted-foreground">{t("exportDescription")}</p>
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  className="w-full sm:w-fit"
                  onClick={() => void backup()}
                  disabled={exporting}
                >
                  <Download />
                  {exporting ? t("exporting") : t("export")}
                </Button>
              </div>
            </section>
            <LocalArchiveImporter
              runMutation={runMutation}
              performSensitiveWorkflow={performSensitiveWorkflow}
              refresh={refresh}
              onError={onError}
              onStatus={onStatus}
              importing={importing}
              setImporting={setImporting}
            />
          </div>
        </TabsContent>
        <TabsContent value="advanced" className="mt-0 p-5 sm:p-6">
          <LocalVaultSettings vault={vault} onLock={onLock} onClear={onClear} onRename={onRename} onError={onError} />
        </TabsContent>
      </Tabs>
    </SurfaceCard>
  );
}

export function AddLocalAccountForm({ onAdd }: { onAdd: (configuration: TotpConfiguration) => Promise<boolean> }) {
  const t = useTranslations("LocalVault");
  const tError = useTranslations("OtpRuntime.errors");
  const [configuration, setConfiguration] = useState<TotpConfiguration | null>(null);
  const configurationRef = useRef<TotpConfiguration | null>(null);
  const mountedRef = useRef(true);
  const [parseError, setParseError] = useState<TotpConfigurationErrorCode | null>(null);
  const form = useForm({
    defaultValues: { uri: "", label: "" },
    onSubmit: async ({ value }) => {
      const current = configurationRef.current;
      if (!current) return;
      try {
        await onAdd({ ...current, accountName: value.label.trim() });
      } finally {
        current.secret.fill(0);
        if (configurationRef.current === current) replaceConfiguration(null);
        if (mountedRef.current) form.reset();
      }
    },
  });
  function replaceConfiguration(next: TotpConfiguration | null) {
    if (configurationRef.current !== next) configurationRef.current?.secret.fill(0);
    configurationRef.current = next;
    if (mountedRef.current) setConfiguration(next);
  }
  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = subscribeToLocalVaultLock(() => {
      configurationRef.current?.secret.fill(0);
      configurationRef.current = null;
      form.reset();
      setConfiguration(null);
      setParseError(null);
    });
    return () => {
      unsubscribe();
      mountedRef.current = false;
      configurationRef.current?.secret.fill(0);
      configurationRef.current = null;
    };
  }, [form]);
  function importUri(uri: string) {
    try {
      const parsed = parseTotpUri(uri);
      replaceConfiguration(parsed);
      setParseError(null);
      form.setFieldValue("uri", uri);
      form.setFieldValue("label", parsed.accountName);
    } catch (reason) {
      replaceConfiguration(null);
      setParseError(reason instanceof TotpConfigurationError ? reason.code : "invalidUri");
    }
  }
  return (
    <div className="grid gap-5 p-5 sm:p-6">
      {configuration ? (
        <form
          noValidate
          className="grid gap-4 rounded-lg border border-border bg-muted/30 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-ink-strong">{t("reviewTitle")}</h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("reviewDescription")}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                replaceConfiguration(null);
                form.reset();
              }}
            >
              {t("importAnother")}
            </Button>
          </div>
          <form.Field
            name="label"
            validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : t("labelRequired")) }}
          >
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="local-account-label">{t("label")}</Label>
                <Input
                  id="local-account-label"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby="local-account-label-error"
                  required
                />
                <FormFieldError id="local-account-label-error" errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t("saving") : t("save")}
              </Button>
            )}
          </form.Subscribe>
        </form>
      ) : (
        <>
          <QrImportInput onUri={importUri} className="p-0 sm:p-0" />
          {parseError && (
            <StatusBanner tone="danger" role="alert">
              {tError(parseError)}
            </StatusBanner>
          )}
        </>
      )}
    </div>
  );
}

function LocalAccountEditor({
  account,
  onCancel,
  onDelete,
  onSave,
  onError,
}: {
  account: UnlockedLocalVaultAccount;
  onCancel: () => void;
  onDelete: () => Promise<void>;
  onSave: (configuration: AccountPayloadConfiguration) => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations("LocalVault");
  const tCommon = useTranslations("Common");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const tTags = useTranslations("AuthenticatorAccount.manager");
  const form = useForm({
    defaultValues: { label: account.accountName, tags: account.tags ?? [], tagDraft: "" },
    onSubmit: async ({ value }) => onSave({ ...account, accountName: value.label.trim(), tags: value.tags }),
  });
  function validateTags(tags: string[]): string | undefined {
    try {
      normalizeAuthenticatorAccountTags(tags);
      return undefined;
    } catch (error) {
      if (error instanceof AccountTagValidationError) return tTags(`tagErrors.${error.code}`);
      return tTags("tagErrors.notArray");
    }
  }
  function validateTagDraft(draft: string, tags: string[]): string | undefined {
    if (!draft.trim()) return undefined;
    return validateTags([...tags, draft.trim()]);
  }
  async function remove() {
    setDeleting(true);
    try {
      await onDelete();
      setDeleteOpen(false);
    } catch (error) {
      onError(
        error instanceof LocalVaultConcurrentAccountUpdateError ? t("concurrentAccountUpdate") : t("operationError"),
      );
    } finally {
      setDeleting(false);
    }
  }
  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onCancel();
        }}
      >
        <DialogContent
          className="max-w-md rounded-lg border-border bg-card p-5 shadow-sheet"
          closeLabel={tCommon("close")}
        >
          <DialogTitle className="sr-only">{t("edit")}</DialogTitle>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void form
                .handleSubmit()
                .catch((error: unknown) =>
                  onError(
                    error instanceof LocalVaultConcurrentAccountUpdateError
                      ? t("concurrentAccountUpdate")
                      : t("operationError"),
                  ),
                );
            }}
          >
            <SectionHeading icon={KeyRound} title={t("edit")} />
            <form.Field
              name="label"
              validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : t("labelRequired")) }}
            >
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor="edit-local-account-label">{t("label")}</Label>
                  <Input
                    id="edit-local-account-label"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    required
                  />
                </div>
              )}
            </form.Field>
            <form.Field
              name="tags"
              validators={{
                onChange: ({ value }) => validateTags(value),
                onSubmit: ({ value }) => validateTags(value),
              }}
            >
              {(tagsField) => (
                <form.Field
                  name="tagDraft"
                  validators={{
                    onChange: ({ value }) => validateTagDraft(value, form.getFieldValue("tags")),
                    onSubmit: ({ value }) => (value.trim() ? tTags("tagDraftNotAdded") : undefined),
                  }}
                >
                  {(draftField) => (
                    <AccountTagsEditor
                      tags={tagsField.state.value}
                      draft={draftField.state.value}
                      errors={draftField.state.meta.errors}
                      inputId="edit-local-account-tag"
                      errorId="edit-local-account-tag-error"
                      disabled={false}
                      busy={deleting}
                      onDraftChange={draftField.handleChange}
                      onAdd={() => {
                        const tag = draftField.state.value.trim();
                        if (!tag || draftField.state.meta.errors.length > 0) return;
                        tagsField.handleChange([...tagsField.state.value, tag]);
                        draftField.handleChange("");
                      }}
                      onRemove={(index) =>
                        tagsField.handleChange(tagsField.state.value.filter((_, tagIndex) => tagIndex !== index))
                      }
                    />
                  )}
                </form.Field>
              )}
            </form.Field>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" className="w-full" onClick={onCancel}>
                  {t("cancel")}
                </Button>
                <Button type="submit" className="w-full">
                  {t("update")}
                </Button>
              </div>
              <span className="h-px bg-border" aria-hidden="true" />
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-center text-destructive hover:text-destructive"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 />
                {t("delete")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {deleteOpen && (
        <ConfirmationDialog
          title={t("deleteTitle")}
          description={t("deleteDescription")}
          confirmLabel={t("deleteConfirm")}
          danger
          pending={deleting}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={() => void remove()}
        />
      )}
    </>
  );
}

function LocalVaultSettings({
  vault,
  onLock,
  onClear,
  onRename,
  onError,
}: {
  vault: UnlockedLocalVault;
  onLock: () => void;
  onClear: () => void;
  onRename: (name: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const t = useTranslations("LocalVault");
  const form = useForm({
    defaultValues: { name: vault.name },
    onSubmit: async ({ value }) => {
      try {
        await onRename(value.name);
      } catch {
        onError(t("operationError"));
      }
    },
  });
  return (
    <div className="grid gap-5">
      <SectionHeading icon={Settings} title={t("advancedTitle")} description={t("advancedDescription")} />
      <section className="grid gap-4 rounded-lg border border-border p-4">
        <div>
          <h2 className="font-bold text-ink-strong">{t("renameTitle")}</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{t("renameDescription")}</p>
        </div>
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.Field
            name="name"
            validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : t("nameRequired")) }}
          >
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="rename-local-vault">{t("name")}</Label>
                <Input
                  id="rename-local-vault"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  aria-invalid={field.state.meta.errors.length > 0}
                  aria-describedby="rename-local-vault-error"
                  required
                />
                <FormFieldError id="rename-local-vault-error" errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
          <form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <div className="flex justify-end">
                <Button className="w-full sm:w-fit" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? t("renaming") : t("rename")}
                </Button>
              </div>
            )}
          </form.Subscribe>
        </form>
      </section>
      <section className="grid gap-3 rounded-lg border border-border p-4">
        <div>
          <h2 className="font-bold text-ink-strong">{t("lock")}</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{t("lockDescription")}</p>
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="outline" className="w-full sm:w-fit" onClick={onLock}>
            <LockKeyhole />
            {t("lock")}
          </Button>
        </div>
      </section>
      <section className="grid gap-3 rounded-lg border border-destructive/30 p-4">
        <div>
          <h2 className="font-bold text-ink-strong">{t("clear")}</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{t("clearDescription")}</p>
        </div>
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            className="w-full text-destructive hover:text-destructive sm:w-fit"
            onClick={onClear}
          >
            <Trash2 />
            {t("clear")}
          </Button>
        </div>
      </section>
    </div>
  );
}

export function LocalArchiveImporter({
  runMutation,
  performSensitiveWorkflow,
  refresh,
  onError,
  onStatus,
  importing,
  setImporting,
}: {
  runMutation: <Result>(operation: (vault: UnlockedLocalVault) => Promise<Result>) => Promise<Result>;
  performSensitiveWorkflow: <Result>(
    operation: (vault: UnlockedLocalVault) => Promise<Result>,
    clearStaleResult?: (result: Result) => void,
  ) => Promise<Result>;
  refresh: () => Promise<void>;
  onError: (message: string) => void;
  onStatus: (tone: "success" | "warning", message: string) => void;
  importing: boolean;
  setImporting: (value: boolean) => void;
}) {
  const t = useTranslations("LocalVault");
  const [archive, setArchive] = useState<File | null>(null);
  const [key, setKey] = useState<File | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [review, setReview] = useState<LocalVaultArchiveImportReview | null>(null);
  const archiveInput = useRef<HTMLInputElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);

  async function withArchiveBytes<Result>(
    execute: LocalVaultOperationExecutor,
    operation: (vault: UnlockedLocalVault, keyBytes: Uint8Array, archiveBytes: Uint8Array) => Promise<Result>,
    clearStaleResult?: (result: Result) => void,
  ): Promise<Result | undefined> {
    if (!archive || !key) return undefined;
    return execute(async (vault) => {
      let keyBytes: Uint8Array | undefined;
      let archiveBytes: Uint8Array | undefined;
      try {
        keyBytes = base64ToBytes((await key.text()).trim());
        archiveBytes = new Uint8Array(await archive.arrayBuffer());
        return await operation(vault, keyBytes, archiveBytes);
      } finally {
        keyBytes?.fill(0);
        archiveBytes?.fill(0);
      }
    }, clearStaleResult);
  }

  async function reviewImport() {
    if (!archive || !key) return;
    setReviewing(true);
    setReview(null);
    try {
      const summary = await withArchiveBytes(
        performSensitiveWorkflow,
        (current, keyBytes, archiveBytes) => previewLocalVaultArchiveImport(current, keyBytes, archiveBytes),
        () => setReview(null),
      );
      if (summary) setReview(summary);
    } catch (error) {
      if (!(error instanceof LocalVaultSessionLockedError)) onError(t("importError"));
    } finally {
      setReviewing(false);
    }
  }

  async function restore(allowDuplicates: boolean) {
    if (!archive || !key || !review) return;
    setImporting(true);
    try {
      const count = await withArchiveBytes(runMutation, (current, keyBytes, archiveBytes) =>
        importLocalVaultArchive(current, keyBytes, archiveBytes, allowDuplicates),
      );
      if (count === undefined) return;
      await refresh();
      captureAnalyticsEvent(ANALYTICS_EVENTS.localVaultArchiveImportCompleted, { account_count: count });
      const feedback = localVaultArchiveImportFeedback(count);
      if (feedback.message === "noNewAccounts") onStatus(feedback.tone, t("noNewAccounts"));
      else onStatus(feedback.tone, t("imported", { count: feedback.count }));
      setReview(null);
      setArchive(null);
      setKey(null);
      if (archiveInput.current) archiveInput.current.value = "";
      if (keyInput.current) keyInput.current.value = "";
    } catch (error) {
      if (!(error instanceof LocalVaultSessionLockedError)) onError(t("importError"));
    } finally {
      setImporting(false);
    }
  }

  function cancelReview() {
    setReview(null);
  }

  return (
    <div className="grid gap-3 rounded-md border border-border p-3">
      <p className="text-sm font-bold">{t("import")}</p>
      <p className="text-xs leading-5 text-muted-foreground">{t("importDescription")}</p>
      <Label className="grid gap-2 text-xs leading-5">
        {t("archiveFile")}
        <Input
          ref={archiveInput}
          type="file"
          accept=".rhasia-vault,.rhasia,application/octet-stream"
          disabled={reviewing || importing}
          onChange={(event) => {
            setArchive(event.target.files?.[0] ?? null);
            setReview(null);
          }}
        />
      </Label>
      <Label className="grid gap-2 text-xs leading-5">
        {t("keyFile")}
        <Input
          ref={keyInput}
          type="file"
          accept=".txt,text/plain"
          disabled={reviewing || importing}
          onChange={(event) => {
            setKey(event.target.files?.[0] ?? null);
            setReview(null);
          }}
        />
      </Label>
      {!review && (
        <div className="flex justify-end">
          <Button
            variant="outline"
            className="w-full sm:w-fit"
            onClick={() => void reviewImport()}
            disabled={!archive || !key || reviewing || importing}
          >
            {reviewing ? t("reviewingImport") : t("reviewImport")}
          </Button>
        </div>
      )}
      {review && (
        <section
          className="grid gap-3 rounded-md border border-border p-3"
          aria-labelledby="local-archive-review-title"
        >
          <div className="grid gap-1">
            <h3 id="local-archive-review-title" className="font-bold text-ink-strong">
              {t("importReviewTitle")}
            </h3>
            <p className="text-xs leading-5 text-muted-foreground">{t("importReviewDescription")}</p>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("importSourceVault")}</dt>
              <dd className="break-words font-medium">{review.sourceVaultName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("importDestinationVault")}</dt>
              <dd className="break-words font-medium">{review.destinationVaultName}</dd>
            </div>
          </dl>
          <p className="text-sm font-medium">{t("importReviewAccountCount", { count: review.accounts.length })}</p>
          <ul className="grid max-h-56 gap-2 overflow-y-auto rounded-md border border-border p-3 text-sm">
            {review.accounts.map((account, index) => (
              <li key={`${account.issuer}:${account.accountName}:${index}`} className="flex flex-wrap gap-x-2">
                <span className="break-words">
                  {account.issuer} · {account.accountName}
                </span>
                {account.duplicate && <span className="font-semibold text-warning">{t("importDuplicateLabel")}</span>}
              </li>
            ))}
          </ul>
          {review.duplicateCount > 0 ? (
            <StatusBanner tone="warning" role="status">
              <span className="grid gap-1">
                <span>{t("importDuplicateCount", { count: review.duplicateCount })}</span>
                <span>{t("importDuplicateDescription")}</span>
              </span>
            </StatusBanner>
          ) : (
            <StatusBanner tone="info" role="status">
              {t("importNoDuplicates")}
            </StatusBanner>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-fit"
              onClick={cancelReview}
              disabled={importing}
            >
              {t("cancelReview")}
            </Button>
            {review.duplicateCount > 0 ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full sm:w-fit"
                  onClick={() => void restore(false)}
                  disabled={importing}
                >
                  {importing ? t("importing") : t("restoreNewAccounts")}
                </Button>
                <Button
                  type="button"
                  className="w-full sm:w-fit"
                  onClick={() => void restore(true)}
                  disabled={importing}
                >
                  {importing ? t("importing") : t("addDuplicatesAnyway")}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                className="w-full sm:w-fit"
                onClick={() => void restore(false)}
                disabled={importing}
              >
                {importing ? t("importing") : t("confirmImport")}
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function download(bytes: Uint8Array, filename: string, type = "application/octet-stream"): void {
  browserDownload.download({ bytes, filename, mediaType: type });
}
