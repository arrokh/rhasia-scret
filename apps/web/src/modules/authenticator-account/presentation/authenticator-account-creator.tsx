"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseTotpUri, TotpConfigurationError, type TotpConfigurationErrorCode } from "@/modules/otp-runtime";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { SectionHeading, StatusBanner } from "@/shared/presentation/app-ui";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { PasswordInput } from "@/shared/presentation/password-input";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { encryptAccountConfiguration, isDuplicateAccount, type DecryptedAuthenticatorAccount } from "../infrastructure/browser-account-payload";
import { loadUnlockedVaultWorkspace, type UnlockedVaultWorkspace } from "../infrastructure/browser-vault-workspace";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { QrImportInput } from "./qr-import-input";
import { useUnlockedVaultWorkspace } from "./unlocked-vault-workspace-provider";
import { useCreateEncryptedAuthenticatorAccountMutation } from "./hooks/use-authenticator-account-mutations";

type CreatorMessage =
  | { source: "creator"; key: "addError" | "unlockError" | "destinationUnavailable" }
  | { source: "creator"; key: "unavailableVaults"; count: number }
  | { source: "totp"; key: TotpConfigurationErrorCode };

class AccountCreatorError extends Error {
  public constructor(public readonly code: "destinationUnavailable") { super(code); }
}

