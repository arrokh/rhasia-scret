"use client";

import { SharedVaultDetails, SharedVaultDirectory } from "@/modules/vault-management";
import { SurfaceCard } from "@/shared/presentation/app-ui";

export function VaultManagementPreview() {
  const vault = { id: "shared-preview", name: "Tim Operasional", role: "OWNER" as const, key: new Uint8Array(32), accounts: [{ id: "opaque-account-1", issuer: "Layanan contoh", accountName: "viewer@local.invalid", revision: 1 }] };
  return <div className="grid gap-5"><SurfaceCard aria-label="Daftar brankas"><SharedVaultDirectory vaults={[vault]} /></SurfaceCard><SurfaceCard aria-label="Detail Brankas Bersama"><SharedVaultDetails vault={vault} onRenamed={() => undefined} onAccountDeleted={async () => undefined} /></SurfaceCard></div>;
}
