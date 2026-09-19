import type { Vault } from "../domain/vault";
import type { PersonalVaultRepository } from "./personal-vault-repository";

export function ensurePersonalVault(ownerId: string, vaults: PersonalVaultRepository): Promise<Vault> {
  if (!ownerId) throw new Error("An application user is required to create a Personal Vault.");
  return vaults.ensureForOwner(ownerId);
}
