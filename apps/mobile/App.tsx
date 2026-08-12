import { useMemo, useState } from "react";
import appIcon from "./assets/icon.png";
import { useForm } from "@tanstack/react-form";
import { StatusBar } from "expo-status-bar";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { nativeCryptoValidationEnabled, readMobileClientConfiguration, type MobileClientConfiguration } from "./src/config";
import { translate, type MobileLocale } from "./src/localization";
import { createMobileSupabaseClient } from "./src/infrastructure/mobile-supabase-client";
import { createNativeAuthenticatedTransport } from "./src/infrastructure/native-authenticated-transport";
import { MobilePersonalVaultRepository } from "./src/infrastructure/mobile-personal-vault-repository";
import { MobilePersonalVault } from "./src/presentation/mobile-personal-vault";
import { useMobileSession } from "./src/presentation/use-mobile-session";
import { NativeCryptoValidation } from "./src/presentation/native-crypto-validation";

export default function App() {
  if (nativeCryptoValidationEnabled()) return <NativeCryptoValidation />;
  const configuration = tryReadConfiguration();
  return configuration ? <ConfiguredApp configuration={configuration} /> : <ConfigurationError />;
}

function tryReadConfiguration(): MobileClientConfiguration | null {
  try {
    return readMobileClientConfiguration();
  } catch {
    return null;
  }
}

function ConfiguredApp({ configuration }: { configuration: MobileClientConfiguration }) {
  const [locale, setLocale] = useState<MobileLocale>("id");
  const copy = translate(locale);
  const supabase = useMemo(() => createMobileSupabaseClient(configuration), [configuration]);
  const transport = useMemo(() => createNativeAuthenticatedTransport(configuration.apiUrl, supabase), [configuration.apiUrl, supabase]);
  const personalVaultRepository = useMemo(() => new MobilePersonalVaultRepository(transport), [transport]);
  const { session, status, requestSignInLink, signOut, consumeSecureShareSecret } = useMobileSession(supabase, configuration.authRedirectUrl, transport);
  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => requestSignInLink(value.email),
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <View style={styles.languageRow}>
            <Text style={styles.languageLabel}>{copy.language}</Text>
            <Pressable accessibilityRole="button" onPress={() => setLocale(locale === "id" ? "en" : "id")} style={styles.languageButton}>
              <Text style={styles.languageButtonText}>{copy.switchLanguage}</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Image source={appIcon} alt="" accessibilityIgnoresInvertColors style={styles.logo} />
            <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
            <Text accessibilityRole="header" style={styles.title}>{copy.title}</Text>
            <Text style={styles.description}>{copy.description}</Text>

            {session ? (
              <View style={styles.sessionPanel}>
                {status === "authenticated" ? <Text style={styles.success}>{copy.signedIn}</Text> : null}
                {status === "verifying" ? <Text style={styles.notice}>{copy.verifyingSession}</Text> : null}
                {status === "inactive" ? <Text style={styles.error}>{copy.inactiveSession}</Text> : null}
                {status === "session_unavailable" ? <Text style={styles.error}>{copy.sessionUnavailable}</Text> : null}
                <Text style={styles.sessionLabel}>{copy.signedInAs}</Text>
                <Text selectable style={styles.email}>{session.user.email}</Text>
                <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>{copy.signOut}</Text>
                </Pressable>
                {status === "authenticated" || status === "session_unavailable" ? (
                  <MobilePersonalVault copy={copy} consumeSecureShareSecret={consumeSecureShareSecret} repository={personalVaultRepository} transport={transport} />
                ) : null}
              </View>
            ) : (
              <form.Field
                name="email"
                validators={{
                  onSubmit: ({ value }) => {
                    if (!value.trim()) return copy.emailRequired;
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return copy.emailInvalid;
                    return undefined;
                  },
                }}
              >
                {(field) => {
                  const error = field.state.meta.errors[0];
                  return (
                    <View style={styles.formGroup}>
                      <Text nativeID="email-label" style={styles.label}>{copy.emailLabel}</Text>
                      <TextInput
                        accessibilityLabel={copy.emailLabel}
                        aria-invalid={Boolean(error)}
                        autoCapitalize="none"
                        autoComplete="email"
                        keyboardType="email-address"
                        onBlur={field.handleBlur}
                        onChangeText={field.handleChange}
                        placeholder={copy.emailPlaceholder}
                        style={[styles.input, error ? styles.inputInvalid : null]}
                        value={field.state.value}
                      />
                      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{String(error)}</Text> : null}
                      <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
                        {([canSubmit, isSubmitting]) => (
                          <Pressable
                            accessibilityRole="button"
                            disabled={!canSubmit || isSubmitting || status === "sending"}
                            onPress={() => void form.handleSubmit()}
                            style={({ pressed }) => [styles.primaryButton, pressed ? styles.buttonPressed : null]}
                          >
                            <Text style={styles.primaryButtonText}>{isSubmitting || status === "sending" ? copy.sendingLink : copy.sendLink}</Text>
                          </Pressable>
                        )}
                      </form.Subscribe>
                    </View>
                  );
                }}
              </form.Field>
            )}

            {status === "link_sent" ? <Text accessibilityLiveRegion="polite" style={styles.success}>{copy.linkSent}</Text> : null}
            {status === "request_error" ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{copy.signInFailed}</Text> : null}
            {status === "callback_error" ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{copy.callbackFailed}</Text> : null}
            {status === "share_link_ready" ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{copy.openShareLink}</Text> : null}
            <Text style={styles.securityNote}>{copy.securityNote}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ConfigurationError() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.configurationError}>
        <Text accessibilityRole="header" style={styles.title}>rhasia-scret</Text>
        <Text style={styles.error}>{translate("id").configurationError} / {translate("en").configurationError}</Text>
      </View>
    </SafeAreaView>
  );
}

