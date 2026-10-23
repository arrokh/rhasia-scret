/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LocalVaultSession,
  type LocalVaultRecord,
  type LocalVaultSessionPorts,
  type UnlockedLocalVault,
} from "@/modules/local-vault";

const sessionHarness = vi.hoisted(() => ({ session: null as LocalVaultSession | null }));
vi.mock("@/modules/local-vault/infrastructure/browser-local-vault-session", () => ({
  createBrowserLocalVaultSession: () => {
    if (!sessionHarness.session) throw new Error("The Local Vault session fixture is unavailable.");
    return sessionHarness.session;
  },
}));

import { useLocalVaultSession } from "@/modules/local-vault/presentation/use-local-vault-session";
import { requestLocalVaultLock } from "@/modules/sync";

const record: LocalVaultRecord = {
  version: 1,
  profileId: "synthetic-profile",
  createdAt: "2026-09-01T00:00:00.000Z",
  kdf: { algorithm: "ARGON2ID", memoryKiB: 65536, iterations: 3, parallelism: 1, salt: "AA==" },
  wrappedLocalRootKey: "AA==",
  encryptedLocalVaultKey: "AA==",
  encryptedVaultName: "AA==",
  accounts: [],
};

function unlockedVault(): UnlockedLocalVault {
  return {
    profileId: record.profileId,
    createdAt: record.createdAt,
    name: "Synthetic Local Vault",
    rootKey: new Uint8Array(32).fill(1),
    vaultKey: new Uint8Array(32).fill(2),
    accounts: [],
  };
}

describe("useLocalVaultSession global lock handling", () => {
  let root: Root | null = null;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    sessionHarness.session?.dispose();
    sessionHarness.session = null;
  });

  it("clears decrypted Local Vault material when the application requests a global lock", async () => {
    const cleared: UnlockedLocalVault[] = [];
    const ports: LocalVaultSessionPorts = {
      isAvailable: () => true,
      readRecord: async () => record,
      readArchiveExportAt: async () => null,
      clearOrphanedArchiveExportMarker: async () => undefined,
      trackSensitiveOperation: <Result>(operation: () => Promise<Result>) => operation(),
      createRecord: async () => record,
      persistCreatedRecord: async () => undefined,
      unlockRecord: async () => unlockedVault(),
      migrateRecord: async () => record,
      refreshVault: async () => unlockedVault(),
      clearRecord: async () => undefined,
      clearVault: (vault) => {
        if (!vault) return;
        cleared.push(vault);
        vault.rootKey.fill(0);
        vault.vaultKey.fill(0);
      },
      isMigrationRequired: () => false,
    };
    const session = new LocalVaultSession(ports);
    sessionHarness.session = session;
    const container = document.createElement("div");
    root = createRoot(container);

    function Probe() {
      const { state } = useLocalVaultSession();
      return createElement("output", null, state.vault?.name ?? "locked");
    }

    await act(async () => root?.render(createElement(Probe)));
    await vi.waitFor(() => expect(session.state.discovered).toBe(true));
    await act(async () => session.unlock("synthetic-passphrase"));
    const opened = session.state.vault;
    expect(container.textContent).toBe("Synthetic Local Vault");

    await act(async () => requestLocalVaultLock());

    expect(container.textContent).toBe("locked");
    expect(session.state.vault).toBeNull();
    expect(opened?.rootKey).toEqual(new Uint8Array(32));
    expect(opened?.vaultKey).toEqual(new Uint8Array(32));
    expect(cleared).toEqual([opened]);
  });
});
