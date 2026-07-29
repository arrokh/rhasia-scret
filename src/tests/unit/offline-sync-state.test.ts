import { describe, expect, it } from "vitest";
import { isReadOnlySyncState, nextOfflineSyncState, type OfflineSyncState } from "@/modules/sync";

describe("offline sync state machine", () => {
  it.each<[OfflineSyncState, Parameters<typeof nextOfflineSyncState>[1], OfflineSyncState]>([
    ["CURRENT", "NETWORK_LOST", "OFFLINE"],
    ["OFFLINE", "RECONNECT_STARTED", "SYNCING"],
    ["STALE", "RECONNECT_STARTED", "SYNCING"],
    ["SYNCING", "SYNC_SUCCEEDED", "CURRENT"],
    ["SYNCING", "AUTHENTICATION_FAILED", "AUTH_REQUIRED"],
    ["SYNCING", "SYNC_FAILED", "STALE"],
    ["SYNCING", "LOCAL_STORAGE_FAILED", "LOCAL_STORAGE_ERROR"]
  ])("transitions %s through %s to %s", (state, event, expected) => {
    expect(nextOfflineSyncState(state, event)).toBe(expected);
  });

  it("keeps every non-current state read-only", () => {
    expect(["OFFLINE", "STALE", "SYNCING", "AUTH_REQUIRED", "ERROR", "LOCAL_STORAGE_ERROR"].every((state) => isReadOnlySyncState(state as OfflineSyncState))).toBe(true);
    expect(isReadOnlySyncState("CURRENT")).toBe(false);
  });
});
