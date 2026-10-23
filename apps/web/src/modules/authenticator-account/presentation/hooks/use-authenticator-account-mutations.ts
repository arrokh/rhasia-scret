"use client";

import { useMutation } from "@tanstack/react-query";
import {
  createEncryptedAuthenticatorAccount,
  deleteEncryptedAuthenticatorAccount,
  updateEncryptedAuthenticatorAccount,
} from "../../infrastructure/browser-authenticator-account-client";
import { trackVaultSensitiveOperation } from "@/modules/sync";

export function useDeleteEncryptedAuthenticatorAccountMutation() {
  return useMutation({
    mutationKey: ["authenticator-account", "delete"],
    mutationFn: ({
      vaultId,
      vaultType,
      accountId,
      expectedRevision,
    }: {
      vaultId: string;
      vaultType: "PERSONAL" | "SHARED";
      accountId: string;
      expectedRevision: number;
    }) =>
      trackVaultSensitiveOperation(() =>
        deleteEncryptedAuthenticatorAccount({ vaultId, vaultType }, accountId, expectedRevision),
      ),
  });
}

export function useUpdateEncryptedAuthenticatorAccountMutation() {
  return useMutation({
    mutationKey: ["authenticator-account", "update"],
    mutationFn: ({
      vaultId,
      vaultType,
      accountId,
      expectedRevision,
      encryptedPayload,
      encryptionVersion,
      keyVersion,
    }: {
      vaultId: string;
      vaultType: "PERSONAL" | "SHARED";
      accountId: string;
      expectedRevision: number;
      encryptedPayload: string;
      encryptionVersion: 1;
      keyVersion?: number;
    }) =>
      trackVaultSensitiveOperation(() =>
        updateEncryptedAuthenticatorAccount(
          { vaultId, vaultType, keyVersion },
          { accountId, expectedRevision, encryptedPayload, encryptionVersion },
        ),
      ),
  });
}

export function useCreateEncryptedAuthenticatorAccountMutation() {
  return useMutation({
    mutationKey: ["authenticator-account", "create"],
    mutationFn: ({
      vaultId,
      vaultType,
      encryptedPayload,
      encryptionVersion,
      source,
      keyVersion,
    }: {
      vaultId: string;
      vaultType: "PERSONAL" | "SHARED";
      encryptedPayload: string;
      encryptionVersion: 1;
      source?: "LOCAL_VAULT_COPY";
      keyVersion?: number;
    }) =>
      trackVaultSensitiveOperation(() =>
        createEncryptedAuthenticatorAccount(
          { vaultId, vaultType, keyVersion },
          { encryptedPayload, encryptionVersion, source },
        ),
      ),
  });
}
