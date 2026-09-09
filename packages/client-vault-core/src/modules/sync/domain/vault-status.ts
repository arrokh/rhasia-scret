import type { OfflineSyncState } from "./offline-sync-state";

export type VaultOrigin = "LOCAL" | "PERSONAL" | "SHARED" | "SNAPSHOT";
export type VaultCapability = "LOCAL_WRITABLE" | "SERVER_WRITABLE" | "READ_ONLY";
export type VaultStatusKind =
  | "DEVICE_ONLY"
  | "CURRENT"
  | "OFFLINE_SNAPSHOT"
  | "RECONNECTING"
  | "AUTH_REQUIRED"
  | "STALE"
  | "ERROR"
  | "LOCAL_STORAGE_ERROR";

export type VaultStatusInput = {
  origin: VaultOrigin;
  syncState?: OfflineSyncState;
  onlineHint: boolean;
  lastSynchronizedAt?: string;
};

export type VaultStatus = {
  kind: VaultStatusKind;
  origin: VaultOrigin;
  capability: VaultCapability;
  onlineHint: boolean;
  lastSynchronizedAt?: string;
};

export function resolveVaultStatus(input: VaultStatusInput): VaultStatus {
  if (input.origin === "LOCAL")
    return { kind: "DEVICE_ONLY", origin: "LOCAL", capability: "LOCAL_WRITABLE", onlineHint: input.onlineHint };
  const syncState = input.syncState ?? "ERROR";
  const kind: VaultStatusKind =
    syncState === "CURRENT"
      ? "CURRENT"
      : syncState === "OFFLINE"
        ? "OFFLINE_SNAPSHOT"
        : syncState === "SYNCING"
          ? "RECONNECTING"
          : syncState === "AUTH_REQUIRED"
            ? "AUTH_REQUIRED"
            : syncState === "ERROR"
              ? "ERROR"
              : syncState === "LOCAL_STORAGE_ERROR"
                ? "LOCAL_STORAGE_ERROR"
                : "STALE";
  return {
    kind,
    origin: input.origin,
    capability: kind === "CURRENT" ? "SERVER_WRITABLE" : "READ_ONLY",
    onlineHint: input.onlineHint,
    lastSynchronizedAt: input.lastSynchronizedAt,
  };
}

export function canMutateVault(status: VaultStatus): boolean {
  return status.capability !== "READ_ONLY";
}
