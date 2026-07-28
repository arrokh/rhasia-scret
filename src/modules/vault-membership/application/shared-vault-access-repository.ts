import type { EffectiveSharedVaultAccountPermissions } from "../domain/shared-vault-account-permissions";

export type SharedVaultAccess = {
  vaultId: string;
  role: "OWNER" | "VIEWER";
  effectiveAccountPermissions: EffectiveSharedVaultAccountPermissions;
  encryptedName: Uint8Array;
  encryptionVersion: number;
  encryptedVaultKey: Uint8Array;
  keyVersion: number;
  accounts: Array<{ id: string; encryptedPayload: Uint8Array; encryptionVersion: number; revision: number }>;
};

export interface SharedVaultAccessRepository {
  getForMember(userId: string, vaultId: string): Promise<SharedVaultAccess | null>;
  listForMember(userId: string): Promise<SharedVaultAccess[]>;
}
