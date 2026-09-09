"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { UnlockedVaultWorkspaceProvider, useUnlockedVaultWorkspace } from "@/modules/authenticator-account";
import type { UnlockedVaultWorkspace } from "@/modules/sync";
import { VaultArchiveExporter } from "./vault-archive-exporter";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export function ArchiveBackupPreviewClient() {
  const locale = useLocale();
  const t = useTranslations("Preview.archiveBackup");
  const initialWorkspace = useMemo(
    () =>
      createPreviewWorkspace({
        personal: t("personalVault"),
        team: t("teamVault"),
        viewer: t("viewerVault"),
        issuer: t("sampleIssuer"),
      }),
    [t],
  );
  return (
    <UnlockedVaultWorkspaceProvider key={locale} initialWorkspace={initialWorkspace}>
      <PreviewHarness />
    </UnlockedVaultWorkspaceProvider>
  );
}

function PreviewHarness() {
  const t = useTranslations("Preview.archiveBackup");
  const { workspace } = useUnlockedVaultWorkspace();
  return (
    <AppPage>
      <PageHeader backHref="/ui-preview" backLabel={t("back")} title={t("title")} description={t("description")} />
      <SurfaceCard>
        {workspace ? (
          <VaultArchiveExporter workspace={workspace} />
        ) : (
          <p className="p-5 text-sm text-muted-foreground">{t("locked")}</p>
        )}
      </SurfaceCard>
    </AppPage>
  );
}

function createPreviewWorkspace(labels: {
  personal: string;
  team: string;
  viewer: string;
  issuer: string;
}): UnlockedVaultWorkspace {
  const ownerPermissions = {
    permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true },
    sources: {
      canAddAccounts: "OWNER" as const,
      canEditAccounts: "OWNER" as const,
      canDeleteAccounts: "OWNER" as const,
    },
  };
  const viewerPermissions = {
    permissions: { canAddAccounts: false, canEditAccounts: false, canDeleteAccounts: false },
    sources: {
      canAddAccounts: "VAULT" as const,
      canEditAccounts: "VAULT" as const,
      canDeleteAccounts: "VAULT" as const,
    },
  };
  return {
    profileId: "preview-profile",
    synchronizedAt: new Date(0).toISOString(),
    synchronizationToken: "preview-token",
    syncState: "CURRENT",
    userRootKey: Uint8Array.from({ length: 32 }, (_, index) => 100 + index),
    vaults: [
      {
        id: "preview-personal-vault",
        name: labels.personal,
        type: "PERSONAL",
        role: "OWNER",
        effectiveAccountPermissions: ownerPermissions,
        key: Uint8Array.from({ length: 32 }, (_, index) => index + 1),
      },
      {
        id: "preview-owned-shared-vault",
        name: labels.team,
        type: "SHARED",
        role: "OWNER",
        effectiveAccountPermissions: ownerPermissions,
        key: Uint8Array.from({ length: 32 }, (_, index) => 25 + index),
      },
      {
        id: "preview-viewer-vault",
        name: labels.viewer,
        type: "SHARED",
        role: "VIEWER",
        effectiveAccountPermissions: viewerPermissions,
        key: Uint8Array.from({ length: 32 }, (_, index) => 50 + index),
      },
    ],
    accounts: [
      {
        id: "preview-account",
        vaultId: "preview-personal-vault",
        vaultName: labels.personal,
        vaultType: "PERSONAL",
        revision: 1,
        issuer: labels.issuer,
        accountName: "sample@local.invalid",
        secret: new Uint8Array([1, 2, 3, 4]),
        algorithm: "SHA-1",
        digits: 6,
        period: 30,
      },
    ],
    unavailableAccounts: [],
    unavailableSharedVaults: 0,
  };
}
