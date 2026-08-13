"use client";

import { useMutation } from "@tanstack/react-query";
import {
  createSharedVault,
  deleteSharedVault,
  renameSharedVault,
  type SharedVaultCreationRequest
} from "../../infrastructure/browser-vault-management-client";

export function useCreateSharedVaultMutation() {
  return useMutation({
    mutationKey: ["vault-management", "shared-vault", "create"],
    mutationFn: (request: SharedVaultCreationRequest) => createSharedVault(request)
  });
}

export function useRenameSharedVaultMutation() {
  return useMutation({
    mutationKey: ["vault-management", "shared-vault", "rename"],
    mutationFn: ({ vaultId, encryptedName }: { vaultId: string; encryptedName: string }) => renameSharedVault(vaultId, encryptedName)
  });
}

export function useDeleteSharedVaultMutation() {
  return useMutation({
    mutationKey: ["vault-management", "shared-vault", "delete"],
    mutationFn: (vaultId: string) => deleteSharedVault(vaultId)
  });
}
