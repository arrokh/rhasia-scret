import { describe, expect, it, vi } from "vitest";
import {
  LocalVaultSession,
  LocalVaultSessionDisposedError,
  LocalVaultSessionLockedError,
  type LocalVaultRecord,
  type LocalVaultSessionPorts,
  type UnlockedLocalVault,
} from "@/modules/local-vault";

function record(profileId = "profile_1"): LocalVaultRecord {
  return {
    version: 1,
    profileId,
    createdAt: "2026-09-01T00:00:00.000Z",
    kdf: { algorithm: "ARGON2ID", memoryKiB: 65536, iterations: 3, parallelism: 1, salt: "AA==" },
    wrappedLocalRootKey: "AA==",
    encryptedLocalVaultKey: "AA==",
    encryptedVaultName: "AA==",
    accounts: [],
  };
}

function vault(value = 1): UnlockedLocalVault {
  return {
    profileId: "profile_1",
    createdAt: "2026-09-01T00:00:00.000Z",
    name: `Local ${value}`,
    rootKey: new Uint8Array(32).fill(value),
    vaultKey: new Uint8Array(32).fill(value + 1),
    accounts: [],
  };
}

function harness() {
  let stored: LocalVaultRecord | null = record();
  let archiveExportAt: string | null = null;
  let updateLockActive = false;
  const cleared: UnlockedLocalVault[] = [];
  const ports: LocalVaultSessionPorts = {
    isAvailable: () => true,
    readRecord: vi.fn(async () => stored),
    readArchiveExportAt: vi.fn(async (profileId: string) => (stored?.profileId === profileId ? archiveExportAt : null)),
    clearOrphanedArchiveExportMarker: vi.fn(async () => {
      if (!stored) archiveExportAt = null;
    }),
    trackSensitiveOperation: <Result>(operation: () => Promise<Result>) =>
      updateLockActive ? Promise.reject(new Error("PWA update is preparing.")) : operation(),
    createRecord: vi.fn(async () => record()),
    persistCreatedRecord: vi.fn(async (next) => {
      stored = next;
      archiveExportAt = null;
    }),
    unlockRecord: vi.fn(async () => vault()),
    migrateRecord: vi.fn(async () => record()),
    refreshVault: vi.fn(async () => vault(3)),
    clearRecord: vi.fn(async () => {
      stored = null;
      archiveExportAt = null;
    }),
    clearVault: vi.fn((current) => {
      if (!current) return;
      cleared.push(current);
      current.rootKey.fill(0);
      current.vaultKey.fill(0);
      for (const account of current.accounts) account.secret.fill(0);
    }),
    isMigrationRequired: (error) => error instanceof Error && error.message === "migration",
  };
  return {
    cleared,
    ports,
    session: new LocalVaultSession(ports),
    setStored: (next: LocalVaultRecord | null) => {
      stored = next;
    },
    setArchiveExportAt: (next: string | null) => {
      archiveExportAt = next;
    },
    setUpdateLockActive: (next: boolean) => {
      updateLockActive = next;
    },
  };
}

