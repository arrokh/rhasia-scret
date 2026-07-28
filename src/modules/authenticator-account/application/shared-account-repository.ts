import type { EncryptedAuthenticatorAccount } from "../domain/encrypted-account";

export type SharedAccountMutationResult<T> =
  | { status: "SUCCESS"; value: T }
  | { status: "VAULT_UNAVAILABLE" }
  | { status: "PERMISSION_DENIED" }
  | { status: "STALE_REVISION" }
  | { status: "ACCOUNT_UNAVAILABLE" };

export interface SharedAccountRepository {
  create(
    actorUserId: string,
    vaultId: string,
    encryptedPayload: Uint8Array,
    encryptionVersion: number
  ): Promise<SharedAccountMutationResult<EncryptedAuthenticatorAccount>>;

  update(
    actorUserId: string,
    vaultId: string,
    accountId: string,
    expectedRevision: number,
    encryptedPayload: Uint8Array,
    encryptionVersion: number
  ): Promise<SharedAccountMutationResult<EncryptedAuthenticatorAccount>>;

  delete(
    actorUserId: string,
    vaultId: string,
    accountId: string,
    expectedRevision: number
  ): Promise<SharedAccountMutationResult<undefined>>;

  restore(
    actorUserId: string,
    vaultId: string,
    accountId: string
  ): Promise<SharedAccountMutationResult<undefined>>;
}
