"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { Fingerprint, KeyRound, LoaderCircle, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { hasRememberedBrowserForPersonalVault } from "@/modules/crypto";
import { usePasskeyRecoveryStatusQuery } from "@/modules/identity";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";
import { FormFieldError } from "@/shared/presentation/form-field-error";
import { PasswordInput } from "@/shared/presentation/password-input";
import {
  clearUnlockedVaultWorkspace,
  loadUnlockedVaultWorkspace,
  loadUnlockedVaultWorkspaceWithPasskey,
  loadUnlockedVaultWorkspaceWithRememberedBrowser,
  type UnlockedVaultWorkspace,
} from "@/modules/sync";

export function VaultWorkspaceUnlock({
  personalVaultId,
  onUnlocked,
}: {
  personalVaultId: string;
  onUnlocked: (workspace: UnlockedVaultWorkspace) => void;
}) {
  const t = useTranslations("AuthenticatorAccount.unlock");
  const [status, setStatus] = useState<"idle" | "secret_error" | "passkey_error" | "remembered_error">("idle");
  const [passkeyUnlocking, setPasskeyUnlocking] = useState(false);
  const [rememberedUnlocking, setRememberedUnlocking] = useState(false);
  const [rememberedAvailable, setRememberedAvailable] = useState(false);
  const [secretVisible, setSecretVisible] = useState(false);
  const recoveryStatus = usePasskeyRecoveryStatusQuery();
  const rememberedOperationRef = useRef<AbortController | null>(null);
  const form = useForm({
    defaultValues: { secret: "" },
    onSubmit: async ({ value }) => {
      setStatus("idle");
      try {
        onUnlocked(await loadUnlockedVaultWorkspace(value.secret, personalVaultId));
        captureAnalyticsEvent(ANALYTICS_EVENTS.vaultUnlocked, { method: "passphrase" });
        form.reset();
      } catch {
        captureAnalyticsEvent(ANALYTICS_EVENTS.vaultUnlockFailed, {
          method: "passphrase",
          failure_code: "invalid_secret",
        });
        setStatus("secret_error");
      }
    },
  });

  useEffect(() => {
    let active = true;
    hasRememberedBrowserForPersonalVault(personalVaultId)
      .then((available) => {
        if (active) setRememberedAvailable(available);
      })
      .catch(() => {
        if (active) setRememberedAvailable(false);
      });
    return () => {
      active = false;
    };
  }, [personalVaultId]);
  useEffect(() => () => rememberedOperationRef.current?.abort(), []);

  async function unlockRememberedBrowser() {
    setStatus("idle");
    setRememberedUnlocking(true);
    const controller = new AbortController();
    rememberedOperationRef.current?.abort();
    rememberedOperationRef.current = controller;
    try {
      const workspace = await loadUnlockedVaultWorkspaceWithRememberedBrowser(personalVaultId, controller.signal);
      if (controller.signal.aborted) {
        clearUnlockedVaultWorkspace(workspace);
        return;
      }
      onUnlocked(workspace);
      captureAnalyticsEvent(ANALYTICS_EVENTS.vaultUnlocked, { method: "remembered_browser" });
      form.reset();
    } catch {
      if (!controller.signal.aborted) {
        captureAnalyticsEvent(ANALYTICS_EVENTS.vaultUnlockFailed, {
          method: "remembered_browser",
          failure_code: "remembered_browser_error",
        });
        setStatus("remembered_error");
      }
    } finally {
      if (rememberedOperationRef.current === controller) rememberedOperationRef.current = null;
      if (!controller.signal.aborted) setRememberedUnlocking(false);
    }
  }

  async function unlockWithPasskey() {
    setStatus("idle");
    setPasskeyUnlocking(true);
    try {
      onUnlocked(await loadUnlockedVaultWorkspaceWithPasskey(personalVaultId));
      captureAnalyticsEvent(ANALYTICS_EVENTS.vaultUnlocked, { method: "passkey" });
      form.reset();
    } catch {
      captureAnalyticsEvent(ANALYTICS_EVENTS.vaultUnlockFailed, { method: "passkey", failure_code: "passkey_error" });
      setStatus("passkey_error");
    } finally {
      setPasskeyUnlocking(false);
    }
  }

  return (
    <form
      noValidate
      className="grid gap-5 p-5 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <div className="grid justify-items-center gap-3 text-center">
        <span className="grid size-16 place-items-center rounded-xl bg-gold-soft text-ink-strong" aria-hidden="true">
          <KeyRound className="size-7" />
        </span>
        <div>
          <h2 className="text-xl font-bold text-ink-strong">{t("title")}</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{t("description")}</p>
        </div>
      </div>
      <form.Field
        name="secret"
        validators={{ onSubmit: ({ value }) => (value.trim() ? undefined : t("passphraseRequired")) }}
      >
        {(field) => (
          <div className="grid gap-2">
            <Label htmlFor="vault-unlock-secret">{t("passphrase")}</Label>
            <PasswordInput
              id="vault-unlock-secret"
              label={t("passphrase")}
              visible={secretVisible}
              onToggleVisibility={() => setSecretVisible((visible) => !visible)}
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              aria-invalid={field.state.meta.errors.length > 0}
              aria-describedby={field.state.meta.errors.length ? "vault-unlock-secret-error" : undefined}
              disabled={passkeyUnlocking || rememberedUnlocking}
              required
              autoComplete="current-password"
            />
            <FormFieldError id="vault-unlock-secret-error" errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting || passkeyUnlocking || rememberedUnlocking}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? t("unlocking") : t("unlock")}
          </Button>
        )}
      </form.Subscribe>
      {rememberedAvailable && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
            {t("or")}
          </div>
          <Button
            variant="outline"
            type="button"
            onClick={() => void unlockRememberedBrowser()}
            disabled={rememberedUnlocking || passkeyUnlocking}
            aria-busy={rememberedUnlocking}
          >
            {rememberedUnlocking ? <LoaderCircle className="animate-spin" /> : <Fingerprint />}
            {rememberedUnlocking ? t("verifyingDevice") : t("localVerification")}
          </Button>
          <p className="text-center text-xs leading-5 text-muted-foreground">{t("rememberedHelp")}</p>
        </>
      )}
      {recoveryStatus.data?.enrolled && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
            {t("or")}
          </div>
          <Button
            variant="outline"
            type="button"
            onClick={() => void unlockWithPasskey()}
            disabled={passkeyUnlocking || rememberedUnlocking}
            aria-busy={passkeyUnlocking}
          >
            {passkeyUnlocking ? <LoaderCircle className="animate-spin" /> : <Fingerprint />}
            {passkeyUnlocking ? t("verifyingPasskey") : t("passkey")}
          </Button>
        </>
      )}
      <Button variant="link" asChild>
        <Link href="/vaults/recovery">{t("forgot")}</Link>
      </Button>
      <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex items-start gap-3">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-md bg-card text-foreground"
            aria-hidden="true"
          >
            <Smartphone className="size-4" />
          </span>
          <div>
            <p className="text-sm font-bold text-ink-strong">{t("localVaultTitle")}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("localVaultDescription")}</p>
          </div>
        </div>
        <Button variant="outline" type="button" asChild className="w-full sm:w-auto">
          <Link href="/local">{t("openLocalVault")}</Link>
        </Button>
      </div>
      {status === "secret_error" && (
        <StatusBanner tone="danger" role="alert">
          {t("secretError")}
        </StatusBanner>
      )}
      {status === "passkey_error" && (
        <StatusBanner tone="danger" role="alert">
          {t("passkeyError")}
        </StatusBanner>
      )}
      {status === "remembered_error" && (
        <StatusBanner tone="warning" role="alert">
          {t("rememberedError")}
        </StatusBanner>
      )}
    </form>
  );
}
