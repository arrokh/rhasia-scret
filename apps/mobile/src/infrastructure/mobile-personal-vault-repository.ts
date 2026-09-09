import type { AuthenticatedTransport } from "@rhasia-scret/client-vault-core";
import { base64ToBytes, bytesToBase64 } from "@rhasia-scret/client-vault-core";
import type { PersonalVaultInitializationMaterial } from "@rhasia-scret/client-vault-core";
import type { EncryptedPersonalVaultProfile } from "@rhasia-scret/client-vault-core";

export type MobilePersonalVault = {
  id: string;
  lifecycle: "UNINITIALIZED" | "ACTIVE";
};

export class MobilePersonalVaultRepository {
  public constructor(private readonly transport: AuthenticatedTransport) {}

  public async load(): Promise<MobilePersonalVault> {
    const response = await this.transport.request({ url: "/api/personal-vault", method: "GET", cache: "no-store" });
    if (!response.ok) throw new MobilePersonalVaultRepositoryError(classifyStatus(response.status));
    const body = await response.json<unknown>();
    if (!isPersonalVault(body)) throw new MobilePersonalVaultRepositoryError("invalid_response");
    return body;
  }

  public async loadCryptoProfile(): Promise<EncryptedPersonalVaultProfile> {
    const response = await this.transport.request({
      url: "/api/user-crypto-profile",
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) throw new MobilePersonalVaultRepositoryError(classifyStatus(response.status));
    const body = await response.json<unknown>();
    if (!isCryptoProfile(body)) throw new MobilePersonalVaultRepositoryError("invalid_response");
    try {
      const profile = {
        vaultUnlockSalt: base64ToBytes(body.vaultUnlockSalt),
        wrappedUserRootKey: base64ToBytes(body.wrappedUserRootKey),
        encryptedPersonalVaultKey: base64ToBytes(body.encryptedPersonalVaultKey),
        encryptionVersion: body.encryptionVersion,
      };
      if (
        profile.vaultUnlockSalt.length !== 16 ||
        profile.wrappedUserRootKey.length < 30 ||
        profile.encryptedPersonalVaultKey.length < 30
      ) {
        throw new Error("Invalid profile material.");
      }
      return profile;
    } catch {
      throw new MobilePersonalVaultRepositoryError("invalid_response");
    }
  }

  public async initialize(material: PersonalVaultInitializationMaterial): Promise<void> {
    const response = await this.transport.request({
      url: "/api/personal-vault/initialize",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vaultUnlockSalt: bytesToBase64(material.vaultUnlockSalt),
        wrappedUserRootKey: bytesToBase64(material.wrappedUserRootKey),
        encryptedPersonalVaultKey: bytesToBase64(material.encryptedPersonalVaultKey),
        encryptedVaultName: bytesToBase64(material.encryptedVaultName),
        encryptionVersion: material.encryptionVersion,
      }),
    });
    if (!response.ok) throw new MobilePersonalVaultRepositoryError(classifyStatus(response.status));
  }
}

export type MobilePersonalVaultRepositoryErrorCode =
  "unauthenticated" | "inactive" | "rate_limited" | "conflict" | "invalid_request" | "invalid_response" | "unavailable";

export class MobilePersonalVaultRepositoryError extends Error {
  public constructor(public readonly code: MobilePersonalVaultRepositoryErrorCode) {
    super(`Mobile Personal Vault request failed: ${code}.`);
    this.name = "MobilePersonalVaultRepositoryError";
  }
}

function isPersonalVault(value: unknown): value is MobilePersonalVault {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    record.id.length > 0 &&
    (record.lifecycle === "UNINITIALIZED" || record.lifecycle === "ACTIVE")
  );
}

function isCryptoProfile(value: unknown): value is {
  vaultUnlockSalt: string;
  wrappedUserRootKey: string;
  encryptedPersonalVaultKey: string;
  encryptionVersion: 1;
} {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.vaultUnlockSalt === "string" &&
    typeof record.wrappedUserRootKey === "string" &&
    typeof record.encryptedPersonalVaultKey === "string" &&
    record.encryptionVersion === 1
  );
}

function classifyStatus(status: number): MobilePersonalVaultRepositoryErrorCode {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "inactive";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 400) return "invalid_request";
  return "unavailable";
}
