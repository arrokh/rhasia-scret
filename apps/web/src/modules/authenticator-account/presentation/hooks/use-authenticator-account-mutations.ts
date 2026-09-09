"use client";

import { useMutation } from "@tanstack/react-query";
import {
  createEncryptedAuthenticatorAccount,
  deleteEncryptedAuthenticatorAccount,
  updateEncryptedAuthenticatorAccount,
} from "../../infrastructure/browser-authenticator-account-client";

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
    }) => deleteEncryptedAuthenticatorAccount({ vaultId, vaultType }, accountId, expectedRevision),
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
    }: {
      vaultId: string;
      vaultType: "PERSONAL" | "SHARED";
      accountId: string;
      expectedRevision: number;
      encryptedPayload: string;
      encryptionVersion: 1;
    }) =>
      updateEncryptedAuthenticatorAccount(
        { vaultId, vaultType },
        { accountId, expectedRevision, encryptedPayload, encryptionVersion },
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
    }: {
      vaultId: string;
      vaultType: "PERSONAL" | "SHARED";
      encryptedPayload: string;
      encryptionVersion: 1;
      source?: "LOCAL_VAULT_COPY";
    }) => createEncryptedAuthenticatorAccount({ vaultId, vaultType }, { encryptedPayload, encryptionVersion, source }),
  });
}
