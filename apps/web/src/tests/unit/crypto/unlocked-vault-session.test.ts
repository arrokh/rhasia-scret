import { describe, expect, it } from "vitest";
import { UnlockedVaultSession } from "@/modules/crypto/application/unlocked-vault-session";

describe("UnlockedVaultSession", () => {
  it("clears its in-memory key material on explicit lock and logout", () => {
    const session = new UnlockedVaultSession();
    const firstKey = new Uint8Array(32).fill(1);
    const secondKey = new Uint8Array(32).fill(2);
    session.unlock("vault-1", firstKey);
    session.unlock("vault-2", secondKey);
    firstKey.fill(0);
    expect(session.getUserRootKey("vault-1")).toEqual(new Uint8Array(32).fill(1));
    session.lock("vault-1");
    expect(session.isUnlocked("vault-1")).toBe(false);
    session.logout();
    expect(session.isUnlocked("vault-2")).toBe(false);
  });
});
