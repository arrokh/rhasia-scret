"use client";

import { useMemo } from "react";
import { UnlockedVaultWorkspaceProvider, useUnlockedVaultWorkspace, type UnlockedVaultWorkspace } from "@/modules/authenticator-account";
import { VaultArchiveImporter } from "@/modules/vault-archive/presentation/vault-archive-importer";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export function ArchiveImportPreviewClient() {
  const initialWorkspace = useMemo(() => createPreviewWorkspace(), []);
  return <UnlockedVaultWorkspaceProvider initialWorkspace={initialWorkspace}><PreviewHarness /></UnlockedVaultWorkspaceProvider>;
}

function PreviewHarness() {
  const { workspace, setWorkspace } = useUnlockedVaultWorkspace();
  if (!workspace) return null;
  return <AppPage><PageHeader backHref="/ui-preview" backLabel="Kembali" title="Import arsip Brankas" description="Pratinjau interaktif alur import terenkripsi." /><SurfaceCard><VaultArchiveImporter workspace={workspace} replaceWorkspace={setWorkspace} refreshAfterImport={async (current) => cloneWorkspace(current)} /></SurfaceCard></AppPage>;
}

function createPreviewWorkspace(): UnlockedVaultWorkspace {
  const personalKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  return {
    profileId: "preview-profile",
    synchronizedAt: new Date(0).toISOString(),
    synchronizationToken: "preview-token",
    syncState: "CURRENT",
    userRootKey: Uint8Array.from({ length: 32 }, (_, index) => 100 + index),
    vaults: [{ id: "preview-personal-vault", name: "Brankas Pribadi", type: "PERSONAL", role: "OWNER", key: personalKey }],
    accounts: [{ id: "preview-account", vaultId: "preview-personal-vault", vaultName: "Brankas Pribadi", vaultType: "PERSONAL", revision: 1, issuer: "Example", accountName: "alice@example.test", secret: new Uint8Array([1, 2, 3, 4]), algorithm: "SHA-1", digits: 6, period: 30 }],
    unavailableSharedVaults: 0
  };
}

function cloneWorkspace(workspace: UnlockedVaultWorkspace): UnlockedVaultWorkspace {
  return {
    ...workspace,
    userRootKey: workspace.userRootKey.slice(),
    vaults: workspace.vaults.map((vault) => ({ ...vault, key: vault.key.slice() })),
    accounts: workspace.accounts.map((account) => ({ ...account, secret: account.secret.slice() }))
  };
}
