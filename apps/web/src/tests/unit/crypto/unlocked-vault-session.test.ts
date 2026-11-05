import { describe, expect, it } from "vitest";
import { UnlockedVaultSession } from "@/modules/crypto/application/unlocked-vault-session";

describe("UnlockedVaultSession", () => {
  it("isolates returned keys, replaces one Vault key, and tolerates repeated cleanup", () => {
    const session = new UnlockedVaultSession();
    const firstKey = new Uint8Array(32).fill(1);
    const secondKey = new Uint8Array(32).fill(2);
    session.unlock("vault-1", firstKey);
    session.unlock("vault-2", secondKey);
    firstKey.fill(0);

    const returnedKey = session.getUserRootKey("vault-1");
    returnedKey?.fill(0);
    expect(session.getUserRootKey("vault-1")).toEqual(new Uint8Array(32).fill(1));

    const replacementKey = new Uint8Array(32).fill(3);
    session.unlock("vault-1", replacementKey);
    expect(session.getUserRootKey("vault-1")).toEqual(replacementKey);
    expect(session.getUserRootKey("vault-2")).toEqual(new Uint8Array(32).fill(2));

    session.lock("vault-1");
    session.lock("vault-1");
    expect(session.isUnlocked("vault-1")).toBe(false);
    session.logout();
    session.logout();
    expect(session.isUnlocked("vault-2")).toBe(false);
    expect(session.getUserRootKey("vault-2")).toBeNull();
  });
});
