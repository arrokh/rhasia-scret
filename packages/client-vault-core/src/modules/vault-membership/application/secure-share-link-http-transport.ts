import type { AuthenticatedTransport, PlatformHttpResponse } from "../../../shared/application/platform-ports";
import type { SecureShareLinkLookup, SecureShareLinkTransportPort } from "./secure-share-link-workflow-ports";

export type CreatedSecureShareLink = Readonly<{ id: string; expiresAt: string }>;

export class SecureShareLinkHttpTransportError extends Error {
  public constructor(public readonly status: number, public readonly code: string) {
    super(`Secure Share Link request failed with ${status} (${code}).`);
    this.name = "SecureShareLinkHttpTransportError";
  }
}

export class SecureShareLinkHttpTransport implements SecureShareLinkTransportPort {
  public constructor(private readonly transport: AuthenticatedTransport) {}

  public async create(
    vaultId: string,
    request: Readonly<{ recipientEmail: string; linkVerifier: string; encryptedPackage: string }>
  ): Promise<CreatedSecureShareLink> {
    validateIdentifier(vaultId);
    validateVerifier(request.linkVerifier);
    validateCiphertext(request.encryptedPackage);
    const response = await this.transport.request({
      url: `/api/shared-vaults/${encodeURIComponent(vaultId)}/share-links`,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, recipientEmail: normalizeEmail(request.recipientEmail) }),
      cache: "no-store"
    });
    if (response.status !== 201) throw await requestError(response);
    return parseCreated(await response.json<unknown>());
  }

  public async lookup(verifier: string): Promise<SecureShareLinkLookup> {
    validateVerifier(verifier);
    const response = await this.transport.request({
      url: `/api/secure-share-links?verifier=${encodeURIComponent(verifier)}`,
      method: "GET",
      cache: "no-store"
    });
    if (response.status !== 200) throw await requestError(response);
    return parseLookup(await response.json<unknown>());
  }

  public async redeem(request: Readonly<{ invitationId: string; encryptedVaultKey: string; keyVersion: 1 }>): Promise<void> {
    validateIdentifier(request.invitationId);
    validateCiphertext(request.encryptedVaultKey);
    const response = await this.transport.request({
      url: "/api/secure-share-links",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      cache: "no-store"
    });
    if (response.status !== 204) throw await requestError(response);
  }

  public async cancel(vaultId: string, invitationId: string): Promise<void> {
    validateIdentifier(vaultId);
    validateIdentifier(invitationId);
    const response = await this.transport.request({
      url: `/api/shared-vaults/${encodeURIComponent(vaultId)}/share-links/${encodeURIComponent(invitationId)}`,
      method: "DELETE",
      cache: "no-store"
    });
    if (response.status !== 204) throw await requestError(response);
  }
}

function parseCreated(value: unknown): CreatedSecureShareLink {
  if (!isExactRecord(value, ["expiresAt", "id"])) invalidResponse();
  if (typeof value.id !== "string" || typeof value.expiresAt !== "string") invalidResponse();
  validateIdentifier(value.id);
  if (!Number.isFinite(Date.parse(value.expiresAt))) invalidResponse();
  return { id: value.id, expiresAt: value.expiresAt };
}

function parseLookup(value: unknown): SecureShareLinkLookup {
  if (!isExactRecord(value, ["encryptedPackage", "id", "vaultId"])) invalidResponse();
  if (typeof value.id !== "string" || typeof value.vaultId !== "string" || typeof value.encryptedPackage !== "string") invalidResponse();
  validateIdentifier(value.id);
  validateIdentifier(value.vaultId);
  validateCiphertext(value.encryptedPackage);
  return { id: value.id, vaultId: value.vaultId, encryptedPackage: value.encryptedPackage };
}

async function requestError(response: PlatformHttpResponse): Promise<SecureShareLinkHttpTransportError> {
  let code = "request_failed";
  try {
    const value = await response.json<unknown>();
    if (isExactRecord(value, ["error"]) && typeof value.error === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value.error)) code = value.error;
  } catch {
    // Normalize malformed failure bodies without retaining their contents.
  }
  return new SecureShareLinkHttpTransportError(response.status, code);
}

function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 320) invalidResponse();
  return normalized;
}

function validateIdentifier(value: string): void {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(value)) invalidResponse();
}

function validateVerifier(value: string): void {
  if (!isBase64(value) || base64ByteLength(value) !== 32) invalidResponse();
}

function validateCiphertext(value: string): void {
  if (!isBase64(value) || base64ByteLength(value) < 13) invalidResponse();
}

function isBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0;
}

function base64ByteLength(value: string): number {
  return (value.length * 3) / 4 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
}

function isExactRecord(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function invalidResponse(): never {
  throw new Error("The Secure Share Link HTTP protocol value is invalid.");
}
