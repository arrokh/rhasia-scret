"use client";

import { useState } from "react";
import { VaultWorkspaceUnlock, type UnlockedVaultWorkspace } from "@/modules/authenticator-account";
import { RememberedBrowserEnrollment } from "@/modules/crypto";
import { AppPage, PageHeader, StatusBanner, SurfaceCard } from "@/shared/presentation/app-ui";

export const REMEMBERED_BROWSER_PREVIEW_PROFILE_ID = "remembered-preview-profile";
export const REMEMBERED_BROWSER_PREVIEW_VAULT_ID = "remembered-preview-vault";
export const REMEMBERED_BROWSER_PREVIEW_USER_ROOT_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 11);

export function RememberedBrowserPreviewClient() {
  const [unlocked, setUnlocked] = useState<UnlockedVaultWorkspace | null>(null);
  return <AppPage>
    <PageHeader backHref="/ui-preview" backLabel="Kembali" title="Browser yang Diingat" description="Pratinjau khusus pengembangan untuk UI produksi enrollment dan unlock Verifikasi Lokal." />
    <SurfaceCard className="grid gap-5 p-5 sm:p-6">
      <RememberedBrowserEnrollment profileId={REMEMBERED_BROWSER_PREVIEW_PROFILE_ID} userRootKey={REMEMBERED_BROWSER_PREVIEW_USER_ROOT_KEY} />
    </SurfaceCard>
    <SurfaceCard>
      {unlocked ? <div className="p-5 sm:p-6"><StatusBanner tone="success" role="status">Unlocked Vault Session berhasil dibuat.</StatusBanner></div> : <VaultWorkspaceUnlock personalVaultId={REMEMBERED_BROWSER_PREVIEW_VAULT_ID} onUnlocked={setUnlocked} />}
    </SurfaceCard>
  </AppPage>;
}
