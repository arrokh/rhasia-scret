import type { LocalVaultRecord } from "../domain/local-vault-record";

export interface LocalVaultRepository {
  create(record: LocalVaultRecord): Promise<void>;
  read(): Promise<LocalVaultRecord | null>;
  replace(record: LocalVaultRecord): Promise<void>;
  clear(): Promise<void>;
}
