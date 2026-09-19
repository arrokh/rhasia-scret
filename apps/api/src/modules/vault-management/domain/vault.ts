export type VaultType = "PERSONAL" | "SHARED";
export type VaultLifecycle = "UNINITIALIZED" | "ACTIVE";

export class Vault {
  public constructor(
    public readonly id: string,
    public readonly type: VaultType,
    public readonly ownerId: string,
    public readonly lifecycle: VaultLifecycle = "ACTIVE",
  ) {
    if (!id || !ownerId) throw new Error("Vault identity and owner are required.");
    if (type === "SHARED" && lifecycle === "UNINITIALIZED") {
      throw new Error("Only a Personal Vault may be uninitialized.");
    }
  }

  public canBeDeletedByOwner(): boolean {
    return this.type === "SHARED";
  }

  public canHoldAccounts(): boolean {
    return this.lifecycle === "ACTIVE";
  }
}
