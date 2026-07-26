"use client";

import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

export type PasskeyRecoveryStatus = { enrolled: boolean };

export function loadPasskeyRecoveryStatus(): Promise<PasskeyRecoveryStatus> {
  return browserApiClient.getJson("/api/passkey-recovery/status", { cache: "no-store" });
}

export function removePasskeyRecovery(): Promise<void> {
  return browserApiClient.deleteEmpty("/api/passkey-recovery");
}
