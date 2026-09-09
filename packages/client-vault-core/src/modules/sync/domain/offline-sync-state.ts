export type OfflineSyncState =
  "OFFLINE" | "STALE" | "SYNCING" | "CURRENT" | "AUTH_REQUIRED" | "ERROR" | "LOCAL_STORAGE_ERROR";
export type OfflineSyncEvent =
  | "NETWORK_LOST"
  | "RECONNECT_STARTED"
  | "SYNC_SUCCEEDED"
  | "AUTHENTICATION_FAILED"
  | "SYNC_FAILED"
  | "LOCAL_STORAGE_FAILED";

export function nextOfflineSyncState(state: OfflineSyncState, event: OfflineSyncEvent): OfflineSyncState {
  switch (event) {
    case "NETWORK_LOST":
      return "OFFLINE";
    case "RECONNECT_STARTED":
      return state === "OFFLINE" ||
        state === "STALE" ||
        state === "ERROR" ||
        state === "LOCAL_STORAGE_ERROR" ||
        state === "AUTH_REQUIRED"
        ? "SYNCING"
        : state;
    case "SYNC_SUCCEEDED":
      return state === "SYNCING" ? "CURRENT" : state;
    case "AUTHENTICATION_FAILED":
      return state === "SYNCING" ? "AUTH_REQUIRED" : state;
    case "SYNC_FAILED":
      return state === "SYNCING" ? "STALE" : state;
    case "LOCAL_STORAGE_FAILED":
      return state === "SYNCING" ? "LOCAL_STORAGE_ERROR" : state;
  }
}

export function isReadOnlySyncState(state: OfflineSyncState): boolean {
  return state !== "CURRENT";
}
