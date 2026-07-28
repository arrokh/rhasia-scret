"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteVaultParticipant, loadVaultParticipants, type BrowserVaultParticipant } from "../../infrastructure/browser-vault-participant-client";

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

export function useDeleteVaultParticipantMutation(vaultId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (participant: BrowserVaultParticipant) => deleteVaultParticipant(vaultId, participant),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vaultParticipantsKey(vaultId) })
  });
}
