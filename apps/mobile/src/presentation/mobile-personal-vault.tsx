import { useCallback, useEffect, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { MobileMessages } from "../localization";
import { createMobilePersonalVaultInitialization } from "../application/create-mobile-personal-vault";
import type { AuthenticatedTransport } from "@rhasia-scret/client-vault-core";
import { MobilePersonalVaultRepository } from "../infrastructure/mobile-personal-vault-repository";
import {
  loadMobileVaultWorkspace,
  loadOfflineMobileVaultWorkspace,
  mobileOfflineVaultStore,
} from "../infrastructure/mobile-vault-workspace";
import { MobileAuthenticatorAccounts } from "./mobile-authenticator-accounts";
import { redeemMobileSecureShareLink } from "../infrastructure/mobile-secure-share-link";
import { useMobileWorkspaceLifecycle } from "./use-mobile-workspace-lifecycle";

export function MobilePersonalVault({
  copy,
  repository,
  transport,
  consumeSecureShareSecret,
}: {
  copy: MobileMessages;
  repository: MobilePersonalVaultRepository;
  transport: AuthenticatedTransport;
  consumeSecureShareSecret?: () => string | null;
}) {
  const [state, setState] = useState<"loading" | "uninitialized" | "active" | "offline" | "error">("loading");
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [offlineProfileId, setOfflineProfileId] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const vault = await repository.load();
      setVaultId(vault.id);
      setState(vault.lifecycle === "UNINITIALIZED" ? "uninitialized" : "active");
    } catch {
      const profiles = await mobileOfflineVaultStore.listProfiles().catch(() => []);
      if (profiles[0]) {
        setOfflineProfileId(profiles[0].profileId);
        setState("offline");
      } else setState("error");
    }
  }, [repository]);

  useEffect(() => {
    let mounted = true;
    void repository.load().then(
      (vault) => {
        if (mounted) {
          setVaultId(vault.id);
          setState(vault.lifecycle === "UNINITIALIZED" ? "uninitialized" : "active");
        }
      },
      () => {
        void mobileOfflineVaultStore.listProfiles().then((profiles) => {
          if (!mounted) return;
          if (profiles[0]) {
            setOfflineProfileId(profiles[0].profileId);
            setState("offline");
          } else setState("error");
        }, () => { if (mounted) setState("error"); });
      },
    );
    return () => { mounted = false; };
  }, [repository]);

  if (state === "loading") return <Text accessibilityLiveRegion="polite" style={styles.notice}>{copy.personalVaultLoading}</Text>;
  if (state === "error") {
    return (
      <View style={styles.panel}>
        <Text accessibilityLiveRegion="assertive" style={styles.error}>{copy.personalVaultLoadError}</Text>
        <Pressable accessibilityRole="button" onPress={() => { setState("loading"); void load(); }} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{copy.retry}</Text>
        </Pressable>
      </View>
    );
  }
  if (state === "active" && vaultId) return <PersonalVaultUnlock consumeSecureShareSecret={consumeSecureShareSecret} copy={copy} mode={{ kind: "online", personalVaultId: vaultId }} transport={transport} />;
  if (state === "offline" && offlineProfileId) return <PersonalVaultUnlock consumeSecureShareSecret={consumeSecureShareSecret} copy={copy} mode={{ kind: "offline", profileId: offlineProfileId }} transport={transport} />;
  return <PersonalVaultSetup copy={copy} repository={repository} onInitialized={() => setState("active")} />;
}

