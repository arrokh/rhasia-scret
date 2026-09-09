"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { useDeleteSharedVaultMutation } from "./hooks/use-shared-vault-mutations";

export function OwnedSharedVaultResetBlocker({ vaultIds }: { vaultIds: string[] }) {
  const t = useTranslations("VaultManagement.blocker");
  const router = useRouter();
  const deleteMutation = useDeleteSharedVaultMutation();
  const [vaultToDelete, setVaultToDelete] = useState<string | null>(null);
  function deleteVault(vaultId: string) {
    deleteMutation.mutate(vaultId, {
      onSuccess: () => {
        setVaultToDelete(null);
        router.refresh();
      },
    });
  }

  return (
    <div className="grid gap-5">
      <StatusBanner tone="danger" title={t("title")} role="alert">
        <p>{t("description", { count: vaultIds.length })}</p>
        <p className="mt-2">{t("instruction")}</p>
      </StatusBanner>
      <ul className="grid list-none gap-2 p-0">
        {vaultIds.map((vaultId, index) => (
          <li
            key={vaultId}
            className="flex min-h-16 items-center justify-between gap-3 rounded-md border border-destructive/20 bg-danger-surface/50 p-3"
          >
            <span className="font-bold text-destructive">{t("vault", { number: index + 1 })}</span>
            <Button
              variant="destructive"
              size="sm"
              type="button"
              disabled={deleteMutation.isPending}
              aria-busy={deleteMutation.isPending && deleteMutation.variables === vaultId}
              onClick={() => setVaultToDelete(vaultId)}
            >
              <Trash2 />
              {deleteMutation.isPending && deleteMutation.variables === vaultId ? t("deleting") : t("delete")}
            </Button>
          </li>
        ))}
      </ul>
      {deleteMutation.isError && (
        <StatusBanner tone="danger" role="alert">
          {t("error")}
        </StatusBanner>
      )}
      {vaultToDelete && (
        <ConfirmationDialog
          title={t("confirmTitle")}
          description={t("confirmDescription")}
          confirmLabel={t("delete")}
          danger
          pending={deleteMutation.isPending}
          onCancel={() => setVaultToDelete(null)}
          onConfirm={() => deleteVault(vaultToDelete)}
        />
      )}
    </div>
  );
}
