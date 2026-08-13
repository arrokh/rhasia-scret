export class UnlockedVaultSession {
  private readonly userRootKeys = new Map<string, Uint8Array>();

  public unlock(vaultId: string, userRootKey: Uint8Array): void {
    if (!vaultId || userRootKey.length !== 32) throw new Error("A Vault and User Root Key are required.");
    this.lock(vaultId);
    this.userRootKeys.set(vaultId, copyBytes(userRootKey));
  }

  public getUserRootKey(vaultId: string): Uint8Array | null {
    const key = this.userRootKeys.get(vaultId);
    return key ? copyBytes(key) : null;
  }

  public isUnlocked(vaultId: string): boolean {
    return this.userRootKeys.has(vaultId);
  }

  public lock(vaultId: string): void {
    const key = this.userRootKeys.get(vaultId);
    if (key) key.fill(0);
    this.userRootKeys.delete(vaultId);
  }

  public logout(): void {
    for (const vaultId of this.userRootKeys.keys()) this.lock(vaultId);
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