describe("LocalVaultSession", () => {
  it("owns discovery, unlock, explicit migration, and destructive clearing", async () => {
    const test = harness();
    await test.session.discover();
    expect(test.session.state).toMatchObject({ discovered: true, record: record() });
    await test.session.unlock("passphrase");
    expect(test.session.state.vault?.name).toBe("Local 1");
    await test.session.clear();
    expect(test.session.state).toMatchObject({ record: null, vault: null });
    expect(test.cleared).toHaveLength(1);
  });

  it("cleans an orphaned archive marker when no Local Profile remains", async () => {
    const test = harness();
    test.setStored(null);
    test.setArchiveExportAt("2026-10-22T12:00:00.000Z");

    await test.session.discover();

    expect(test.ports.clearOrphanedArchiveExportMarker).toHaveBeenCalledOnce();
    expect(test.session.state.lastArchiveExportAt).toBeNull();
  });

  it("refreshes the local export timestamp after a session mutation", async () => {
    const test = harness();
    await test.session.discover();
    await test.session.unlock("passphrase");

    await test.session.mutate(async () => test.setArchiveExportAt("2026-10-22T12:00:00.000Z"));

    expect(test.session.state.lastArchiveExportAt).toBe("2026-10-22T12:00:00.000Z");
  });

  it("clears a Local Vault unlock that finishes after the session is locked", async () => {
    const test = harness();
    await test.session.discover();
    let finishUnlock: ((value: UnlockedLocalVault) => void) | undefined;
    const pendingVault = vault(9);
    vi.mocked(test.ports.unlockRecord).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUnlock = resolve;
        }),
    );

    const unlocking = test.session.unlock("passphrase");
    await vi.waitFor(() => expect(finishUnlock).toBeDefined());
    test.session.lock();
    finishUnlock?.(pendingVault);

    await expect(unlocking).rejects.toBeInstanceOf(LocalVaultSessionLockedError);
    expect(test.session.state.vault).toBeNull();
    expect(pendingVault.rootKey).toEqual(new Uint8Array(32));
    expect(pendingVault.vaultKey).toEqual(new Uint8Array(32));
  });

  it("does not start an unlock queued before a lock", async () => {
    const test = harness();
    await test.session.discover();
    await test.session.unlock("passphrase");
    const unlockedVault = test.session.state.vault;
    let startMutation: (() => void) | undefined;
    let finishMutation: (() => void) | undefined;
    const mutationStarted = new Promise<void>((resolve) => {
      startMutation = resolve;
    });
    const pendingMutation = new Promise<void>((resolve) => {
      finishMutation = resolve;
    });
    const mutation = test.session.mutate(async () => {
      startMutation?.();
      await pendingMutation;
    });
    await mutationStarted;
    const queuedUnlock = test.session.unlock("passphrase");

    test.session.lock();
    finishMutation?.();

    await expect(mutation).rejects.toBeInstanceOf(LocalVaultSessionLockedError);
    await expect(queuedUnlock).rejects.toBeInstanceOf(LocalVaultSessionLockedError);
    expect(test.ports.unlockRecord).toHaveBeenCalledOnce();
    expect(test.session.state.vault).toBeNull();
    expect(unlockedVault?.rootKey).toEqual(new Uint8Array(32));
    expect(unlockedVault?.vaultKey).toEqual(new Uint8Array(32));
  });

  it("runs a sensitive workflow after a queued Local Vault mutation", async () => {
    const test = harness();
    await test.session.discover();
    await test.session.unlock("passphrase");
    await test.session.mutate(async (current) => {
      current.name = "Updated local vault";
    });

    await expect(test.session.performSensitiveWorkflow(async (current) => current.name)).resolves.toBe(
      "Updated local vault",
    );
  });

  it("clears archive results when a sensitive workflow finishes after lock", async () => {
    const test = harness();
    await test.session.discover();
    await test.session.unlock("passphrase");
    const archive = Uint8Array.of(7, 8, 9);
    const key = Uint8Array.of(4, 5, 6);
    let startWorkflow: (() => void) | undefined;
    let finishWorkflow: ((result: { archive: Uint8Array; key: Uint8Array }) => void) | undefined;
    const workflowStarted = new Promise<void>((resolve) => {
      startWorkflow = resolve;
    });
    const workflowResult = new Promise<{ archive: Uint8Array; key: Uint8Array }>((resolve) => {
      finishWorkflow = resolve;
    });
    const workflow = test.session.performSensitiveWorkflow(
      async () => {
        startWorkflow?.();
        return workflowResult;
      },
      (result) => {
        result.archive.fill(0);
        result.key.fill(0);
      },
    );
    await workflowStarted;

    test.session.lock();
    finishWorkflow?.({ archive, key });

    await expect(workflow).rejects.toBeInstanceOf(LocalVaultSessionLockedError);
    expect(archive).toEqual(new Uint8Array(3));
    expect(key).toEqual(new Uint8Array(3));
  });

  it("does not start an unlock while a PWA update is preparing", async () => {
    const test = harness();
    await test.session.discover();
    test.setUpdateLockActive(true);

    await expect(test.session.unlock("passphrase")).rejects.toThrow("PWA update is preparing.");
    expect(test.ports.unlockRecord).not.toHaveBeenCalled();
  });

  it("creates, persists, and unlocks through one session transition", async () => {
    const test = harness();
    test.setStored(null);
    await test.session.discover();
    await test.session.create("passphrase", "Local");
    expect(test.ports.persistCreatedRecord).toHaveBeenCalledOnce();
    expect(test.session.state).toMatchObject({ discovered: true, record: record(), vault: { name: "Local 1" } });
  });

  it("publishes the migration transition and replaces it after migration", async () => {
    const test = harness();
    vi.mocked(test.ports.unlockRecord).mockRejectedValueOnce(new Error("migration"));
    await test.session.discover();
    await expect(test.session.unlock("passphrase")).rejects.toThrow("migration");
    expect(test.session.state.migrationRequired).toBe(true);
    await test.session.migrate("passphrase");
    expect(test.session.state).toMatchObject({ migrationRequired: false, vault: { name: "Local 1" } });
  });

  it("clears superseded material on refresh, lock, and teardown", async () => {
    const test = harness();
    await test.session.discover();
    await test.session.unlock("passphrase");
    const first = test.session.state.vault!;
    await test.session.refresh();
    expect(first.rootKey).toEqual(new Uint8Array(32));
    const refreshed = test.session.state.vault!;
    test.session.lock();
    expect(refreshed.vaultKey).toEqual(new Uint8Array(32));

    await test.session.unlock("passphrase");
    const final = test.session.state.vault!;
    test.session.dispose();
    expect(final.rootKey).toEqual(new Uint8Array(32));
    await expect(test.session.discover()).rejects.toBeInstanceOf(LocalVaultSessionDisposedError);
  });

  it("clears unlocked material when initial persistence fails", async () => {
    const test = harness();
    vi.mocked(test.ports.persistCreatedRecord).mockRejectedValueOnce(new Error("storage"));
    await expect(test.session.create("passphrase", "Local")).rejects.toThrow("storage");
    expect(test.session.state.vault).toBeNull();
    expect(test.cleared).toHaveLength(1);
    expect(test.cleared[0]?.rootKey).toEqual(new Uint8Array(32));
  });

  it("does not replace the current value when crypto refresh fails", async () => {
    const test = harness();
    await test.session.discover();
    await test.session.unlock("passphrase");
    const current = test.session.state.vault;
    vi.mocked(test.ports.refreshVault).mockRejectedValueOnce(new Error("crypto"));
    await expect(test.session.refresh()).rejects.toThrow("crypto");
    expect(test.session.state.vault).toBe(current);
  });

  it("fails closed when storage disappears after a refresh", async () => {
    const test = harness();
    await test.session.discover();
    await test.session.unlock("passphrase");
    test.setStored(null);
    await expect(test.session.refresh()).rejects.toThrow("unavailable");
    expect(test.session.state.vault).toBeNull();
    expect(test.cleared.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the session locked when initial crypto fails", async () => {
    const test = harness();
    await test.session.discover();
    vi.mocked(test.ports.unlockRecord).mockRejectedValueOnce(new Error("crypto"));
    await expect(test.session.unlock("passphrase")).rejects.toThrow("crypto");
    expect(test.session.state.vault).toBeNull();
    expect(test.session.state.migrationRequired).toBe(false);
  });

  it("serializes state-changing operations and gives each operation the owned value", async () => {
    const test = harness();
    await test.session.discover();
    await test.session.unlock("passphrase");
    const order: string[] = [];
    let release: (() => void) | undefined;
    const first = test.session.mutate(async () => {
      order.push("first-start");
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      order.push("first-end");
    });
    const second = test.session.mutate(async (owned) => {
      order.push(`second-${owned.name}`);
    });
    await vi.waitFor(() => expect(order).toEqual(["first-start"]));
    release?.();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-Local 1"]);
  });

  it("keeps each consuming surface independently scoped", async () => {
    const left = harness();
    const right = harness();
    await Promise.all([left.session.discover(), right.session.discover()]);
    await Promise.all([left.session.unlock("passphrase"), right.session.unlock("passphrase")]);
    left.session.lock();
    expect(left.session.state.vault).toBeNull();
    expect(right.session.state.vault?.name).toBe("Local 1");
  });
});
