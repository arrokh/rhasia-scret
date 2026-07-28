"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { ArchiveRestore, KeyRound, LoaderCircle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  clearUnlockedVaultWorkspace,
  refreshUnlockedVaultWorkspace,
  useUnlockedVaultWorkspace,
  VaultWorkspaceUnlock,
  type UnlockedVaultWorkspace
} from "@/modules/authenticator-account";
import { MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES } from "@/modules/crypto";
import { createSharedVaultMaterial } from "@/modules/vault-management";
import { base64ToBytes, bytesToBase64 } from "@/shared/infrastructure/browser-base64";
import { SectionHeading, StatusBanner } from "@/shared/presentation/app-ui";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { PasswordInput } from "@/shared/presentation/password-input";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import {
  clearOpenedVaultArchive,
  countDuplicateArchiveAccounts,
  encryptVaultArchiveAccounts,
  openAndValidateEncryptedVaultArchive,
  VaultArchiveWorkflowError,
  type OpenedVaultArchive
} from "../infrastructure/browser-vault-archive-workflow";
import { uploadEncryptedVaultImport, VaultImportClientError, type BrowserEncryptedVaultImportRequest } from "../infrastructure/browser-vault-import-client";

const NEW_SHARED_DESTINATION = "NEW_SHARED";

type ImportPlan = { selection: string; vaultId: string; accountIds: string[] };
type ArchiveErrorKey = "offlineOpen" | "chooseArchive" | "archiveTooLarge" | "openError" | "destinationUnavailable" | "destinationKeyUnavailable" | "locked" | "newVaultMaterialUnavailable" | "responseMismatch" | "refreshError" | "partialFailure" | "invalidKeyLength" | "invalidKey" | "clientDestinationUnavailable" | "clientConflict" | "clientInvalidPayload" | "clientServerError";

class VaultArchivePresentationError extends Error {
  public constructor(public readonly code: ArchiveErrorKey) { super(code); }
}

export function VaultArchiveImportWorkspace({ personalVaultId }: { personalVaultId: string }) {
  const t = useTranslations("VaultArchive.importer");
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  if (!workspace) return <VaultWorkspaceUnlock personalVaultId={personalVaultId} onUnlocked={setWorkspace} />;
  if (workspace.syncState !== "CURRENT") return <div className="grid gap-4 p-5 sm:p-6"><StatusBanner tone="offline">{t("blocked")}</StatusBanner><Button variant="outline" asChild><Link href="/vaults">{t("backReadOnly")}</Link></Button></div>;
  return <VaultArchiveImporter workspace={workspace} replaceWorkspace={setWorkspace} />;
}

