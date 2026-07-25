import type { Vault } from "../domain/vault";

export interface PersonalVaultRepository {
  ensureForOwner(ownerId: string): Promise<Vault>;
}
