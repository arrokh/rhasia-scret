"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { UnlockedVaultWorkspaceProvider, useUnlockedVaultWorkspace } from "@/modules/authenticator-account";
import type { UnlockedVaultWorkspace } from "@/modules/sync";
import { VaultArchiveImporter } from "./vault-archive-importer";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export function ArchiveImportPreviewClient() {
  const t = useTranslations("Preview.archive");
  const personalVaultName = t("personalVault");
  const initialWorkspace = useMemo(() => createPreviewWorkspace(personalVaultName), [personalVaultName]);
  return (
    <UnlockedVaultWorkspaceProvider initialWorkspace={initialWorkspace}>
      <PreviewHarness />
    </UnlockedVaultWorkspaceProvider>
  );
}

function PreviewHarness() {
  const t = useTranslations("Preview.archive");
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  if (!workspace) return null;
  return (
    <AppPage>
      <PageHeader backHref="/ui-preview" backLabel={t("back")} title={t("title")} description={t("description")} />
      <SurfaceCard>
        <VaultArchiveImporter
          workspace={workspace}
          replaceWorkspace={setWorkspace}
          refreshAfterImport={async (current) => cloneWorkspace(current)}
        />
      </SurfaceCard>
    </AppPage>
  );
}

function createPreviewWorkspace(personalVaultName: string): UnlockedVaultWorkspace {
  const personalKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  return {
    profileId: "preview-profile",
    synchronizedAt: new Date(0).toISOString(),
    synchronizationToken: "preview-token",
    syncState: "CURRENT",
    userRootKey: Uint8Array.from({ length: 32 }, (_, index) => 100 + index),
    vaults: [
      {
        id: "preview-personal-vault",
        name: personalVaultName,
        type: "PERSONAL",
        role: "OWNER",
        effectiveAccountPermissions: {
          permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true },
          sources: { canAddAccounts: "OWNER", canEditAccounts: "OWNER", canDeleteAccounts: "OWNER" },
        },
        key: personalKey,
      },
    ],
    accounts: [
      {
        id: "preview-account",
        vaultId: "preview-personal-vault",
        vaultName: personalVaultName,
        vaultType: "PERSONAL",
        revision: 1,
        issuer: "Example",
        accountName: "alice@example.test",
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

function cloneWorkspace(workspace: UnlockedVaultWorkspace): UnlockedVaultWorkspace {
  return {
    ...workspace,
    userRootKey: workspace.userRootKey.slice(),
    vaults: workspace.vaults.map((vault) => ({ ...vault, key: vault.key.slice() })),
    accounts: workspace.accounts.map((account) => ({ ...account, secret: account.secret.slice() })),
  };
}
