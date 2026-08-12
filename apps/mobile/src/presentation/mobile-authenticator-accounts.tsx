import { useMemo, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { UnlockedVaultWorkspace, WorkspaceAuthenticatorAccount } from "../../../../src/modules/authenticator-account/application/vault-workspace";
import type { AuthenticatedTransport } from "../../../../src/shared/application/platform-ports";
import type { MobileMessages } from "../localization";
import {
  generateMobileTotp,
  MobileAuthenticatorAccountRepository,
  nativeClipboard,
} from "../infrastructure/mobile-authenticator-account";
import { refreshMobileVaultWorkspace } from "../infrastructure/mobile-vault-workspace";
import { MobileQrScanner } from "./mobile-qr-scanner";
import { MobileVaultArchive } from "./mobile-vault-archive";
import { MobileSharedVaults } from "./mobile-shared-vault";

export function MobileAuthenticatorAccounts({
  copy,
  transport,
  workspace,
  onRefreshed,
}: {
  copy: MobileMessages;
  transport: AuthenticatedTransport;
  workspace: UnlockedVaultWorkspace;
  onRefreshed(workspace: UnlockedVaultWorkspace): void;
}) {
  const repository = useMemo(() => new MobileAuthenticatorAccountRepository(transport), [transport]);
  const personalVault = workspace.vaults.find((vault) => vault.type === "PERSONAL");
  const writableVaults = workspace.vaults.filter((vault) => vault.effectiveAccountPermissions.permissions.canAddAccounts);
  const [destinationId, setDestinationId] = useState(personalVault?.id ?? writableVaults[0]?.id ?? "");
  const destination = writableVaults.find((vault) => vault.id === destinationId);
  const [importStatus, setImportStatus] = useState<"idle" | "saving" | "error" | "refresh_error">("idle");
  const [scanning, setScanning] = useState(false);
  const form = useForm({
    defaultValues: { uri: "" },
    onSubmit: async ({ value }) => {
      if (!destination) return;
      setImportStatus("saving");
      let account: WorkspaceAuthenticatorAccount | undefined;
      try {
        account = await repository.importTotpUri(destination, value.uri);
        form.reset();
        try {
          const refreshed = await refreshMobileVaultWorkspace(workspace, transport);
          onRefreshed(refreshed);
        } catch {
          setImportStatus("refresh_error");
          return;
        }
        setImportStatus("idle");
      } catch {
        setImportStatus("error");
      } finally {
        account?.secret.fill(0);
      }
    },
  });

  if (!personalVault) return <Text style={styles.error}>{copy.personalVaultLoadError}</Text>;
  if (scanning) {
    return (
      <MobileQrScanner
        copy={copy}
        onCancel={() => setScanning(false)}
        onScan={(uri) => {
          form.setFieldValue("uri", uri);
          setScanning(false);
        }}
      />
    );
  }

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>{copy.authenticatorAccounts}</Text>
      {workspace.syncState === "CURRENT" ? (
        <>
          <Text style={styles.guidance}>{copy.authenticatorAccountImportGuidance}</Text>
          <Text style={styles.label}>{copy.destinationVault}</Text>
          <View style={styles.actions}>
            {writableVaults.map((vault) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: vault.id === destinationId }}
                key={vault.id}
                onPress={() => setDestinationId(vault.id)}
                style={[styles.secondaryButton, vault.id === destinationId ? styles.selectedButton : null]}
              >
                <Text style={styles.secondaryButtonText}>{vault.name}</Text>
              </Pressable>
            ))}
          </View>
          <form.Field name="uri" validators={{ onSubmit: ({ value }) => value.trim().startsWith("otpauth://") ? undefined : copy.authenticatorAccountUriInvalid }}>
            {(field) => {
              const error = field.state.meta.errors[0];
              return (
                <View style={styles.field}>
                  <Text nativeID="totp-uri-label" style={styles.label}>{copy.authenticatorAccountUri}</Text>
                  <TextInput
                    accessibilityLabel={copy.authenticatorAccountUri}
                    aria-invalid={Boolean(error)}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    onBlur={field.handleBlur}
                    onChangeText={field.handleChange}
                    secureTextEntry
                    style={[styles.input, error ? styles.inputInvalid : null]}
                    value={field.state.value}
                  />
                  {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{String(error)}</Text> : null}
                </View>
              );
            }}
          </form.Field>
          <Pressable accessibilityRole="button" onPress={() => setScanning(true)} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{copy.scanQrCode}</Text>
          </Pressable>
          <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
            {([canSubmit, isSubmitting]) => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: !canSubmit || isSubmitting }}
                disabled={!canSubmit || isSubmitting}
                onPress={() => void form.handleSubmit()}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>{importStatus === "saving" ? copy.authenticatorAccountSaving : copy.authenticatorAccountImport}</Text>
              </Pressable>
            )}
          </form.Subscribe>
          {importStatus === "error" ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{copy.authenticatorAccountImportError}</Text> : null}
          {importStatus === "refresh_error" ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{copy.authenticatorAccountRefreshError}</Text> : null}
        </>
      ) : <Text accessibilityLiveRegion="polite" style={styles.guidance}>{copy.offlineSnapshotReadOnly}</Text>}
      {workspace.accounts.map((account) => {
        const vault = workspace.vaults.find(({ id }) => id === account.vaultId);
        return (
          <MobileTotpAccount
            account={account}
            canDelete={workspace.syncState === "CURRENT" && vault?.effectiveAccountPermissions.permissions.canDeleteAccounts === true}
            copy={copy}
            key={account.id}
            online={workspace.syncState === "CURRENT"}
            onDelete={async () => {
              await repository.deleteAccount(account);
              onRefreshed(await refreshMobileVaultWorkspace(workspace, transport));
            }}
            repository={repository}
          />
        );
      })}
      <MobileSharedVaults copy={copy} transport={transport} workspace={workspace} />
      <MobileVaultArchive copy={copy} onRefreshed={onRefreshed} transport={transport} workspace={workspace} />
    </View>
  );
}

