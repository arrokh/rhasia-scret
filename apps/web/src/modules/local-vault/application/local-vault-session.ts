import type { LocalVaultRecord } from "../domain/local-vault-record";
import type { UnlockedLocalVault } from "./local-vault-workflow";

export type LocalVaultSessionState = {
  available: boolean;
  discovered: boolean;
  migrationRequired: boolean;
  record: LocalVaultRecord | null;
  /** `undefined` means the persisted export marker could not be read. */
  lastArchiveExportAt: string | null | undefined;
  vault: UnlockedLocalVault | null;
};

export type LocalVaultSessionPorts = {
  isAvailable(): boolean;
  readRecord(): Promise<LocalVaultRecord | null>;
  readArchiveExportAt(profileId: string): Promise<string | null>;
  clearOrphanedArchiveExportMarker(): Promise<void>;
  trackSensitiveOperation<Result>(
    operation: () => Promise<Result>,
    clearStaleResult?: (result: Result) => void,
  ): Promise<Result>;
  createRecord(passphrase: string, name: string): Promise<LocalVaultRecord>;
  persistCreatedRecord(record: LocalVaultRecord): Promise<void>;
  unlockRecord(record: LocalVaultRecord, passphrase: string): Promise<UnlockedLocalVault>;
  migrateRecord(passphrase: string): Promise<LocalVaultRecord>;
  refreshVault(vault: UnlockedLocalVault): Promise<UnlockedLocalVault>;
  clearRecord(): Promise<void>;
  clearVault(vault: UnlockedLocalVault | null): void;
  isMigrationRequired(error: unknown): boolean;
};

export class LocalVaultSessionDisposedError extends Error {
  public constructor() {
    super("The Local Vault session has been disposed.");
    this.name = "LocalVaultSessionDisposedError";
  }
}

export class LocalVaultSessionLockedError extends Error {
  public constructor() {
    super("The Local Vault session was locked before the operation completed.");
    this.name = "LocalVaultSessionLockedError";
  }
}

/** Direct client-only owner for one surface's decrypted Local Vault state. */
export class LocalVaultSession {
  private current: LocalVaultSessionState = {
    available: true,
    discovered: false,
    migrationRequired: false,
    record: null,
    lastArchiveExportAt: null,
    vault: null,
  };
  private disposed = false;
  private lockGeneration = 0;
  private serialized: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(state: LocalVaultSessionState) => void>();

  public constructor(private readonly ports: LocalVaultSessionPorts) {}

  public get state(): LocalVaultSessionState {
    return this.current;
  }