function PersonalVaultUnlock({
  copy,
  mode,
  transport,
  consumeSecureShareSecret,
}: {
  copy: MobileMessages;
  mode: { kind: "online"; personalVaultId: string } | { kind: "offline"; profileId: string };
  transport: AuthenticatedTransport;
  consumeSecureShareSecret?: () => string | null;
}) {
  const { workspace, replaceWorkspace, lockWorkspace, refreshWorkspaceAuthorization } = useMobileWorkspaceLifecycle(transport);
  const [status, setStatus] = useState<"locked" | "unlocked" | "error">("locked");
  const [shareStatus, setShareStatus] = useState<"idle" | "redeemed" | "redeemed_refresh_error" | "error">("idle");
  const form = useForm({
    defaultValues: { passphrase: "" },
    onSubmit: async ({ value }) => {
      setStatus("locked");
      try {
        const result = mode.kind === "online"
          ? await loadMobileVaultWorkspace(value.passphrase, mode.personalVaultId, transport)
          : await loadOfflineMobileVaultWorkspace(mode.profileId, value.passphrase, transport);
        replaceWorkspace(result);
        const shareSecret = mode.kind === "online" ? consumeSecureShareSecret?.() : null;
        if (shareSecret) {
          try {
            await redeemMobileSecureShareLink(shareSecret, result.userRootKey, transport);
            setShareStatus("redeemed");
            try {
              await refreshWorkspaceAuthorization();
            } catch {
              setShareStatus("redeemed_refresh_error");
            }
          } catch {
            setShareStatus("error");
          }
        }
        form.reset();
        setStatus("unlocked");
      } catch {
        setStatus("error");
      }
    },
  });

  const lock = useCallback(() => {
    lockWorkspace();
    setStatus("locked");
  }, [lockWorkspace]);

  useEffect(() => {
    if (!workspace && status === "unlocked") setStatus("locked");
  }, [status, workspace]);

  if (status === "unlocked") {
    return (
      <View style={styles.panel}>
        <Text accessibilityRole="header" style={styles.panelTitle}>{copy.personalVaultUnlocked}</Text>
        <Text style={styles.notice}>{copy.personalVaultUnlockedDescription}</Text>
        {shareStatus === "redeemed" ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{copy.secureShareLinkRedeemed}</Text> : null}
        {shareStatus === "redeemed_refresh_error" ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{copy.secureShareLinkRefreshError}</Text> : null}
        {shareStatus === "error" ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{copy.secureShareLinkError}</Text> : null}
        {workspace ? (
          <MobileAuthenticatorAccounts
            copy={copy}
            key={workspace.synchronizationToken}
            refreshWorkspaceAuthorization={refreshWorkspaceAuthorization}
            transport={transport}
            workspace={workspace}
          />
        ) : null}
        <Pressable accessibilityRole="button" onPress={lock} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{copy.lockVault}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.panelTitle}>{copy.personalVaultReady}</Text>
      <Text style={styles.guidance}>{mode.kind === "offline" ? copy.personalVaultOfflineUnlockDescription : copy.personalVaultUnlockDescription}</Text>
      <form.Field name="passphrase" validators={{ onSubmit: ({ value }) => value.trim().length >= 3 ? undefined : copy.passphraseInvalid }}>
        {(field) => <MobileTextField field={field} label={copy.vaultPassphrase} errorId="unlock-vault-passphrase-error" secureTextEntry />}
      </form.Field>
      <form.Subscribe<[boolean, boolean]> selector={(formState) => [formState.canSubmit, formState.isSubmitting]}>
        {([canSubmit, isSubmitting]: [boolean, boolean]) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit || isSubmitting, busy: isSubmitting }}
            disabled={!canSubmit || isSubmitting}
            onPress={() => void form.handleSubmit()}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>{isSubmitting ? copy.personalVaultUnlocking : copy.unlockVault}</Text>
          </Pressable>
        )}
      </form.Subscribe>
      {status === "error" ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{copy.personalVaultUnlockError}</Text> : null}
    </View>
  );
}

