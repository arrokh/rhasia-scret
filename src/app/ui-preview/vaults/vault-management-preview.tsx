"use client";

import { useTranslations } from "next-intl";
import { SharedVaultDetails, SharedVaultDirectory } from "@/modules/vault-management";
import { SurfaceCard } from "@/shared/presentation/app-ui";

export function VaultManagementPreview() {
  const t = useTranslations("Preview.vaults");
  const sample = useTranslations("Preview.mobile");
  const vault = { id: "shared-preview", name: sample("operations"), role: "OWNER" as const, effectiveAccountPermissions: { permissions: { canAddAccounts: true, canEditAccounts: true, canDeleteAccounts: true }, sources: { canAddAccounts: "OWNER" as const, canEditAccounts: "OWNER" as const, canDeleteAccounts: "OWNER" as const } }, key: new Uint8Array(32), accounts: [{ id: "opaque-account-1", issuer: sample("sampleService"), accountName: "viewer@local.invalid", revision: 1 }] };
  return <div className="grid gap-5"><SurfaceCard aria-label={t("listLabel")}><SharedVaultDirectory vaults={[vault]} /></SurfaceCard><SurfaceCard aria-label={t("detailLabel")}><SharedVaultDetails vault={vault} onRenamed={() => undefined} onAccountDeleted={async () => undefined} /></SurfaceCard></div>;
}