const colors = {
  background: "#F9F6F0",
  card: "#FFFEFC",
  border: "#DED8CE",
  ink: "#172027",
  muted: "#5E6870",
  primary: "#D99412",
  primaryPressed: "#B87908",
  success: "#2F6B49",
  danger: "#A4433D",
  notice: "#526D82",
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: colors.background },
  page: { flexGrow: 1, justifyContent: "center", padding: 20, gap: 16 },
  languageRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10 },
  languageLabel: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  languageButton: { minHeight: 44, justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  languageButtonText: { color: colors.ink, fontWeight: "700" },
  card: { borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 24, gap: 14 },
  logo: { width: 72, height: 72, borderRadius: 16, alignSelf: "center" },
  eyebrow: { color: colors.primary, textAlign: "center", textTransform: "uppercase", letterSpacing: 1.5, fontSize: 12, fontWeight: "800" },
  title: { color: colors.ink, textAlign: "center", fontSize: 28, lineHeight: 34, fontWeight: "800" },
  description: { color: colors.muted, textAlign: "center", fontSize: 16, lineHeight: 24 },
  formGroup: { gap: 8, marginTop: 8 },
  label: { color: colors.ink, fontSize: 14, fontWeight: "700" },
  input: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: "#FFFFFF", color: colors.ink, paddingHorizontal: 14, fontSize: 16 },
  inputInvalid: { borderColor: colors.danger },
  primaryButton: { minHeight: 50, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: colors.primary, paddingHorizontal: 18, marginTop: 6 },
  primaryButtonText: { color: "#211704", fontSize: 16, fontWeight: "800" },
  buttonPressed: { backgroundColor: colors.primaryPressed },
  secondaryButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginTop: 8 },
  secondaryButtonText: { color: colors.ink, fontWeight: "800" },
  success: { color: colors.success, textAlign: "center", lineHeight: 21, fontWeight: "700" },
  error: { color: colors.danger, textAlign: "center", lineHeight: 21, fontWeight: "700" },
  notice: { color: colors.notice, textAlign: "center", lineHeight: 21, fontWeight: "700" },
  securityNote: { color: colors.muted, textAlign: "center", fontSize: 12, lineHeight: 18, marginTop: 6 },
  sessionPanel: { gap: 8, marginTop: 6 },
  sessionLabel: { color: colors.muted, textAlign: "center", fontSize: 13 },
  email: { color: colors.ink, textAlign: "center", fontWeight: "700" },
  configurationError: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
});
