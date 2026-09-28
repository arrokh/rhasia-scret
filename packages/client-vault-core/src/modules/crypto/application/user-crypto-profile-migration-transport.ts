import { bytesToBase64 } from "../../../shared/application/base64";
import type { AuthenticatedTransport, CancellationPort } from "../../../shared/application/platform-ports";

export type EncryptedProfileWrapperMigration = {
  expectedCiphertext: Uint8Array;
  replacementCiphertext: Uint8Array;
};

export type UserCryptoProfileMigrationRequest = {
  wrappedUserRootKey?: EncryptedProfileWrapperMigration;
  encryptedPersonalVaultKey?: EncryptedProfileWrapperMigration;
};

export type UserCryptoProfileMigrationResult = "committed" | "already-committed" | "conflict";

/** Persists only changed profile ciphertext wrappers, replaying the exact request once after transient uncertainty. */
export async function commitUserCryptoProfileMigration(
  transport: AuthenticatedTransport,
  migration: UserCryptoProfileMigrationRequest,
  signal?: CancellationPort,
): Promise<UserCryptoProfileMigrationResult> {
  if (!migration.wrappedUserRootKey && !migration.encryptedPersonalVaultKey)
    throw new Error("User crypto profile migration has no replacement wrappers.");
  const body = JSON.stringify({
    ...(migration.wrappedUserRootKey
      ? {
          wrappedUserRootKey: {
            expectedCiphertext: bytesToBase64(migration.wrappedUserRootKey.expectedCiphertext),
            replacementCiphertext: bytesToBase64(migration.wrappedUserRootKey.replacementCiphertext),
          },
        }
      : {}),
    ...(migration.encryptedPersonalVaultKey
      ? {
          encryptedPersonalVaultKey: {
            expectedCiphertext: bytesToBase64(migration.encryptedPersonalVaultKey.expectedCiphertext),
            replacementCiphertext: bytesToBase64(migration.encryptedPersonalVaultKey.replacementCiphertext),
          },
        }
      : {}),
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response;
    try {
      response = await transport.request({
        url: "/v1/user-crypto-profile/migration",
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        cache: "no-store",
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      if (attempt === 0) continue;
      throw new Error("User crypto profile migration request failed.");
    }
    if (response.status === 204) return "committed";
    if (response.status === 409) return "conflict";
    if (response.status === 408 || response.status >= 500) {
      if (attempt === 0) continue;
      throw new Error("User crypto profile migration request failed.");
    }
    throw new Error("User crypto profile migration request failed.");
  }
  throw new Error("User crypto profile migration request failed.");
}