  public subscribe(listener: (state: LocalVaultSessionState) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  public discover(): Promise<void> {
    return this.enqueue(async () => {
      const available = this.ports.isAvailable();
      const record = available ? await this.ports.readRecord() : null;
      if (available && !record) await this.ports.clearOrphanedArchiveExportMarker();
      const lastArchiveExportAt = record ? await this.readArchiveExportAt(record.profileId) : null;
      this.commit({ ...this.current, available, discovered: true, record, lastArchiveExportAt });
    });
  }

  public create(passphrase: string, name: string): Promise<void> {
    return this.runSensitiveOperation((generation) =>
      this.enqueue(async () => {
        this.assertOperationAllowed(generation);
        const record = await this.ports.createRecord(passphrase, name);
        this.assertOperationAllowed(generation);
        const vault = await this.ports.unlockRecord(record, passphrase);
        if (!this.isOperationAllowed(generation)) {
          this.ports.clearVault(vault);
          throw new LocalVaultSessionLockedError();
        }
        try {
          await this.ports.persistCreatedRecord(record);
        } catch (error) {
          this.ports.clearVault(vault);
          throw error;
        }
        if (!this.isOperationAllowed(generation)) {
          this.ports.clearVault(vault);
          this.commit({
            ...this.current,
            discovered: true,
            migrationRequired: false,
            record,
            lastArchiveExportAt: null,
            vault: null,
          });
          throw new LocalVaultSessionLockedError();
        }
        this.replaceVault(vault);
        this.commit({
          ...this.current,
          discovered: true,
          migrationRequired: false,
          record,
          lastArchiveExportAt: null,
          vault,
        });
      }),
    );
  }

  public unlock(passphrase: string): Promise<void> {
    return this.runSensitiveOperation((generation) =>
      this.enqueue(async () => {
        this.assertOperationAllowed(generation);
        const record = await this.ports.readRecord();
        this.assertOperationAllowed(generation);
        if (!record) {
          this.commit({
            ...this.current,
            discovered: true,
            migrationRequired: false,
            record: null,
            lastArchiveExportAt: null,
            vault: null,
          });
          throw new Error("The Local Profile does not exist.");
        }
        try {
          const vault = await this.ports.unlockRecord(record, passphrase);
          if (!this.isOperationAllowed(generation)) {
            this.ports.clearVault(vault);
            throw new LocalVaultSessionLockedError();
          }
          const lastArchiveExportAt = await this.readArchiveExportAt(record.profileId);
          if (!this.isOperationAllowed(generation)) {
            this.ports.clearVault(vault);
            throw new LocalVaultSessionLockedError();
          }
          this.replaceVault(vault);
          this.commit({
            ...this.current,
            discovered: true,
            migrationRequired: false,
            record,
            lastArchiveExportAt,
            vault,
          });
        } catch (error) {
          this.commit({
            ...this.current,
            discovered: true,
            migrationRequired: this.ports.isMigrationRequired(error),
            record,
          });
          throw error;
        }
      }),
    );
  }

  public migrate(passphrase: string): Promise<void> {
    return this.runSensitiveOperation((generation) =>
      this.enqueue(async () => {
        this.assertOperationAllowed(generation);
        let record: LocalVaultRecord | null = null;
        try {
          record = await this.ports.migrateRecord(passphrase);
          this.assertOperationAllowed(generation);
          const vault = await this.ports.unlockRecord(record, passphrase);
          if (!this.isOperationAllowed(generation)) {
            this.ports.clearVault(vault);
            throw new LocalVaultSessionLockedError();
          }
          const lastArchiveExportAt = await this.readArchiveExportAt(record.profileId);
          if (!this.isOperationAllowed(generation)) {
            this.ports.clearVault(vault);
            throw new LocalVaultSessionLockedError();
          }
          this.replaceVault(vault);
          this.commit({
            ...this.current,
            discovered: true,
            migrationRequired: false,
            record,
            lastArchiveExportAt,
            vault,
          });
        } catch (error) {
          const stored = await this.ports.readRecord().catch(() => record ?? this.current.record);
          this.commit({ ...this.current, discovered: true, record: stored });
          throw error;
        }
      }),
    );
  }

  public refresh(): Promise<void> {
    return this.runSensitiveOperation((generation) =>
      this.enqueue(async () => {
        this.assertOperationAllowed(generation);
        const source = this.requireVault();
        const refreshed = await this.ports.refreshVault(source);
        if (!this.isOperationAllowed(generation)) {
          this.ports.clearVault(refreshed);
          this.ports.clearVault(source);
          throw new LocalVaultSessionLockedError();
        }
        try {
          const record = await this.ports.readRecord();
          if (!record) {
            this.ports.clearVault(refreshed);
            this.lock();
            throw new Error("The Local Profile is unavailable.");
          }
          const lastArchiveExportAt = await this.readArchiveExportAt(record.profileId);
          if (!this.isOperationAllowed(generation)) throw new LocalVaultSessionLockedError();
          this.replaceVault(refreshed);
          this.commit({ ...this.current, record, lastArchiveExportAt, vault: refreshed });
        } catch (error) {
          if (!this.isOperationAllowed(generation)) {
            this.ports.clearVault(refreshed);
            this.ports.clearVault(source);
          }
          throw error;
        }
      }),
    );
  }

  public mutate<Result>(operation: (vault: UnlockedLocalVault) => Promise<Result>): Promise<Result> {
    return this.runSensitiveOperation((generation) =>
      this.enqueue(async () => {
        this.assertOperationAllowed(generation);
        const vault = this.requireVault();
        let result: Result;
        try {
          result = await operation(vault);
          if (!this.isOperationAllowed(generation)) {
            this.ports.clearVault(vault);
            throw new LocalVaultSessionLockedError();
          }
        } catch (error) {
          if (!this.isOperationAllowed(generation)) this.ports.clearVault(vault);
          throw error;
        }
        try {
          const record = await this.ports.readRecord();
          if (!record) {
            this.lock();
            throw new Error("The Local Profile is unavailable.");
          }
          const lastArchiveExportAt = await this.readArchiveExportAt(record.profileId);
          if (!this.isOperationAllowed(generation)) {
            this.ports.clearVault(vault);
            throw new LocalVaultSessionLockedError();
          }
          this.commit({ ...this.current, record, lastArchiveExportAt });
        } catch (error) {
          if (!this.isOperationAllowed(generation)) this.ports.clearVault(vault);
          this.commit({ ...this.current });
          throw error;
        }
        return result;
      }),
    );
  }

  public performSensitiveWorkflow<Result>(
    operation: (vault: UnlockedLocalVault) => Promise<Result>,
    clearStaleResult?: (result: Result) => void,
  ): Promise<Result> {
    if (!this.current.vault) return Promise.reject(new LocalVaultSessionLockedError());
    return this.runSensitiveOperation(
      (generation) =>
        this.enqueue(async () => {
          this.assertOperationAllowed(generation);
          const vault = this.requireVault();
          let result: Result;
          try {
            result = await operation(vault);
          } catch (error) {
            if (!this.isOperationAllowed(generation)) throw new LocalVaultSessionLockedError();
            throw error;
          }
          if (!this.isOperationAllowed(generation)) {
            clearStaleResult?.(result);
            throw new LocalVaultSessionLockedError();
          }
          return result;
        }),
      clearStaleResult,
    );
  }

  public clear(): Promise<void> {
    return this.runSensitiveOperation((generation) =>
      this.enqueue(async () => {
        this.assertOperationAllowed(generation);
        await this.ports.clearRecord();
        if (!this.isOperationAllowed(generation)) {
          this.clearCurrentVault();
          this.commit({
            ...this.current,
            discovered: true,
            migrationRequired: false,
            record: null,
            lastArchiveExportAt: null,
            vault: null,
          });
          throw new LocalVaultSessionLockedError();
        }
        this.clearCurrentVault();
        this.commit({
          ...this.current,
          discovered: true,
          migrationRequired: false,
          record: null,
          lastArchiveExportAt: null,
          vault: null,
        });
      }),
    );
  }

  public lock(): void {
    if (this.disposed) return;
    this.lockGeneration += 1;
    this.clearCurrentVault();
    this.commit({ ...this.current, migrationRequired: false, vault: null });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lockGeneration += 1;
    this.clearCurrentVault();
    this.listeners.clear();
  }

  private runSensitiveOperation<Result>(
    operation: (generation: number) => Promise<Result>,
    clearStaleResult?: (result: Result) => void,
  ): Promise<Result> {
    const generation = this.lockGeneration;
    return this.ports.trackSensitiveOperation(() => operation(generation), clearStaleResult);
  }

  private isOperationAllowed(generation: number): boolean {
    return generation === this.lockGeneration;
  }

  private assertOperationAllowed(generation: number): void {
    if (this.disposed) throw new LocalVaultSessionDisposedError();
    if (!this.isOperationAllowed(generation)) throw new LocalVaultSessionLockedError();
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.serialized.then(async () => {
      if (this.disposed) throw new LocalVaultSessionDisposedError();
      return operation();
    });
    this.serialized = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private readArchiveExportAt(profileId: string): Promise<string | null | undefined> {
    return this.ports.readArchiveExportAt(profileId).catch(() => undefined);
  }

  private requireVault(): UnlockedLocalVault {
    if (!this.current.vault) throw new Error("The Local Vault is locked.");
    return this.current.vault;
  }

  private replaceVault(next: UnlockedLocalVault): void {
    if (this.disposed) {
      this.ports.clearVault(next);
      throw new LocalVaultSessionDisposedError();
    }
    const previous = this.current.vault;
    if (previous && previous !== next) this.ports.clearVault(previous);
  }

  private clearCurrentVault(): void {
    this.ports.clearVault(this.current.vault);
    this.current = { ...this.current, vault: null };
  }

  private commit(state: LocalVaultSessionState): void {
    if (this.disposed) {
      if (state.vault && state.vault !== this.current.vault) this.ports.clearVault(state.vault);
      throw new LocalVaultSessionDisposedError();
    }
    this.current = state;
    for (const listener of this.listeners) listener(state);
  }
}
