"use client";

import { useMutation } from "@tanstack/react-query";
import {
  createSharedVault,
  deleteSharedVault,
  type SharedVaultCreationRequest
} from "../../infrastructure/browser-vault-management-client";

export function useCreateSharedVaultMutation() {
  return useMutation({
    mutationKey: ["vault-management", "shared-vault", "create"],
    mutationFn: (request: SharedVaultCreationRequest) => createSharedVault(request)
  });
}

export function useDeleteSharedVaultMutation() {
  return useMutation({
    mutationKey: ["vault-management", "shared-vault", "delete"],
    mutationFn: (vaultId: string) => deleteSharedVault(vaultId)
  });
}
