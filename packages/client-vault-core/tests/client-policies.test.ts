import { describe, expect, it } from "vitest";
import { canMutateVault, hasClockDrift, resolveVaultStatus } from "../src/index";

describe("shared client policies", () => {
  it("detects clock drift only beyond the configured threshold", () => {
    expect(hasClockDrift(new Date(0), new Date(30_000))).toBe(false);
    expect(hasClockDrift(new Date(0), new Date(30_001))).toBe(true);
  });

  it("maps synchronized workspace state to a writable vault status", () => {
    const status = resolveVaultStatus({ origin: "PERSONAL", syncState: "CURRENT", onlineHint: true, lastSynchronizedAt: "2026-01-01T00:00:00.000Z" });
    expect(status).toMatchObject({ kind: "CURRENT", capability: "SERVER_WRITABLE" });
    expect(canMutateVault(status)).toBe(true);
  });

  it("keeps offline snapshots read-only", () => {
    const status = resolveVaultStatus({ origin: "SNAPSHOT", syncState: "OFFLINE", onlineHint: false });
    expect(status).toMatchObject({ kind: "OFFLINE_SNAPSHOT", capability: "READ_ONLY" });
    expect(canMutateVault(status)).toBe(false);
  });
});
