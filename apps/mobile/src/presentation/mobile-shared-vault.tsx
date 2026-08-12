import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { UnlockedVaultWorkspace } from "../../../../src/modules/authenticator-account/application/vault-workspace";
import type { AuthenticatedTransport } from "../../../../src/shared/application/platform-ports";
import { createMobileSecureShareLink } from "../infrastructure/mobile-secure-share-link";
import { loadMobileVaultAuditEvents, type MobileVaultAuditEvent } from "../infrastructure/mobile-vault-audit";
import { loadMobileVaultPermissionDefaults, updateMobileVaultPermissionDefaults, type MobileVaultPermissionDefaults } from "../infrastructure/mobile-vault-permissions";
import type { MobileMessages } from "../localization";

export function MobileSharedVaults({ copy, workspace, transport }: {
  copy: MobileMessages;
  workspace: UnlockedVaultWorkspace;
  transport: AuthenticatedTransport;
}) {
  const sharedVaults = workspace.vaults.filter((vault) => vault.type === "SHARED");
  const owned = sharedVaults.filter((vault) => vault.role === "OWNER");
  const [vaultId, setVaultId] = useState(owned[0]?.id ?? "");
  const [status, setStatus] = useState<"idle" | "busy" | "success" | "error">("idle");
  const [auditEvents, setAuditEvents] = useState<MobileVaultAuditEvent[]>([]);
  const [auditError, setAuditError] = useState(false);
  const [permissionVaultId, setPermissionVaultId] = useState("");
  const [permissionDefaults, setPermissionDefaults] = useState<MobileVaultPermissionDefaults | null>(null);
  const [permissionError, setPermissionError] = useState(false);
  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      const vault = owned.find(({ id }) => id === vaultId);
      if (!vault) return;
      setStatus("busy");
      try {
        await createMobileSecureShareLink(vault, value.email, transport);
        form.reset();
        setStatus("success");
      } catch { setStatus("error"); }
    },
  });

  if (sharedVaults.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.heading}>{copy.sharedVaults}</Text>
      {sharedVaults.map((vault) => (
        <View key={vault.id} style={styles.card}>
          <Text style={styles.name}>{vault.name}</Text>
          <Text style={styles.guidance}>{vault.role === "OWNER" ? copy.sharedVaultOwner : copy.sharedVaultViewer}</Text>
          <Text style={styles.guidance}>{permissionSummary(vault.effectiveAccountPermissions.permissions, copy)}</Text>
          {vault.role === "OWNER" && workspace.syncState === "CURRENT" ? (
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" onPress={() => void loadMobileVaultAuditEvents(vault.id, transport).then((events) => { setAuditEvents(events); setAuditError(false); }, () => setAuditError(true))} style={styles.button}>
                <Text style={styles.buttonText}>{copy.loadAuditHistory}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => void loadMobileVaultPermissionDefaults(vault.id, transport).then((defaults) => { setPermissionVaultId(vault.id); setPermissionDefaults(defaults); setPermissionError(false); }, () => setPermissionError(true))} style={styles.button}>
                <Text style={styles.buttonText}>{copy.manageMemberPermissions}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ))}
      {permissionDefaults ? (
        <View style={styles.section}>
          <Text style={styles.name}>{copy.memberPermissionDefaults}</Text>
          {(["canAddAccounts", "canEditAccounts", "canDeleteAccounts"] as const).map((permission) => (
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: permissionDefaults.permissions[permission] }} key={permission} onPress={() => setPermissionDefaults({ ...permissionDefaults, permissions: { ...permissionDefaults.permissions, [permission]: !permissionDefaults.permissions[permission] } })} style={styles.button}>
              <Text style={styles.buttonText}>{permissionLabel(permission, copy)}: {permissionDefaults.permissions[permission] ? copy.allowed : copy.notAllowed}</Text>
            </Pressable>
          ))}
          <Pressable accessibilityRole="button" onPress={() => void updateMobileVaultPermissionDefaults(permissionVaultId, permissionDefaults, transport).then((updated) => { setPermissionDefaults(updated); setPermissionError(false); }, () => setPermissionError(true))} style={styles.button}><Text style={styles.buttonText}>{copy.savePermissions}</Text></Pressable>
        </View>
      ) : null}
      {permissionError ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{copy.memberPermissionsError}</Text> : null}
      {auditEvents.length ? <View style={styles.section}>{auditEvents.map((event) => <View key={event.id} style={styles.card}><Text style={styles.name}>{auditLabel(event.eventType, copy)}</Text><Text style={styles.guidance}>{event.actorEmail} · {new Date(event.createdAt).toLocaleString(copy.dateLocale)}</Text></View>)}</View> : null}
      {auditError ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{copy.auditHistoryError}</Text> : null}
      {owned.length && workspace.syncState === "CURRENT" ? (
        <View style={styles.section}>
          <Text style={styles.name}>{copy.createSecureShareLink}</Text>
          <View style={styles.actions}>{owned.map((vault) => (
            <Pressable accessibilityRole="button" accessibilityState={{ selected: vault.id === vaultId }} key={vault.id} onPress={() => setVaultId(vault.id)} style={styles.button}>
              <Text style={styles.buttonText}>{vault.name}</Text>
            </Pressable>
          ))}</View>
          <form.Field name="email" validators={{ onSubmit: ({ value }) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? undefined : copy.recipientEmailInvalid }}>
            {(field) => {
              const error = field.state.meta.errors[0];
              return <View style={styles.section}><TextInput accessibilityLabel={copy.recipientEmail} aria-invalid={Boolean(error)} autoCapitalize="none" keyboardType="email-address" onChangeText={field.handleChange} style={styles.input} value={field.state.value} />{error ? <Text style={styles.error}>{String(error)}</Text> : null}</View>;
            }}
          </form.Field>
          <Pressable accessibilityRole="button" disabled={status === "busy"} onPress={() => void form.handleSubmit()} style={styles.button}><Text style={styles.buttonText}>{status === "busy" ? copy.creatingSecureShareLink : copy.createAndShareLink}</Text></Pressable>
          {status === "success" ? <Text accessibilityLiveRegion="polite" style={styles.guidance}>{copy.secureShareLinkCreated}</Text> : null}
          {status === "error" ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{copy.secureShareLinkCreateError}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

function permissionLabel(permission: "canAddAccounts" | "canEditAccounts" | "canDeleteAccounts", copy: MobileMessages): string {
  if (permission === "canAddAccounts") return copy.permissionAdd;
  if (permission === "canEditAccounts") return copy.permissionEdit;
  return copy.permissionDelete;
}

function auditLabel(eventType: string, copy: MobileMessages): string {
  if (eventType === "ACCOUNT_ACCESSED") return copy.auditAccountAccessed;
  if (eventType === "ACCOUNT_ADDED") return copy.auditAccountAdded;
  if (eventType === "ACCOUNT_UPDATED") return copy.auditAccountUpdated;
  if (eventType === "ACCOUNT_DELETED") return copy.auditAccountDeleted;
  if (eventType === "MEMBER_REVOKED") return copy.auditMemberRevoked;
  if (eventType === "ARCHIVE_IMPORTED") return copy.auditArchiveImported;
  return copy.auditSecurityActivity;
}

function permissionSummary(permissions: { canAddAccounts: boolean; canEditAccounts: boolean; canDeleteAccounts: boolean }, copy: MobileMessages): string {
  return [permissions.canAddAccounts ? copy.permissionAdd : null, permissions.canEditAccounts ? copy.permissionEdit : null, permissions.canDeleteAccounts ? copy.permissionDelete : null].filter(Boolean).join(" · ") || copy.permissionReadOnly;
}

const styles = StyleSheet.create({
  section: { gap: 10, marginTop: 8 },
  heading: { color: "#172027", fontSize: 18, fontWeight: "800" },
  card: { gap: 4, borderTopWidth: 1, borderTopColor: "#DED8CE", paddingTop: 10 },
  name: { color: "#172027", fontSize: 15, fontWeight: "800" },
  guidance: { color: "#526D82", fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  button: { minHeight: 44, justifyContent: "center", alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: "#DED8CE", paddingHorizontal: 14 },
  buttonText: { color: "#172027", fontWeight: "700" },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: "#DED8CE", backgroundColor: "#FFFFFF", color: "#172027", padding: 12 },
  error: { color: "#A4433D", fontSize: 14 },
});
