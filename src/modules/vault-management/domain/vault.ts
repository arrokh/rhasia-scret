export type VaultType = "PERSONAL" | "SHARED";

export class Vault {
  public constructor(
    public readonly id: string,
    public readonly type: VaultType,
    public readonly ownerId: string
  ) {
    if (!id || !ownerId) throw new Error("Vault identity and owner are required.");
  }

  public canBeDeletedByOwner(): boolean {
    return this.type === "SHARED";
  }
}
