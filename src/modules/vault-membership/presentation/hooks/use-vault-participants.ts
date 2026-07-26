"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { deleteVaultParticipant, loadVaultParticipants, type BrowserVaultParticipant } from "../../infrastructure/browser-vault-participant-client";

export const vaultParticipantsKey = (vaultId: string) => ["vault-membership", "shared-vault", vaultId, "participants"] as const;

export function useVaultParticipantsQuery(vaultId: string, enabled: boolean) {
  return useQuery({
    queryKey: vaultParticipantsKey(vaultId),
    queryFn: () => loadVaultParticipants(vaultId),
    enabled,
    staleTime: 5_000
  });
}

export function useDeleteVaultParticipantMutation(vaultId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (participant: BrowserVaultParticipant) => deleteVaultParticipant(vaultId, participant),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: vaultParticipantsKey(vaultId) })
  });
}