export function AuthenticatorAccountCreator({ personalVaultId, preferredVaultId }: { personalVaultId: string; preferredVaultId?: string }) {
  const t = useTranslations("AuthenticatorAccount.creator");
  const tCommon = useTranslations("Common");
  const tTotpError = useTranslations("OtpRuntime.errors");
  const router = useRouter();
  const online = useOnlineStatus();
  const { workspace, setWorkspace, refreshWorkspaceAuthorization } = useUnlockedVaultWorkspace();
  const [duplicate, setDuplicate] = useState<DecryptedAuthenticatorAccount | null>(null);
  const [secretVisible, setSecretVisible] = useState(false);
  const [message, setMessage] = useState<CreatorMessage | null>(null);
  const createAccountMutation = useCreateEncryptedAuthenticatorAccountMutation();
  const initialVaultId = workspace ? selectWritableVaultId(workspace, preferredVaultId) : "";
  const accountForm = useForm({
    defaultValues: { selectedVaultId: initialVaultId, uri: "", accountLabel: "" },
    onSubmit: async ({ value }) => {
      if (!workspace || !online) return;
      try {
        const candidate = { ...parseTotpUri(value.uri), accountName: value.accountLabel.trim() };
        if (isDuplicateAccount(candidate, workspace.accounts.filter((account) => account.vaultId === value.selectedVaultId))) { setDuplicate(candidate); return; }
        await save(candidate, value.selectedVaultId);
      } catch (reason) { setMessage(classifyCreatorError(reason)); }
    }
  });

  function updateAuthenticatorUri(uri: string) {
    try {
      const configuration = parseTotpUri(uri);
      accountForm.setFieldValue("uri", uri);
      accountForm.setFieldValue("accountLabel", configuration.accountName);
      configuration.secret.fill(0);
      setMessage(null);
    } catch (reason) {
      setMessage(classifyCreatorError(reason));
    }
  }

  function clearImportedAuthenticator() {
    accountForm.setFieldValue("uri", "");
    accountForm.setFieldValue("accountLabel", "");
    setDuplicate(null);
    setMessage(null);
  }
  function openWorkspace(unlocked: UnlockedVaultWorkspace) {
    setWorkspace(unlocked);
    accountForm.setFieldValue("selectedVaultId", selectWritableVaultId(unlocked, preferredVaultId));
    setMessage(unlocked.unavailableSharedVaults > 0 ? { source: "creator", key: "unavailableVaults", count: unlocked.unavailableSharedVaults } : null);
  }

  const unlockForm = useForm({ defaultValues: { secret: "" }, onSubmit: async ({ value }) => { try { openWorkspace(await loadUnlockedVaultWorkspace(value.secret, personalVaultId)); unlockForm.reset(); } catch { setMessage({ source: "creator", key: "unlockError" }); } } });

  async function saveDuplicate() { if (!duplicate) return; try { await save(duplicate, accountForm.state.values.selectedVaultId); } catch (reason) { setMessage(classifyCreatorError(reason)); } }
  async function save(candidate: DecryptedAuthenticatorAccount, selectedVaultId: string) {
    if (!workspace) return;
    const vault = workspace.vaults.find((entry) => entry.id === selectedVaultId);
    if (!vault || !vault.effectiveAccountPermissions.permissions.canAddAccounts) throw new AccountCreatorError("destinationUnavailable");
    const encryptedPayload = await encryptAccountConfiguration(vault.key, candidate, { purpose: "authenticator-account", payloadType: "totp-configuration", vaultId: vault.id, keyVersion: 1 });
    let created: { id: string; revision: number };
    try {
      created = await createAccountMutation.mutateAsync({ vaultId: vault.id, vaultType: vault.type, encryptedPayload: bytesToBase64(encryptedPayload), encryptionVersion: 1 });
    } catch (error) {
      if (error instanceof BrowserApiError && error.status === 403 && error.code === "account_permission_required") {
        await refreshWorkspaceAuthorization();
        throw new AccountCreatorError("destinationUnavailable");
      }
      throw error;
    }
    setWorkspace({ ...workspace, accounts: [...workspace.accounts, { ...candidate, id: created.id, revision: created.revision, vaultId: vault.id, vaultName: vault.name, vaultType: vault.type }].sort((left, right) => left.issuer.localeCompare(right.issuer) || left.accountName.localeCompare(right.accountName)) });
    captureAnalyticsEvent("authenticator_account_created", { vault_type: vault.type });
    setDuplicate(null); router.push("/vaults");
  }

  const renderedMessage = message?.source === "totp" ? tTotpError(message.key) : message?.key === "unavailableVaults" ? t(message.key, { count: message.count }) : message ? t(message.key) : null;

  if (!workspace) return (
    <form noValidate className="grid gap-5 p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void unlockForm.handleSubmit(); }}>
      <SectionHeading icon={KeyRound} title={t("unlockTitle")} description={t("unlockDescription")} />
      <unlockForm.Field name="secret" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("passphraseRequired") }}>{(field) => <Field><Label htmlFor="account-vault-unlock-secret">{t("passphrase")}</Label><PasswordInput id="account-vault-unlock-secret" label={t("passphrase")} visible={secretVisible} onToggleVisibility={() => setSecretVisible((visible) => !visible)} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "account-unlock-error" : undefined} required /><FormFieldError id="account-unlock-error" errors={field.state.meta.errors} /></Field>}</unlockForm.Field>
      <unlockForm.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>{isSubmitting && <LoaderCircle className="animate-spin" />}{isSubmitting ? t("unlocking") : t("continue")}</Button>}</unlockForm.Subscribe>
      {renderedMessage && <StatusBanner tone="danger" role="alert">{renderedMessage}</StatusBanner>}
    </form>
  );

  const writableVaults = workspace.vaults.filter((vault) => vault.effectiveAccountPermissions.permissions.canAddAccounts);
  return <>
    {!online && <div className="m-5 mb-0"><StatusBanner tone="offline">{t("offline")}</StatusBanner></div>}
    <accountForm.Subscribe selector={(state) => state.values.uri}>{(uri) => uri ? <form noValidate className="grid gap-5 bg-muted/30 p-5 sm:p-6" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void accountForm.handleSubmit(); }}>
      <SectionHeading icon={ShieldCheck} title={t("reviewTitle")} description={t("reviewDescription")} action={<Button type="button" variant="ghost" size="sm" onClick={clearImportedAuthenticator}>{t("importAnother")}</Button>} />
      <accountForm.Field name="selectedVaultId" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("destinationRequired") }}>{(field) => <Field><Label htmlFor="account-target-vault">{t("saveTo")}</Label><Select value={field.state.value} onValueChange={field.handleChange}><SelectTrigger id="account-target-vault" className="h-12 w-full bg-card" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "account-target-vault-error" : undefined}><SelectValue placeholder={t("selectVault")} /></SelectTrigger><SelectContent>{writableVaults.map((vault) => <SelectItem key={vault.id} value={vault.id}>{vault.name}</SelectItem>)}</SelectContent></Select><FormFieldError id="account-target-vault-error" errors={field.state.meta.errors} /></Field>}</accountForm.Field>
      <accountForm.Field name="uri" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("uriRequired") }}>{(field) => <Field><Label htmlFor="account-uri">{t("uri")}</Label><Input id="account-uri" value={field.state.value} placeholder={t("uriPlaceholder")} autoComplete="off" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "account-uri-error" : "account-uri-help"} required readOnly /><p id="account-uri-help" className="text-xs text-muted-foreground">{t("uriHelp")}</p><FormFieldError id="account-uri-error" errors={field.state.meta.errors} /></Field>}</accountForm.Field>
      <accountForm.Subscribe selector={(state) => state.values.uri}>{(reviewUri) => { const metadata = parseAuthenticatorMetadata(reviewUri); if (!metadata) return null; const details: Array<[string, string | number]> = [[t("issuer"), metadata.issuer], [t("algorithm"), metadata.algorithm], [t("digits"), metadata.digits], [t("period"), t("periodSeconds", { seconds: metadata.period })]]; return <section className="grid gap-4 rounded-lg border border-warning/25 bg-warning-surface p-4" aria-labelledby="authenticator-metadata-title"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold tracking-wider text-warning uppercase">{t("preview")}</p><h3 id="authenticator-metadata-title" className="mt-1 font-bold text-ink-strong">{t("metadata")}</h3></div><Badge className="bg-success-surface text-success">{t("secretDetected")}</Badge></div><accountForm.Field name="accountLabel" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("accountLabelRequired") }}>{(field) => <Field><Label htmlFor="account-label">{t("accountLabel")}</Label><Input id="account-label" value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "account-label-help account-label-error" : "account-label-help"} required /><p id="account-label-help" className="text-xs leading-5 text-muted-foreground">{t("accountLabelHelp")}</p><FormFieldError id="account-label-error" errors={field.state.meta.errors} /></Field>}</accountForm.Field><dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">{details.map(([term, value]) => <div key={term} className="rounded-md bg-card p-3"><dt className="text-[0.68rem] font-bold text-muted-foreground uppercase">{term}</dt><dd className="mt-1 truncate text-sm font-bold text-foreground">{value}</dd></div>)}</dl></section>; }}</accountForm.Subscribe>
      <accountForm.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <Button type="submit" disabled={!online || isSubmitting} aria-busy={isSubmitting}>{isSubmitting ? t("saving") : t("save")}</Button>}</accountForm.Subscribe>
    </form> : <QrImportInput onUri={updateAuthenticatorUri} />}</accountForm.Subscribe>
    {duplicate && <div className="m-5 mt-0"><StatusBanner tone="warning" title={t("duplicateTitle")}><span>{t("duplicate")}</span><span className="mt-3 flex gap-2"><Button size="sm" variant="outline" type="button" onClick={() => setDuplicate(null)}>{tCommon("cancel")}</Button><Button size="sm" type="button" onClick={() => void saveDuplicate()} disabled={!online}>{t("addAnyway")}</Button></span></StatusBanner></div>}
    {renderedMessage && <div className="m-5 mt-0"><StatusBanner tone="danger" role="alert">{renderedMessage}</StatusBanner></div>}
  </>;
}

function classifyCreatorError(reason: unknown): CreatorMessage {
  if (reason instanceof TotpConfigurationError) return { source: "totp", key: reason.code };
  if (reason instanceof AccountCreatorError) return { source: "creator", key: reason.code };
  return { source: "creator", key: "addError" };
}

function Field({ children }: { children: React.ReactNode }) { return <div className="grid gap-2">{children}</div>; }
function parseAuthenticatorMetadata(uri: string): { issuer: string; accountName: string; algorithm: string; digits: number; period: number } | null { if (!uri.trim()) return null; try { const configuration = parseTotpUri(uri); const metadata = { issuer: configuration.issuer, accountName: configuration.accountName, algorithm: configuration.algorithm, digits: configuration.digits, period: configuration.period }; configuration.secret.fill(0); return metadata; } catch { return null; } }
function selectWritableVaultId(workspace: UnlockedVaultWorkspace, preferredVaultId?: string): string { const writableVaults = workspace.vaults.filter((vault) => vault.effectiveAccountPermissions.permissions.canAddAccounts); return writableVaults.find((vault) => vault.id === preferredVaultId)?.id ?? writableVaults[0]?.id ?? ""; }
