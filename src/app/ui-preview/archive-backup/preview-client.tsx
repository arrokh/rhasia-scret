"use client";

import { useMemo } from "react";
import { UnlockedVaultWorkspaceProvider, useUnlockedVaultWorkspace, type UnlockedVaultWorkspace } from "@/modules/authenticator-account";
import { VaultArchiveExporter } from "@/modules/vault-archive/presentation/vault-archive-exporter";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export function ArchiveBackupPreviewClient() {
  const initialWorkspace = useMemo(() => createPreviewWorkspace(), []);
  return <UnlockedVaultWorkspaceProvider initialWorkspace={initialWorkspace}><PreviewHarness /></UnlockedVaultWorkspaceProvider>;
}

function PreviewHarness() {
  const { workspace } = useUnlockedVaultWorkspace();
  return <AppPage><PageHeader backHref="/ui-preview" backLabel="Kembali" title="Cadangan Brankas" description="Pratinjau interaktif alur cadangan terenkripsi." /><SurfaceCard>{workspace ? <VaultArchiveExporter workspace={workspace} /> : <p className="p-5 text-sm text-muted-foreground">Brankas telah dikunci dan materi cadangan telah dihapus.</p>}</SurfaceCard></AppPage>;
}

function createPreviewWorkspace(): UnlockedVaultWorkspace {
  return {
    profileId: "preview-profile",
    synchronizedAt: new Date(0).toISOString(),
    synchronizationToken: "preview-token",
    syncState: "CURRENT",
    userRootKey: Uint8Array.from({ length: 32 }, (_, index) => 100 + index),
    vaults: [
      { id: "preview-personal-vault", name: "Brankas Pribadi", type: "PERSONAL", role: "OWNER", key: Uint8Array.from({ length: 32 }, (_, index) => index + 1) },
      { id: "preview-owned-shared-vault", name: "Brankas Tim", type: "SHARED", role: "OWNER", key: Uint8Array.from({ length: 32 }, (_, index) => 25 + index) },
      { id: "preview-viewer-vault", name: "Brankas Viewer", type: "SHARED", role: "VIEWER", key: Uint8Array.from({ length: 32 }, (_, index) => 50 + index) }
    ],
    accounts: [{ id: "preview-account", vaultId: "preview-personal-vault", vaultName: "Brankas Pribadi", vaultType: "PERSONAL", revision: 1, issuer: "Private Issuer", accountName: "secret@example.test", secret: new Uint8Array([1, 2, 3, 4]), algorithm: "SHA-1", digits: 6, period: 30 }],
    unavailableSharedVaults: 0
  };
}
