import { describe, expect, it, vi } from "vitest";
import {
  LocalVaultSession,
  LocalVaultSessionDisposedError,
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
  const cleared: UnlockedLocalVault[] = [];
  const ports: LocalVaultSessionPorts = {
    isAvailable: () => true,
    readRecord: vi.fn(async () => stored),
    createRecord: vi.fn(async () => record()),
    persistCreatedRecord: vi.fn(async (next) => { stored = next; }),
    unlockRecord: vi.fn(async () => vault()),
    migrateRecord: vi.fn(async () => record()),
    refreshVault: vi.fn(async () => vault(3)),
    clearRecord: vi.fn(async () => { stored = null; }),
    clearVault: vi.fn((current) => {
      if (!current) return;
      cleared.push(current);
      current.rootKey.fill(0);
      current.vaultKey.fill(0);
      for (const account of current.accounts) account.secret.fill(0);
    }),
    isMigrationRequired: (error) => error instanceof Error && error.message === "migration",
  };
  return { cleared, ports, session: new LocalVaultSession(ports), setStored: (next: LocalVaultRecord | null) => { stored = next; } };
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
      await new Promise<void>((resolve) => { release = resolve; });
      order.push("first-end");
    });
    const second = test.session.mutate(async (owned) => { order.push(`second-${owned.name}`); });
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
