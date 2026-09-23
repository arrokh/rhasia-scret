/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAuthorizedWorkspaceBundle } from "@/modules/sync/infrastructure/browser-offline-sync-client";

const ciphertext = Buffer.from([1, ...Array<number>(31).fill(7)]).toString("base64");
const salt = Buffer.alloc(16, 8).toString("base64");
const response = {
  responseVersion: 1,
  workspaceSynchronizationToken: "stable-token",
  synchronizedAt: "2026-01-01T00:00:00.000Z",
  personalSnapshot: {
    schemaVersion: 3,
    profileId: "profile-1",
    synchronizedAt: "2026-01-01T00:00:00.000Z",
    synchronizationToken: "personal-token",
    cryptoProfile: {
      vaultUnlockSalt: salt,
      wrappedUserRootKey: ciphertext,
      encryptedPersonalVaultKey: ciphertext,
      encryptionVersion: 1,
    },
    personalVault: {
      vaultId: "personal-1",
      lifecycle: "ACTIVE",
      encryptedName: ciphertext,
      encryptionVersion: 1,
      accounts: [],
    },
  },
  sharedVaults: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("authorized workspace synchronization client", () => {
  it("requests the transient online workspace contract", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("/api/v1/sync/workspace-bundle");
      expect(init?.cache).toBe("no-store");
      return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAuthorizedWorkspaceBundle()).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
