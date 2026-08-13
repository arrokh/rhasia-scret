import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { clearOpenedVaultArchive, type OpenedVaultArchive } from "@rhasia-scret/client-vault-core";
import { clearPreparedVaultArchive, type PreparedVaultArchive } from "@rhasia-scret/client-vault-core";
import type { UnlockedVaultWorkspace } from "@rhasia-scret/client-vault-core";
import type { AuthenticatedTransport } from "@rhasia-scret/client-vault-core";
import type { MobileMessages } from "../localization";
import { nativeClipboard } from "../infrastructure/mobile-authenticator-account";
import {
  importOpenedArchiveIntoVault,
  pickAndOpenMobileVaultArchive,
  prepareMobileVaultArchive,
  sharePreparedMobileVaultArchive,
} from "../infrastructure/mobile-vault-archive";
import { refreshMobileVaultWorkspace } from "../infrastructure/mobile-vault-workspace";

export function MobileVaultArchive({ copy, workspace, transport, onRefreshed }: {
  copy: MobileMessages;
  workspace: UnlockedVaultWorkspace;
  transport: AuthenticatedTransport;
  onRefreshed(workspace: UnlockedVaultWorkspace): void;
}) {
  const exportableVaults = workspace.vaults.filter((vault) => vault.role === "OWNER");
  const writableVaults = workspace.vaults.filter((vault) => vault.effectiveAccountPermissions.permissions.canAddAccounts);
  const [exportVaultId, setExportVaultId] = useState(exportableVaults[0]?.id ?? "");
  const [importVaultId, setImportVaultId] = useState(writableVaults[0]?.id ?? "");
  const exportVault = exportableVaults.find(({ id }) => id === exportVaultId);
  const importVault = writableVaults.find(({ id }) => id === importVaultId);
  const preparedRef = useRef<PreparedVaultArchive | null>(null);
  const openedRef = useRef<OpenedVaultArchive | null>(null);
  const [prepared, setPrepared] = useState<PreparedVaultArchive | null>(null);
  const [opened, setOpened] = useState<OpenedVaultArchive | null>(null);
  const [status, setStatus] = useState<"idle" | "busy" | "copied" | "success" | "imported_refresh_error" | "error">("idle");
  const keyForm = useForm({
    defaultValues: { key: "" },
    onSubmit: async ({ value }) => {
      setStatus("busy");
      try {
        const next = await pickAndOpenMobileVaultArchive(value.key);
        clearOpenedVaultArchive(openedRef.current);
        openedRef.current = next;
        setOpened(next);
        keyForm.reset();
        setStatus("idle");
      } catch { setStatus("error"); }
    },
  });

  useEffect(() => () => {
    clearPreparedVaultArchive(preparedRef.current);
    clearOpenedVaultArchive(openedRef.current);
  }, []);

  if (!exportVault || !importVault || workspace.syncState !== "CURRENT") return null;

  const prepare = async () => {
    setStatus("busy");
    try {
      const next = await prepareMobileVaultArchive(workspace, exportVault, transport);
      clearPreparedVaultArchive(preparedRef.current);
      preparedRef.current = next;
      setPrepared(next);
      setStatus("idle");
    } catch { setStatus("error"); }
  };
  const importArchive = async () => {
    if (!opened) return;
    setStatus("busy");
    try {
      await importOpenedArchiveIntoVault(opened, importVault, transport);
      clearOpenedVaultArchive(openedRef.current);
      openedRef.current = null;
      setOpened(null);
      try {
        const refreshed = await refreshMobileVaultWorkspace(workspace, transport);
        onRefreshed(refreshed);
        setStatus("success");
      } catch {
        setStatus("imported_refresh_error");
      }
    } catch { setStatus("error"); }
  };

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>{copy.archiveTitle}</Text>
      <Text style={styles.guidance}>{copy.archiveGuidance}</Text>
      <Text style={styles.guidance}>{copy.archiveExportVault}</Text>
      <View style={styles.actions}>{exportableVaults.map((vault) => <Pressable accessibilityRole="button" accessibilityState={{ selected: vault.id === exportVaultId }} key={vault.id} onPress={() => setExportVaultId(vault.id)} style={styles.button}><Text style={styles.buttonText}>{vault.name}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="button" onPress={() => void prepare()} style={styles.button}><Text style={styles.buttonText}>{copy.prepareArchive}</Text></Pressable>
      {prepared ? (
        <View style={styles.section}>
          <Text selectable style={styles.key}>{prepared.keyMaterial}</Text>
          <Text style={styles.guidance}>{copy.archiveSeparateKeyWarning}</Text>
          <Pressable accessibilityRole="button" onPress={() => void nativeClipboard.writeText(prepared.keyMaterial).then(() => setStatus("copied"))} style={styles.button}><Text style={styles.buttonText}>{copy.copyArchiveKey}</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => void sharePreparedMobileVaultArchive(prepared).catch(() => setStatus("error"))} style={styles.button}><Text style={styles.buttonText}>{copy.shareEncryptedArchive}</Text></Pressable>
        </View>
      ) : null}
      <keyForm.Field name="key" validators={{ onSubmit: ({ value }) => value.trim().length >= 40 ? undefined : copy.archiveKeyInvalid }}>
        {(field) => {
          const error = field.state.meta.errors[0];
          return (
            <View style={styles.section}>
              <TextInput
                accessibilityLabel={copy.archiveKey}
                aria-invalid={Boolean(error)}
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
      </keyForm.Field>
      <Text style={styles.guidance}>{copy.archiveImportDestination}</Text>
      <View style={styles.actions}>{writableVaults.map((vault) => <Pressable accessibilityRole="button" accessibilityState={{ selected: vault.id === importVaultId }} key={vault.id} onPress={() => setImportVaultId(vault.id)} style={styles.button}><Text style={styles.buttonText}>{vault.name}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="button" onPress={() => void keyForm.handleSubmit()} style={styles.button}><Text style={styles.buttonText}>{copy.chooseArchive}</Text></Pressable>
      {opened ? (
        <View style={styles.section}>
          <Text style={styles.guidance}>{copy.archivePreview.replace("{vault}", opened.vaultName).replace("{count}", String(opened.accounts.length))}</Text>
          <Pressable accessibilityRole="button" onPress={() => void importArchive()} style={styles.button}><Text style={styles.buttonText}>{copy.importArchive}</Text></Pressable>
        </View>
      ) : null}
      {status === "copied" ? <Text style={styles.guidance}>{copy.archiveKeyCopied}</Text> : null}
      {status === "success" ? <Text style={styles.guidance}>{copy.archiveImportSuccess}</Text> : null}
      {status === "imported_refresh_error" ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{copy.archiveImportedRefreshError}</Text> : null}
      {status === "error" ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{copy.archiveError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10, marginTop: 8 },
  heading: { color: "#172027", fontSize: 18, fontWeight: "800" },
  guidance: { color: "#526D82", fontSize: 14, lineHeight: 20 },
  key: { color: "#172027", fontFamily: "monospace", fontSize: 12 },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: "#DED8CE", backgroundColor: "#FFFFFF", color: "#172027", padding: 12 },
  inputInvalid: { borderColor: "#A4433D" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { minHeight: 44, justifyContent: "center", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "#DED8CE", paddingHorizontal: 14 },
  buttonText: { color: "#172027", fontWeight: "700" },
  error: { color: "#A4433D", fontSize: 14 },
});
