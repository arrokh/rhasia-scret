export type VaultRole = "OWNER" | "VIEWER";

export function canMutateVault(role: VaultRole): boolean { return role === "OWNER"; }