function PersonalVaultSetup({
  copy,
  repository,
  onInitialized,
}: {
  copy: MobileMessages;
  repository: MobilePersonalVaultRepository;
  onInitialized: () => void;
}) {
  const [submissionError, setSubmissionError] = useState(false);
  const form = useForm({
    defaultValues: { vaultName: copy.personalVaultDefaultName, passphrase: "", confirmation: "", acknowledged: false },
    onSubmit: async ({ value }) => {
      setSubmissionError(false);
      try {
        const material = await createMobilePersonalVaultInitialization(value.passphrase, value.vaultName);
        await repository.initialize(material);
        onInitialized();
      } catch {
        setSubmissionError(true);
      }
    },
  });

  return (
    <View style={styles.panel}>
      <Text accessibilityRole="header" style={styles.panelTitle}>{copy.personalVaultSetupTitle}</Text>
      <Text style={styles.guidance}>{copy.personalVaultSetupDescription}</Text>
      <form.Field name="vaultName" validators={{ onSubmit: ({ value }) => value.trim() ? undefined : copy.vaultNameRequired }}>
        {(field) => <MobileTextField field={field} label={copy.vaultName} errorId="vault-name-error" />}
      </form.Field>
      <form.Field name="passphrase" validators={{ onSubmit: ({ value }) => value.trim().length >= 3 ? undefined : copy.passphraseInvalid }}>
        {(field) => <MobileTextField field={field} label={copy.vaultPassphrase} errorId="vault-passphrase-error" secureTextEntry />}
      </form.Field>
      <form.Field
        name="confirmation"
        validators={{ onSubmit: ({ value }) => value === form.state.values.passphrase ? undefined : copy.passphraseMismatch }}
      >
        {(field) => <MobileTextField field={field} label={copy.confirmVaultPassphrase} errorId="vault-passphrase-confirmation-error" secureTextEntry />}
      </form.Field>
      <form.Field name="acknowledged" validators={{ onSubmit: ({ value }) => value ? undefined : copy.passphraseAcknowledgementRequired }}>
        {(field) => (
          <View style={styles.field}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: field.state.value }}
              onPress={() => field.handleChange(!field.state.value)}
              style={styles.checkboxRow}
            >
              <View style={[styles.checkbox, field.state.value ? styles.checkboxChecked : null]} />
              <Text style={styles.checkboxLabel}>{copy.passphraseAcknowledgement}</Text>
            </Pressable>
            {field.state.meta.errors[0] ? <Text accessibilityLiveRegion="polite" style={styles.error}>{String(field.state.meta.errors[0])}</Text> : null}
          </View>
        )}
      </form.Field>
      <Text style={styles.warning}>{copy.passphraseRecoveryWarning}</Text>
      <form.Subscribe<[boolean, boolean]> selector={(formState) => [formState.canSubmit, formState.isSubmitting]}>
        {([canSubmit, isSubmitting]: [boolean, boolean]) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit || isSubmitting, busy: isSubmitting }}
            disabled={!canSubmit || isSubmitting}
            onPress={() => void form.handleSubmit()}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>{isSubmitting ? copy.personalVaultCreating : copy.personalVaultCreate}</Text>
          </Pressable>
        )}
      </form.Subscribe>
      {submissionError ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{copy.personalVaultSetupError}</Text> : null}
    </View>
  );
}

type StringField = {
  name: string;
  state: { value: string; meta: { errors: unknown[] } };
  handleBlur(): void;
  handleChange(value: string): void;
};

function MobileTextField({
  field,
  label,
  errorId,
  secureTextEntry = false,
}: {
  field: StringField;
  label: string;
  errorId: string;
  secureTextEntry?: boolean;
}) {
  const error = field.state.meta.errors[0];
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        autoCapitalize="none"
        autoCorrect={false}
        onBlur={field.handleBlur}
        onChangeText={field.handleChange}
        secureTextEntry={secureTextEntry}
        style={[styles.input, error ? styles.inputInvalid : null]}
        value={field.state.value}
      />
      {error ? <Text nativeID={errorId} accessibilityLiveRegion="polite" style={styles.error}>{String(error)}</Text> : null}
    </View>
  );
}

const colors = {
  border: "#DED8CE",
  ink: "#172027",
  muted: "#5E6870",
  primary: "#D99412",
  warning: "#805C13",
  warningSurface: "#FFF4D6",
  danger: "#A4433D",
  notice: "#526D82",
};

const styles = StyleSheet.create({
  panel: { gap: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 18 },
  panelTitle: { color: colors.ink, textAlign: "center", fontSize: 20, lineHeight: 26, fontWeight: "800" },
  guidance: { color: colors.muted, textAlign: "center", lineHeight: 21 },
  notice: { color: colors.notice, textAlign: "center", lineHeight: 21, fontWeight: "700" },
  warning: { color: colors.warning, backgroundColor: colors.warningSurface, borderRadius: 10, padding: 12, lineHeight: 20 },
  error: { color: colors.danger, textAlign: "center", lineHeight: 21, fontWeight: "700" },
  field: { gap: 7 },
  label: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: "#FFFFFF", color: colors.ink, paddingHorizontal: 14, fontSize: 16 },
  inputInvalid: { borderColor: colors.danger },
  checkboxRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10 },
  checkbox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: colors.border, backgroundColor: "#FFFFFF" },
  checkboxChecked: { borderColor: colors.primary, backgroundColor: colors.primary },
  checkboxLabel: { flex: 1, color: colors.ink, lineHeight: 20 },
  primaryButton: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.primary, paddingHorizontal: 18 },
  primaryButtonText: { color: "#211704", fontSize: 16, fontWeight: "800" },
  secondaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  secondaryButtonText: { color: colors.ink, fontWeight: "800" },
});
