"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { loadVaultAuditEvents, type VaultAuditFilter } from "../../infrastructure/browser-vault-audit-client";

export function useVaultAuditQuery(vaultId: string, filter: VaultAuditFilter, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["audit", "vault", vaultId, "events", filter.accountId ?? null, filter.actorUserId ?? null],
    queryFn: ({ pageParam }) => loadVaultAuditEvents(vaultId, filter, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    staleTime: 5_000,
  });
}
