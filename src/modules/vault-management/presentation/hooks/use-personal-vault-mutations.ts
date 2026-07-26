"use client";

import { useMutation } from "@tanstack/react-query";
import {
  destructivelyResetPersonalVault,
  initializePersonalVault,
  type PersonalVaultInitializationRequest
} from "../../infrastructure/browser-vault-management-client";

export function useInitializePersonalVaultMutation() {
  return useMutation({
    mutationKey: ["vault-management", "personal-vault", "initialize"],
    mutationFn: (request: PersonalVaultInitializationRequest) => initializePersonalVault(request)
  });
}

export function useDestructivePersonalVaultResetMutation() {
  return useMutation({
    mutationKey: ["vault-management", "personal-vault", "destructive-reset"],
    mutationFn: (confirmation: string) => destructivelyResetPersonalVault(confirmation)
  });
}
