/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAuthorizedOfflineBundle } from "@/modules/sync/infrastructure/browser-offline-sync-client";
import type { EncryptedOfflineVaultBundle } from "@/modules/sync";

const ciphertext = Buffer.from([1, ...Array<number>(31).fill(7)]).toString("base64");
const salt = Buffer.alloc(16, 8).toString("base64");
const bundle: EncryptedOfflineVaultBundle = {
  schemaVersion: 2,
  profileId: "profile-1",
  synchronizedAt: "2026-01-01T00:00:00.000Z",
  synchronizationToken: "stable-token",
  cryptoProfile: { vaultUnlockSalt: salt, wrappedUserRootKey: ciphertext, encryptedPersonalVaultKey: ciphertext, encryptionVersion: 1 },
  personalVault: { vaultId: "personal-1", lifecycle: "ACTIVE", encryptedName: ciphertext, encryptionVersion: 1, accounts: [] },
  sharedVaults: []
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("authorized offline synchronization client", () => {
  it("reuses only encrypted local data after a server-authorized unchanged response", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("if-none-match")).toBe('"stable-token"');
      return new Response(null, { status: 304, headers: { "x-synchronized-at": "2026-01-02T00:00:00.000Z" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAuthorizedOfflineBundle(bundle)).resolves.toEqual({ ...bundle, synchronizedAt: "2026-01-02T00:00:00.000Z" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("parses a changed encrypted bundle without sending an empty validator", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
      return new Response(JSON.stringify(bundle), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAuthorizedOfflineBundle()).resolves.toEqual(bundle);
  });
});
