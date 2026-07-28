"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SharedVaultAccountPermissionOverrides, SharedVaultAccountPermissions } from "../../domain/shared-vault-account-permissions";
import {
  deleteVaultParticipant,
  loadVaultParticipants,
  updateVaultDefaultAccountPermissions,
  updateVaultMemberAccountPermissionOverrides,
  type BrowserVaultParticipant
} from "../../infrastructure/browser-vault-participant-client";

export const vaultParticipantsKey = (vaultId: string) => ["vault-membership", "shared-vault", vaultId, "participants"] as const;

export function useVaultParticipantsQuery(vaultId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: vaultParticipantsKey(vaultId),
    queryFn: ({ pageParam }) => loadVaultParticipants(vaultId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled,
    staleTime: 5_000,
    refetchOnMount: "always"
  });
}

export function useUpdateVaultDefaultAccountPermissionsMutation(vaultId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ expectedRevision, permissions }: { expectedRevision: number; permissions: SharedVaultAccountPermissions }) =>
      updateVaultDefaultAccountPermissions(vaultId, expectedRevision, permissions),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vaultParticipantsKey(vaultId) })
  });
}

export function useUpdateVaultMemberAccountPermissionOverridesMutation(vaultId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberUserId, expectedRevision, overrides }: {
      memberUserId: string;
      expectedRevision: number;
      overrides: SharedVaultAccountPermissionOverrides;
    }) => updateVaultMemberAccountPermissionOverrides(vaultId, memberUserId, expectedRevision, overrides),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vaultParticipantsKey(vaultId) })
  });
}

export function useDeleteVaultParticipantMutation(vaultId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (participant: BrowserVaultParticipant) => deleteVaultParticipant(vaultId, participant),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vaultParticipantsKey(vaultId) })
  });
}
