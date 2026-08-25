import { describe, expect, it } from "vitest";
import { canMutateVault, resolveVaultStatus } from "@/modules/sync";

describe("Vault status model", () => {
  it("keeps a Local Vault device-only and writable without treating connectivity as synchronization", () => {
    const status = resolveVaultStatus({ origin: "LOCAL", onlineHint: true });
    expect(status).toMatchObject({ kind: "DEVICE_ONLY", capability: "LOCAL_WRITABLE" });
    expect(canMutateVault(status)).toBe(true);
  });

  it.each([
    ["CURRENT", "CURRENT", "SERVER_WRITABLE"],
    ["OFFLINE", "OFFLINE_SNAPSHOT", "READ_ONLY"],
    ["SYNCING", "RECONNECTING", "READ_ONLY"],
    ["AUTH_REQUIRED", "AUTH_REQUIRED", "READ_ONLY"],
    ["STALE", "STALE", "READ_ONLY"],
    ["ERROR", "ERROR", "READ_ONLY"],
    ["LOCAL_STORAGE_ERROR", "LOCAL_STORAGE_ERROR", "READ_ONLY"]
  ] as const)("maps %s only after server state evidence", (syncState, kind, capability) => {
    const status = resolveVaultStatus({ origin: "PERSONAL", syncState, onlineHint: true, lastSynchronizedAt: "2026-01-01T00:00:00.000Z" });
    expect(status.kind).toBe(kind);
    expect(status.capability).toBe(capability);
    expect(canMutateVault(status)).toBe(capability !== "READ_ONLY");
  });
});
