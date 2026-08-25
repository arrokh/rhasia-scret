"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { VaultWorkspaceUnlock } from "@/modules/authenticator-account";
import type { UnlockedVaultWorkspace } from "@/modules/sync";
import { RememberedBrowserEnrollment } from "./remembered-browser-enrollment";
import { AppPage, PageHeader, StatusBanner, SurfaceCard } from "@/shared/presentation/app-ui";

export const REMEMBERED_BROWSER_PREVIEW_PROFILE_ID = "remembered-preview-profile";
export const REMEMBERED_BROWSER_PREVIEW_VAULT_ID = "remembered-preview-vault";
export const REMEMBERED_BROWSER_PREVIEW_USER_ROOT_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 11);

export function RememberedBrowserPreviewClient() {
  const t = useTranslations("Preview.remembered");
  const [unlocked, setUnlocked] = useState<UnlockedVaultWorkspace | null>(null);
  return <AppPage>
    <PageHeader backHref="/ui-preview" backLabel={t("back")} title={t("title")} description={t("description")} />
    <SurfaceCard className="grid gap-5 p-5 sm:p-6">
      <RememberedBrowserEnrollment profileId={REMEMBERED_BROWSER_PREVIEW_PROFILE_ID} userRootKey={REMEMBERED_BROWSER_PREVIEW_USER_ROOT_KEY} />
    </SurfaceCard>
    <SurfaceCard>
      {unlocked ? <div className="p-5 sm:p-6"><StatusBanner tone="success" role="status">{t("success")}</StatusBanner></div> : <VaultWorkspaceUnlock personalVaultId={REMEMBERED_BROWSER_PREVIEW_VAULT_ID} onUnlocked={setUnlocked} />}
    </SurfaceCard>
  </AppPage>;
}
