"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Fingerprint, LoaderCircle, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePasskeyRecoveryStatusQuery, useRemovePasskeyRecoveryMutation } from "@/modules/identity";
import { BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { PasskeyPrfUnsupportedError } from "../infrastructure/browser-passkey-prf";
import { enrollPasskeyRecovery } from "../infrastructure/browser-passkey-recovery-workflow";

export type PasskeyRecoveryEnrollmentErrorCode = "prfRequired" | "challengeExpired" | "verificationFailed" | "unavailable" | "unauthenticated" | "alreadyRegistered" | "cancelled" | "security" | "unsupported" | "unknown";

export function PasskeyRecoveryEnrollment({ userRootKey }: { userRootKey: Uint8Array }) {
  const t = useTranslations("Crypto.passkeyEnrollment");
  const recoveryStatus = usePasskeyRecoveryStatusQuery();
  const removeRecovery = useRemovePasskeyRecoveryMutation();
  const [status, setStatus] = useState<"idle" | "enrolling" | "success" | "error" | "removed" | "removal_error">("idle");
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [errorCode, setErrorCode] = useState<PasskeyRecoveryEnrollmentErrorCode>("unknown");

  async function enroll() {
    setStatus("enrolling");
    setErrorCode("unknown");
    try {
      await enrollPasskeyRecovery(userRootKey);
      setStatus("success");
      await recoveryStatus.refetch();
    } catch (reason) {
      setErrorCode(classifyPasskeyRecoveryEnrollmentError(reason));
      setStatus("error");
    }
  }

  async function detach() {
    try {
      await removeRecovery.mutateAsync();
      setConfirmingRemoval(false);
      setStatus("removed");
    } catch {
      setConfirmingRemoval(false);
      setStatus("removal_error");
    }
  }

  const enrolled = recoveryStatus.data?.enrolled === true;
  return <section className="grid gap-4">
    <div className="grid justify-items-center gap-3 text-center">
      <span className={`grid size-14 place-items-center rounded-xl ${enrolled ? "bg-success-surface text-success" : "bg-gold-soft text-ink-strong"}`}>
        {enrolled ? <CheckCircle2 className="size-7" /> : <Fingerprint className="size-7" />}
      </span>
      <p className="text-sm leading-6 text-muted-foreground">{t("description")}</p>
    </div>

    {recoveryStatus.isPending ? (
      <Button disabled aria-busy="true"><LoaderCircle className="animate-spin" />{t("checking")}</Button>
    ) : recoveryStatus.isError ? (
      <>
        <StatusBanner tone="danger" role="alert" title={t("statusErrorTitle")}>{t("statusError")}</StatusBanner>
        <Button variant="outline" type="button" onClick={() => void recoveryStatus.refetch()}><RefreshCw />{t("retry")}</Button>
      </>
    ) : enrolled ? (
      <>
        <StatusBanner tone="success" title={t("activeTitle")}>{t("active")}</StatusBanner>
        <p className="text-sm leading-6 text-muted-foreground">{t("activeHelp")}</p>
        <Button variant="outline" asChild><Link href="/vaults/recovery">{t("openRecovery")}</Link></Button>
        <Button variant="destructive" type="button" onClick={() => { setStatus("idle"); setConfirmingRemoval(true); }}><Unlink />{t("remove")}</Button>
      </>
    ) : (
      <Button type="button" onClick={() => void enroll()} disabled={status === "enrolling"} aria-busy={status === "enrolling"}>
        {status === "enrolling" && <LoaderCircle className="animate-spin" />}
        {status === "enrolling" ? t("enrolling") : t("enable")}
      </Button>
    )}

    {!enrolled && status === "success" && <StatusBanner tone="success">{t("enabled")}</StatusBanner>}
    {!enrolled && status === "removed" && <StatusBanner tone="success">{t("removed")}</StatusBanner>}
    {status === "error" && <StatusBanner tone="danger" role="alert" title={t("enrollErrorTitle")}>{t(`errors.${errorCode}`)}</StatusBanner>}
    {status === "removal_error" && <StatusBanner tone="danger" role="alert" title={t("removeErrorTitle")}>{t("removeError")}</StatusBanner>}
    {confirmingRemoval && <ConfirmationDialog title={t("confirmTitle")} description={t("confirmDescription")} confirmLabel={t("confirm")} danger pending={removeRecovery.isPending} onCancel={() => setConfirmingRemoval(false)} onConfirm={() => void detach()} />}
  </section>;
}

export function classifyPasskeyRecoveryEnrollmentError(reason: unknown): PasskeyRecoveryEnrollmentErrorCode {
  if (reason instanceof BrowserApiError) {
    if (reason.code === "passkey_prf_required") return "prfRequired";
    if (reason.code === "passkey_challenge_expired") return "challengeExpired";
    if (reason.code === "passkey_verification_failed") return "verificationFailed";
    if (reason.code === "passkey_recovery_unavailable" || reason.status === 503) return "unavailable";
    if (reason.code === "unauthenticated") return "unauthenticated";
  }
  if (reason instanceof DOMException) {
    if (reason.name === "InvalidStateError") return "alreadyRegistered";
    if (reason.name === "NotAllowedError" || reason.name === "AbortError") return "cancelled";
    if (reason.name === "SecurityError") return "security";
    if (reason.name === "NotSupportedError") return "unsupported";
  }
  if (reason instanceof PasskeyPrfUnsupportedError) return "prfRequired";
  return "unknown";
}
