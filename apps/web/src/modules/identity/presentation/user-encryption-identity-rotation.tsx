"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import type { PreparedUserEncryptionIdentityRotation } from "../infrastructure/browser-user-encryption-identity-rotation-workflow";

type RotationStatus =
  | "idle"
  | "preparing"
  | "ready"
  | "submitting"
  | "success"
  | "notApplied"
  | "conflict"
  | "unknown"
  | "failed"
  | "cancelled"
  | "refreshFailed";

export function UserEncryptionIdentityRotation({
  userRootKey,
  profileId,
  publicKey,
  onRefresh,
}: {
  userRootKey: Uint8Array;
  profileId: string;
  publicKey?: unknown;
  onRefresh: () => Promise<void>;
}) {
  const t = useTranslations("Crypto.userEncryptionRotation");
  const [status, setStatus] = useState<RotationStatus>("idle");
  const [prepared, setPrepared] = useState<PreparedUserEncryptionIdentityRotation | null>(null);
  const [confirming, setConfirming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const statusBeforeRefreshRef = useRef<RotationStatus>("success");

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function prepare() {
    if (!publicKey) {
      setStatus("failed");
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setPrepared(null);
    setStatus("preparing");
    try {
      const { prepareBrowserUserEncryptionIdentityRotation } =
        await import("../infrastructure/browser-user-encryption-identity-rotation-workflow");
      const next = await prepareBrowserUserEncryptionIdentityRotation(
        userRootKey,
        profileId,
        publicKey,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setPrepared(next);
      setStatus("ready");
    } catch {
      setStatus(controller.signal.aborted ? "cancelled" : "failed");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  function cancelPreparation() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setPrepared(null);
    setConfirming(false);
    setStatus("cancelled");
  }

  async function submit() {
    if (!prepared) return;
    setConfirming(false);
    setStatus("submitting");
    try {
      const {
        reconcilePreparedBrowserUserEncryptionIdentityRotation,
        submitPreparedBrowserUserEncryptionIdentityRotation,
      } = await import("../infrastructure/browser-user-encryption-identity-rotation-workflow");
      let outcome = await submitPreparedBrowserUserEncryptionIdentityRotation(prepared);
      if (outcome === "UNKNOWN") {
        try {
          await onRefresh();
          outcome = await reconcilePreparedBrowserUserEncryptionIdentityRotation(prepared);
        } catch {
          outcome = "UNKNOWN";
        }
      }
      const nextStatus: RotationStatus =
        outcome === "COMMITTED"
          ? "success"
          : outcome === "NOT_APPLIED"
            ? "notApplied"
            : outcome === "CONFLICT"
              ? "conflict"
              : "unknown";
      setStatus(nextStatus);
      if (outcome !== "UNKNOWN") setPrepared(null);
      await refreshWorkspace(nextStatus);
    } catch {
      setStatus("unknown");
    }
  }

  async function checkStatus() {
    if (!prepared) return;
    setStatus("submitting");
    const { reconcilePreparedBrowserUserEncryptionIdentityRotation } =
      await import("../infrastructure/browser-user-encryption-identity-rotation-workflow");
    const outcome = await reconcilePreparedBrowserUserEncryptionIdentityRotation(prepared);
    const nextStatus: RotationStatus =
      outcome === "COMMITTED"
        ? "success"
        : outcome === "NOT_APPLIED"
          ? "notApplied"
          : outcome === "CONFLICT"
            ? "conflict"
            : "unknown";
    setStatus(nextStatus);
    if (outcome !== "UNKNOWN") setPrepared(null);
    await refreshWorkspace(nextStatus);
  }

  async function refreshWorkspace(nextStatus: RotationStatus) {
    statusBeforeRefreshRef.current = nextStatus;
    try {
      await onRefresh();
      setStatus(nextStatus);
    } catch {
      setStatus("refreshFailed");
    }
  }

  const statusText =
    status === "idle" || status === "preparing" || status === "submitting" || status === "ready" ? null : t(status);
  return (
    <section className="grid gap-3" aria-labelledby="user-encryption-identity-rotation-title">
      <div className="grid gap-1">
        <h3 id="user-encryption-identity-rotation-title" className="text-base font-bold text-ink-strong">
          {t("title")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      {!publicKey && (
        <>
          <StatusBanner tone="warning" role="status">
            {t("identityUnavailable")}
          </StatusBanner>
          <Button
            variant="outline"
            type="button"
            onClick={() => void onRefresh().catch(() => setStatus("refreshFailed"))}
          >
            {t("refreshWorkspace")}
          </Button>
        </>
      )}
      {status === "ready" && prepared && (
        <div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-4 text-sm">
          <p>{t("memberships", { count: prepared.snapshot.memberships.length })}</p>
          <p className="font-medium text-foreground">{t("irreversibleWarning")}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" type="button" onClick={() => setConfirming(true)}>
              {t("review")}
            </Button>
            <Button variant="outline" type="button" onClick={cancelPreparation}>
              {t("discard")}
            </Button>
          </div>
        </div>
      )}
      {status === "preparing" && (
        <div className="flex flex-wrap items-center gap-2" role="status">
          <p className="text-sm text-muted-foreground">{t("preparing")}</p>
          <Button variant="outline" type="button" onClick={cancelPreparation}>
            {t("cancelPreparation")}
          </Button>
        </div>
      )}
      {status === "submitting" && (
        <p className="text-sm text-muted-foreground" role="status">
          {t("submitting")}
        </p>
      )}
      {(status === "idle" ||
        status === "failed" ||
        status === "cancelled" ||
        status === "success" ||
        status === "notApplied" ||
        status === "conflict") && (
        <Button variant="outline" type="button" onClick={() => void prepare()} disabled={!publicKey}>
          {status === "success" ? t("rotateAgain") : t("prepare")}
        </Button>
      )}
      {statusText && (
        <StatusBanner
          tone={status === "success" ? "success" : "danger"}
          role={status === "success" ? "status" : "alert"}
        >
          {statusText}
        </StatusBanner>
      )}
      {status === "unknown" && prepared && (
        <Button variant="outline" type="button" onClick={() => void checkStatus()}>
          {t("checkStatus")}
        </Button>
      )}
      {status === "refreshFailed" && (
        <Button
          variant="outline"
          type="button"
          onClick={() =>
            void onRefresh()
              .then(() => setStatus(statusBeforeRefreshRef.current))
              .catch(() => setStatus("refreshFailed"))
          }
        >
          {t("refreshWorkspace")}
        </Button>
      )}
      {confirming && prepared && (
        <ConfirmationDialog
          title={t("confirmTitle")}
          description={t("confirmDescription", { count: prepared.snapshot.memberships.length })}
          confirmLabel={t("confirm")}
          danger
          pending={status === "submitting"}
          onCancel={cancelPreparation}
          onConfirm={() => void submit()}
        />
      )}
    </section>
  );
}
