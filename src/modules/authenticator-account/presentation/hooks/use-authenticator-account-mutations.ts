"use client";

import { useMutation } from "@tanstack/react-query";
import { createEncryptedAuthenticatorAccount, deleteEncryptedAuthenticatorAccount } from "../../infrastructure/browser-authenticator-account-client";

export function useDeleteEncryptedAuthenticatorAccountMutation() {
  return useMutation({
    mutationKey: ["authenticator-account", "delete"],
    mutationFn: ({ vaultId, accountId, expectedRevision }: { vaultId: string; accountId: string; expectedRevision: number }) =>
      deleteEncryptedAuthenticatorAccount(vaultId, accountId, expectedRevision)
  });
}

export function useCreateEncryptedAuthenticatorAccountMutation() {
  return useMutation({
    mutationKey: ["authenticator-account", "create"],
    mutationFn: ({ vaultId, vaultType, encryptedPayload, encryptionVersion }: {
      vaultId: string;
      vaultType: "PERSONAL" | "SHARED";
      encryptedPayload: string;
      encryptionVersion: number;
    }) => createEncryptedAuthenticatorAccount({ vaultId, vaultType }, { encryptedPayload, encryptionVersion })
  });
}