function MobileTotpAccount({ account, canDelete, copy, online, onDelete, repository }: {
  account: WorkspaceAuthenticatorAccount;
  canDelete: boolean;
  copy: MobileMessages;
  online: boolean;
  onDelete(): Promise<void>;
  repository: MobileAuthenticatorAccountRepository;
}) {
  const [code, setCode] = useState<{ value: string; validUntil: Date } | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<"idle" | "busy" | "error">("idle");

  const generate = async () => {
    setCopied(false);
    setCode(await generateMobileTotp(account));
  };
  const copyCode = async () => {
    if (!code || code.validUntil.getTime() <= Date.now()) return;
    if (online && account.vaultType === "SHARED") {
      void repository.recordSharedVaultAccountAccess(account.vaultId, account.id).catch(() => undefined);
    }
    await nativeClipboard.writeText(code.value);
    setCopied(true);
  };

  return (
    <View style={styles.account}>
      <Text style={styles.accountVault}>{account.vaultName} · {account.vaultType === "SHARED" ? copy.sharedVault : copy.personalVault}</Text>
      <Text style={styles.accountIssuer}>{account.issuer}</Text>
      <Text style={styles.accountName}>{account.accountName}</Text>
      {code ? <Text accessibilityLiveRegion="polite" style={styles.code}>{code.value}</Text> : null}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={() => void generate()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{copy.generateCode}</Text>
        </Pressable>
        {code ? (
          <Pressable accessibilityRole="button" onPress={() => void copyCode()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{copy.copyCode}</Text>
          </Pressable>
        ) : null}
        {canDelete ? (
          <Pressable accessibilityRole="button" disabled={deleteStatus === "busy"} onPress={() => { setDeleteStatus("busy"); void onDelete().catch(() => setDeleteStatus("error")); }} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{deleteStatus === "busy" ? copy.deletingAccount : copy.deleteAccount}</Text>
          </Pressable>
        ) : null}
      </View>
      {copied ? <Text accessibilityLiveRegion="polite" style={styles.guidance}>{copy.codeCopied}</Text> : null}
      {deleteStatus === "error" ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{copy.deleteAccountError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 12, marginTop: 8 },
  heading: { color: "#172027", fontSize: 18, fontWeight: "800" },
  guidance: { color: "#526D82", fontSize: 14, lineHeight: 20 },
  field: { gap: 6 },
  label: { color: "#172027", fontSize: 14, fontWeight: "700" },
  input: { minHeight: 72, borderRadius: 12, borderWidth: 1, borderColor: "#DED8CE", backgroundColor: "#FFFFFF", color: "#172027", padding: 12 },
  inputInvalid: { borderColor: "#A4433D" },
  primaryButton: { minHeight: 48, justifyContent: "center", alignItems: "center", borderRadius: 12, backgroundColor: "#D99412", paddingHorizontal: 16 },
  primaryButtonText: { color: "#172027", fontWeight: "800" },
  secondaryButton: { minHeight: 44, justifyContent: "center", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "#DED8CE", paddingHorizontal: 14 },
  secondaryButtonText: { color: "#172027", fontWeight: "700" },
  selectedButton: { borderColor: "#D99412", backgroundColor: "#FFF5DD" },
  error: { color: "#A4433D", fontSize: 14, lineHeight: 20 },
  account: { gap: 8, borderTopWidth: 1, borderTopColor: "#DED8CE", paddingTop: 12 },
  accountVault: { color: "#526D82", fontSize: 12, fontWeight: "700" },
  accountIssuer: { color: "#172027", fontSize: 16, fontWeight: "800" },
  accountName: { color: "#5E6870", fontSize: 14 },
  code: { color: "#172027", fontSize: 28, fontWeight: "800", letterSpacing: 3 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
