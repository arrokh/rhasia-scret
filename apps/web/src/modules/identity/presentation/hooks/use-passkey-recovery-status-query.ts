"use client";

import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  loadPasskeyRecoveryStatus,
  removePasskeyRecovery,
} from "../../infrastructure/browser-passkey-recovery-status-client";

export const passkeyRecoveryStatusQueryOptions = queryOptions({
  queryKey: ["identity", "passkey-recovery-status"],
  queryFn: loadPasskeyRecoveryStatus,
  staleTime: 30_000,
  retry: false,
});

export function usePasskeyRecoveryStatusQuery(enabled = true) {
  return useQuery({ ...passkeyRecoveryStatusQueryOptions, enabled });
}

export function useRemovePasskeyRecoveryMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["identity", "remove-passkey-recovery"],
    mutationFn: removePasskeyRecovery,
    onSuccess: () => queryClient.setQueryData(passkeyRecoveryStatusQueryOptions.queryKey, { enrolled: false }),
  });
}
