import type { LocalVaultRecord } from "../domain/local-vault-record";
import type { UnlockedLocalVault } from "./local-vault-workflow";

export type LocalVaultSessionState = {
  available: boolean;
  discovered: boolean;
  migrationRequired: boolean;
  record: LocalVaultRecord | null;
  vault: UnlockedLocalVault | null;
};

export type LocalVaultSessionPorts = {
  isAvailable(): boolean;
  readRecord(): Promise<LocalVaultRecord | null>;
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

/** Direct client-only owner for one surface's decrypted Local Vault state. */
export class LocalVaultSession {
  private current: LocalVaultSessionState = {
    available: true,
    discovered: false,
    migrationRequired: false,
    record: null,
    vault: null,
  };
  private disposed = false;
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
      this.commit({ ...this.current, available, discovered: true, record });
    });
  }

  public create(passphrase: string, name: string): Promise<void> {
    return this.enqueue(async () => {
      const record = await this.ports.createRecord(passphrase, name);
      const vault = await this.ports.unlockRecord(record, passphrase);
      try {
        await this.ports.persistCreatedRecord(record);
      } catch (error) {
        this.ports.clearVault(vault);
        throw error;
      }
      this.replaceVault(vault);
      this.commit({ ...this.current, discovered: true, migrationRequired: false, record, vault });
    });
  }

  public unlock(passphrase: string): Promise<void> {
    return this.enqueue(async () => {
      const record = this.current.record ?? await this.ports.readRecord();
      if (!record) throw new Error("The Local Profile does not exist.");
      try {
        const vault = await this.ports.unlockRecord(record, passphrase);
        this.replaceVault(vault);
        this.commit({ ...this.current, discovered: true, migrationRequired: false, record, vault });
      } catch (error) {
        this.commit({ ...this.current, discovered: true, migrationRequired: this.ports.isMigrationRequired(error), record });
        throw error;
      }
    });
  }

  public migrate(passphrase: string): Promise<void> {
    return this.enqueue(async () => {
      let record: LocalVaultRecord | null = null;
      try {
        record = await this.ports.migrateRecord(passphrase);
        const vault = await this.ports.unlockRecord(record, passphrase);
        this.replaceVault(vault);
        this.commit({ ...this.current, discovered: true, migrationRequired: false, record, vault });
      } catch (error) {
        const stored = await this.ports.readRecord().catch(() => record ?? this.current.record);
        this.commit({ ...this.current, discovered: true, record: stored });
        throw error;
      }
    });
  }

  public refresh(): Promise<void> {
    return this.enqueue(async () => {
      const source = this.requireVault();
      const refreshed = await this.ports.refreshVault(source);
      const record = await this.ports.readRecord();
      this.replaceVault(refreshed);
      this.commit({ ...this.current, record, vault: refreshed });
    });
  }

  public mutate<Result>(operation: (vault: UnlockedLocalVault) => Promise<Result>): Promise<Result> {
    return this.enqueue(async () => {
      const result = await operation(this.requireVault());
      try {
        const record = await this.ports.readRecord();
        this.commit({ ...this.current, record });
      } catch (error) {
        this.commit({ ...this.current });
        throw error;
      }
      return result;
    });
  }

  public clear(): Promise<void> {
    return this.enqueue(async () => {
      await this.ports.clearRecord();
      this.clearCurrentVault();
      this.commit({ ...this.current, discovered: true, migrationRequired: false, record: null, vault: null });
    });
  }

  public lock(): void {
    if (this.disposed) return;
    this.clearCurrentVault();
    this.commit({ ...this.current, migrationRequired: false, vault: null });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearCurrentVault();
    this.listeners.clear();
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.serialized.then(async () => {
      if (this.disposed) throw new LocalVaultSessionDisposedError();
      return operation();
    });
    this.serialized = result.then(() => undefined, () => undefined);
    return result;
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
