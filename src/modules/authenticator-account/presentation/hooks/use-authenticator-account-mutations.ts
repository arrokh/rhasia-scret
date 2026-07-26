"use client";

import { useMutation } from "@tanstack/react-query";
import { createEncryptedAuthenticatorAccount } from "../../infrastructure/browser-authenticator-account-client";

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
