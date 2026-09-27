"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import type { PreparedVaultKeyRotation } from "../infrastructure/browser-vault-key-rotation-workflow";

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

export function VaultKeyRotationPanel({
  vaultId,
  vaultName,
  vaultKey,
  keyVersion,
  onRefresh,
  enabled = true,
}: {
  vaultId: string;
  vaultName: string;
  vaultKey: Uint8Array;
  keyVersion?: number;
  onRefresh: () => Promise<void>;
  enabled?: boolean;
}) {
  const t = useTranslations("VaultManagement.keyRotation");
  const [status, setStatus] = useState<RotationStatus>("idle");
  const [prepared, setPrepared] = useState<PreparedVaultKeyRotation | null>(null);
  const [confirming, setConfirming] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const statusBeforeRefreshRef = useRef<RotationStatus>("success");

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function prepare() {
    if (keyVersion === undefined || !Number.isSafeInteger(keyVersion)) {
      setStatus("failed");
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    setPrepared(null);
    setStatus("preparing");
    try {
      const { prepareBrowserVaultKeyRotation } = await import("../infrastructure/browser-vault-key-rotation-workflow");
      const next = await prepareBrowserVaultKeyRotation(vaultId, vaultKey, keyVersion, controller.signal);
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
      const { reconcilePreparedBrowserVaultKeyRotation, submitPreparedBrowserVaultKeyRotation } =
        await import("../infrastructure/browser-vault-key-rotation-workflow");
      let outcome = await submitPreparedBrowserVaultKeyRotation(vaultId, prepared);
      if (outcome === "UNKNOWN") {
        try {
          await onRefresh();
          outcome = await reconcilePreparedBrowserVaultKeyRotation(vaultId, prepared);
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
    const { reconcilePreparedBrowserVaultKeyRotation } =
      await import("../infrastructure/browser-vault-key-rotation-workflow");
    const outcome = await reconcilePreparedBrowserVaultKeyRotation(vaultId, prepared);
    setStatus(
      outcome === "COMMITTED"
        ? "success"
        : outcome === "NOT_APPLIED"
          ? "notApplied"
          : outcome === "CONFLICT"
            ? "conflict"
            : "unknown",
    );
    if (outcome !== "UNKNOWN") setPrepared(null);
    await refreshWorkspace(
      outcome === "COMMITTED"
        ? "success"
        : outcome === "NOT_APPLIED"
          ? "notApplied"
          : outcome === "CONFLICT"
            ? "conflict"
            : "unknown",
    );
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
    <section className="grid gap-4" aria-labelledby={`vault-key-rotation-${vaultId}`}>
      <div className="grid gap-1">
        <h3 id={`vault-key-rotation-${vaultId}`} className="text-base font-bold text-ink-strong">
          {t("title")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("description", { name: vaultName })}</p>
      </div>
      {status === "ready" && prepared && (
        <div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-4 text-sm">
          <p>{t("generation", { current: prepared.snapshot.currentKeyVersion, next: prepared.request.keyVersion })}</p>
          <p>
            {t("accounts", {
              count: prepared.snapshot.accounts.length,
              recoverable: prepared.snapshot.accounts.filter((account) => account.recoverableDeleted).length,
            })}
          </p>
          <p>{t("members", { count: prepared.snapshot.members.length })}</p>
          <p>{t("invitations", { count: prepared.snapshot.pendingInvitationCount })}</p>
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
        status === "conflict") &&
        enabled && (
          <Button variant="outline" type="button" onClick={() => void prepare()} disabled={keyVersion === undefined}>
            {status === "success" ? t("rotateAgain") : t("prepare")}
          </Button>
        )}
      {!enabled && <p className="text-sm text-muted-foreground">{t("previewDisabled")}</p>}
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
          description={t("confirmDescription", {
            current: prepared.snapshot.currentKeyVersion,
            next: prepared.request.keyVersion,
            accounts: prepared.snapshot.accounts.length,
            members: prepared.snapshot.members.length,
            invitations: prepared.snapshot.pendingInvitationCount,
          })}
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
