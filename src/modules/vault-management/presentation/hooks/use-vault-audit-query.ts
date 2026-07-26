"use client";

import { useQuery } from "@tanstack/react-query";
import { loadVaultAuditEvents, type VaultAuditFilter } from "../../infrastructure/browser-vault-management-client";

export function useVaultAuditQuery(vaultId: string, filter: VaultAuditFilter, enabled: boolean) {
  return useQuery({
    queryKey: ["vault-management", "shared-vault", vaultId, "audit-events", filter.accountId ?? null, filter.actorUserId ?? null],
    queryFn: () => loadVaultAuditEvents(vaultId, filter),
    enabled,
    staleTime: 5_000
  });
}
