export class EncryptedAuthenticatorAccount {
  public constructor(
    public readonly id: string,
    public readonly vaultId: string,
    public readonly encryptedPayload: Uint8Array,
    public readonly encryptionVersion: number,
    public readonly revision: number,
  ) {
    if (!id || !vaultId || !encryptedPayload.length)
      throw new Error("Encrypted account identity and payload are required.");
    if (!Number.isInteger(encryptionVersion) || encryptionVersion < 1)
      throw new Error("An encryption version is required.");
    if (!Number.isInteger(revision) || revision < 1) throw new Error("Account revision must be positive.");
  }
}