export function VaultArchiveImporter({
  workspace,
  replaceWorkspace,
  refreshAfterImport = (current) => refreshUnlockedVaultWorkspace(current.userRootKey, current.profileId)
}: {
  workspace: UnlockedVaultWorkspace;
  replaceWorkspace: ReturnType<typeof useUnlockedVaultWorkspace>["setWorkspace"];
  refreshAfterImport?: (current: UnlockedVaultWorkspace) => Promise<UnlockedVaultWorkspace>;
}) {
  const t = useTranslations("VaultArchive.importer");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const online = useOnlineStatus();
  const [opened, setOpenedState] = useState<OpenedVaultArchive | null>(null);
  const [errorCode, setErrorCode] = useState<ArchiveErrorKey | null>(null);
  const [success, setSuccess] = useState<{ count: number; newVault: boolean } | null>(null);
  const [duplicateConfirmation, setDuplicateConfirmation] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [uploading, setUploading] = useState(false);
  const openedRef = useRef<OpenedVaultArchive | null>(null);
  const activeRef = useRef(true);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const planRef = useRef<ImportPlan | null>(null);

  const writableVaults = workspace.vaults.filter((vault) => vault.type === "PERSONAL" || vault.role === "OWNER");
  const initialDestination = writableVaults[0]?.id ?? NEW_SHARED_DESTINATION;
  const previewForm = useForm({
    defaultValues: { archive: null as File | null, keyMaterial: "" },
    onSubmit: async ({ value }) => {
      setErrorCode(null); setSuccess(null);
      if (!online) { setErrorCode("offlineOpen"); return; }
      if (!value.archive) { setErrorCode("chooseArchive"); return; }
      let archiveBytes: Uint8Array | undefined;
      let archiveKey: Uint8Array | undefined;
      try {
        if (value.archive.size === 0 || value.archive.size > MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES) throw new VaultArchivePresentationError("archiveTooLarge");
        archiveBytes = new Uint8Array(await value.archive.arrayBuffer());
        archiveKey = parseArchiveKey(value.keyMaterial);
        replaceOpened(await openAndValidateEncryptedVaultArchive(archiveKey, archiveBytes));
        importForm.setFieldValue("destinationId", initialDestination);
      } catch (error) {
        setErrorCode(classifyArchiveError(error, "openError"));
      } finally {
        archiveBytes?.fill(0);
        archiveKey?.fill(0);
        previewForm.setFieldValue("keyMaterial", "");
        previewForm.setFieldValue("archive", null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    }
  });
  const importForm = useForm({
    defaultValues: { destinationId: initialDestination },
    onSubmit: async ({ value }) => submitImport(value.destinationId, false)
  });

  const selectedDestination = importForm.state.values.destinationId;
  const existingDestination = writableVaults.find(({ id }) => id === selectedDestination);
  const duplicateCount = useMemo(() => {
    if (!opened) return 0;
    const destinationAccounts = existingDestination ? workspace.accounts.filter(({ vaultId }) => vaultId === existingDestination.id) : [];
    return countDuplicateArchiveAccounts(opened.accounts, destinationAccounts);
  }, [existingDestination, opened, workspace.accounts]);

  useEffect(() => { openedRef.current = opened; }, [opened]);
  useEffect(() => () => {
    activeRef.current = false;
    clearOpenedVaultArchive(openedRef.current);
    openedRef.current = null;
  }, []);

  function replaceOpened(next: OpenedVaultArchive | null) {
    setOpenedState((current) => { if (current && current !== next) clearOpenedVaultArchive(current); return next; });
    openedRef.current = next;
    planRef.current = null;
    setDuplicateConfirmation(false);
  }

  function cancelImport() {
    replaceOpened(null);
    setErrorCode(null);
    setSuccess(null);
    previewForm.reset();
    importForm.reset();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function changeDestination(destinationId: string) {
    importForm.setFieldValue("destinationId", destinationId);
    planRef.current = null;
    setDuplicateConfirmation(false);
  }

  async function submitImport(destinationId: string, allowDuplicates: boolean) {
    if (!opened || !online || uploading) return;
    setErrorCode(null); setSuccess(null);
    const destination = writableVaults.find(({ id }) => id === destinationId);
    if (!destination && destinationId !== NEW_SHARED_DESTINATION) { setErrorCode("destinationUnavailable"); return; }
    if (duplicateCount > 0 && !allowDuplicates) { setDuplicateConfirmation(true); return; }
    setUploading(true);
    const plan = planRef.current?.selection === destinationId && planRef.current.accountIds.length === opened.accounts.length
      ? planRef.current
      : { selection: destinationId, vaultId: destination ? destination.id : crypto.randomUUID(), accountIds: opened.accounts.map(() => crypto.randomUUID()) };
    planRef.current = plan;
    let newVaultMaterial: Awaited<ReturnType<typeof createSharedVaultMaterial>> | undefined;
    let encryptedAccounts: Uint8Array[] = [];
    let uploaded = false;
    try {
      newVaultMaterial = destination ? undefined : await createSharedVaultMaterial(workspace.userRootKey, opened.vaultName);
      const destinationKey = destination?.key ?? newVaultMaterial?.vaultKey;
      if (!destinationKey) throw new VaultArchivePresentationError("destinationKeyUnavailable");
      encryptedAccounts = await encryptVaultArchiveAccounts(destinationKey, opened.accounts);
      if (!activeRef.current) throw new VaultArchivePresentationError("locked");
      let requestDestination: BrowserEncryptedVaultImportRequest["destination"];
      if (destination) {
        requestDestination = { kind: "EXISTING", vaultId: destination.id, vaultType: destination.type };
      } else {
        const material = newVaultMaterial;
        if (!material) throw new VaultArchivePresentationError("newVaultMaterialUnavailable");
        requestDestination = { kind: "NEW_SHARED", vaultId: plan.vaultId, encryptedName: bytesToBase64(material.encryptedName), encryptedOwnerVaultKey: bytesToBase64(material.encryptedOwnerVaultKey), encryptionVersion: 1 };
      }
      const request: BrowserEncryptedVaultImportRequest = {
        destination: requestDestination,
        accounts: encryptedAccounts.map((encryptedPayload, index) => ({ id: plan.accountIds[index], encryptedPayload: bytesToBase64(encryptedPayload), encryptionVersion: 1 }))
      };
      const result = await uploadEncryptedVaultImport(request);
      if (!activeRef.current) return;
      if (result.vaultId !== plan.vaultId || result.accountIds.join(",") !== plan.accountIds.join(",")) throw new VaultArchivePresentationError("responseMismatch");
      uploaded = true;
      const refreshed = await refreshAfterImport(workspace);
      replaceWorkspace((current) => { if (current) clearUnlockedVaultWorkspace(current); return refreshed; });
      replaceOpened(null);
      setSuccess({ count: plan.accountIds.length, newVault: result.vaultCreated });
      router.refresh();
    } catch (error) {
      if (!activeRef.current) return;
      if (uploaded) {
        replaceOpened(null);
        setErrorCode("refreshError");
      } else {
        setErrorCode(classifyArchiveError(error, "partialFailure"));
      }
    } finally {
      for (const payload of encryptedAccounts) payload.fill(0);
      newVaultMaterial?.vaultKey.fill(0);
      newVaultMaterial?.encryptedName.fill(0);
      newVaultMaterial?.encryptedOwnerVaultKey.fill(0);
      if (activeRef.current) {
        setDuplicateConfirmation(false);
        setUploading(false);
      }
    }
  }

  if (!opened) return <div className="grid gap-5 p-5 sm:p-6">
    {!online && <StatusBanner tone="offline">{t("offlinePreview")}</StatusBanner>}
    <form noValidate className="grid gap-5" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void previewForm.handleSubmit(); }}>
      <SectionHeading icon={ArchiveRestore} title={t("openTitle")} description={t("openDescription")} />
      <previewForm.Field name="archive" validators={{ onSubmit: ({ value }) => value ? undefined : t("archiveRequired") }}>{(field) => <Field><Label htmlFor="vault-archive-file">{t("archiveFile")}</Label><Input ref={fileInputRef} id="vault-archive-file" type="file" accept=".rhasia-vault,application/octet-stream" onChange={(event) => field.handleChange(event.target.files?.[0] ?? null)} aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "vault-archive-file-help vault-archive-file-error" : "vault-archive-file-help"} /><p id="vault-archive-file-help" className="text-xs text-muted-foreground">{t("archiveHelp")}</p><FormFieldError id="vault-archive-file-error" errors={field.state.meta.errors} /></Field>}</previewForm.Field>
      <previewForm.Field name="keyMaterial" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("keyRequired") }}>{(field) => <Field><Label htmlFor="vault-archive-key">{t("keyLabel")}</Label><PasswordInput id="vault-archive-key" label={t("key")} visible={keyVisible} onToggleVisibility={() => setKeyVisible((visible) => !visible)} value={field.state.value} onChange={(event) => field.handleChange(event.target.value)} autoComplete="off" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "vault-archive-key-error" : "vault-archive-key-help"} /><p id="vault-archive-key-help" className="text-xs text-muted-foreground">{t("keyHelp")}</p><FormFieldError id="vault-archive-key-error" errors={field.state.meta.errors} /></Field>}</previewForm.Field>
      <previewForm.Subscribe selector={(state) => state.isSubmitting}>{(pending) => <Button type="submit" disabled={!online || pending} aria-busy={pending}>{pending && <LoaderCircle className="animate-spin" />}{pending ? t("opening") : t("previewArchive")}</Button>}</previewForm.Subscribe>
    </form>
    {errorCode && <StatusBanner tone="danger" role="alert">{t(errorCode)}</StatusBanner>}
    {success && <StatusBanner tone="success" role="status">{t("success", { count: success.count, newVault: success.newVault ? "yes" : "no" })}</StatusBanner>}
  </div>;

  return <div className="grid gap-5 p-5 sm:p-6">
    {!online && <StatusBanner tone="offline">{t("offlineImport")}</StatusBanner>}
    <SectionHeading icon={KeyRound} title={t("previewTitle")} description={t("previewDescription")} />
    <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-4"><div><dt className="text-xs font-bold text-muted-foreground uppercase">{t("vaultName")}</dt><dd className="mt-1 break-words font-bold">{opened.vaultName}</dd></div><div><dt className="text-xs font-bold text-muted-foreground uppercase">{t("accountCount")}</dt><dd className="mt-1 font-bold">{opened.accounts.length}</dd></div></dl>
    <form noValidate className="grid gap-5" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void importForm.handleSubmit(); }}>
      <importForm.Field name="destinationId" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : t("destinationRequired") }}>{(field) => <Field><Label htmlFor="archive-import-destination">{t("destination")}</Label><Select value={field.state.value} onValueChange={changeDestination}><SelectTrigger id="archive-import-destination" className="h-12 w-full" aria-invalid={field.state.meta.errors.length > 0} aria-describedby={field.state.meta.errors.length ? "archive-import-destination-error" : undefined}><SelectValue placeholder={t("chooseDestination")} /></SelectTrigger><SelectContent>{writableVaults.map((vault) => <SelectItem key={vault.id} value={vault.id}>{vault.name}</SelectItem>)}<SelectItem value={NEW_SHARED_DESTINATION}>{t("newShared", { name: opened.vaultName })}</SelectItem></SelectContent></Select><FormFieldError id="archive-import-destination-error" errors={field.state.meta.errors} /></Field>}</importForm.Field>
      {duplicateCount > 0 && <StatusBanner tone="warning" title={t("duplicatesTitle", { count: duplicateCount })}>{t("duplicatesDescription")}</StatusBanner>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={cancelImport} disabled={uploading}>{tCommon("cancel")}</Button><Button type="submit" disabled={!online || uploading} aria-busy={uploading}>{uploading && <LoaderCircle className="animate-spin" />}{uploading ? t("importing") : t("confirmImport")}</Button></div>
    </form>
    {duplicateConfirmation && <StatusBanner tone="warning" title={t("duplicateConfirmTitle")}><span className="grid gap-3"><span>{t("duplicateConfirmDescription")}</span><span className="flex gap-2"><Button size="sm" variant="outline" type="button" onClick={cancelImport}>{tCommon("cancel")}</Button><Button size="sm" type="button" disabled={!online || uploading} onClick={() => void submitImport(selectedDestination, true)}>{t("addAnyway")}</Button></span></span></StatusBanner>}
    {errorCode && <StatusBanner tone="danger" role="alert" title={t("notCompleted")}><span className="flex items-start gap-2"><ShieldAlert className="mt-0.5 size-4 shrink-0" />{t(errorCode)}</span></StatusBanner>}
  </div>;
}

function classifyArchiveError(error: unknown, fallback: ArchiveErrorKey): ArchiveErrorKey {
  if (error instanceof VaultArchivePresentationError || error instanceof VaultArchiveWorkflowError || error instanceof VaultImportClientError) return error.code;
  return fallback;
}

function Field({ children }: { children: React.ReactNode }) { return <div className="grid gap-2">{children}</div>; }

function parseArchiveKey(value: string): Uint8Array {
  const normalized = value.trim();
  if (!/^(?:[A-Za-z0-9+/]{4}){10}[A-Za-z0-9+/]{3}=$/.test(normalized)) throw new VaultArchivePresentationError("invalidKeyLength");
  let key: Uint8Array;
  try { key = base64ToBytes(normalized); } catch { throw new VaultArchivePresentationError("invalidKey"); }
  if (key.length !== 32) { key.fill(0); throw new VaultArchivePresentationError("invalidKeyLength"); }
  return key;
}
