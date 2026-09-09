import type {
  AuthenticatedTransport,
  PlatformHttpMethod,
  PlatformHttpResponse,
} from "../../../shared/application/platform-ports";

export type HostedAuthenticatorAccountDestination = Readonly<{
  vaultId: string;
  vaultType: "PERSONAL" | "SHARED";
}>;

export type HostedAuthenticatorAccountCreated = Readonly<{ id: string; revision: number }>;

export class HostedAuthenticatorAccountTransportError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(`Hosted Authenticator Account request failed with ${status} (${code}).`);
    this.name = "HostedAuthenticatorAccountTransportError";
  }
}

export class HostedAuthenticatorAccountTransport {
  public constructor(private readonly transport: AuthenticatedTransport) {}

  public create(
    destination: HostedAuthenticatorAccountDestination,
    input: Readonly<{ encryptedPayload: string; encryptionVersion: 1; source?: "LOCAL_VAULT_COPY" }>,
  ): Promise<HostedAuthenticatorAccountCreated> {
    validateDestination(destination);
    validateCiphertext(input.encryptedPayload);
    if (input.encryptionVersion !== 1) invalidResponse();
    if (input.source !== undefined && input.source !== "LOCAL_VAULT_COPY") invalidResponse();
    return this.requestCreated(destination, "POST", {
      encryptedPayload: input.encryptedPayload,
      encryptionVersion: input.encryptionVersion,
      ...(input.source ? { source: input.source } : {}),
    });
  }

  public update(
    destination: HostedAuthenticatorAccountDestination,
    input: Readonly<{ accountId: string; expectedRevision: number; encryptedPayload: string; encryptionVersion: 1 }>,
  ): Promise<HostedAuthenticatorAccountCreated> {
    validateDestination(destination);
    validateIdentifier(input.accountId, "accountId");
    validateRevision(input.expectedRevision);
    validateCiphertext(input.encryptedPayload);
    if (input.encryptionVersion !== 1) invalidResponse();
    return this.requestCreated(destination, "PATCH", {
      accountId: input.accountId,
      expectedRevision: input.expectedRevision,
      encryptedPayload: input.encryptedPayload,
      encryptionVersion: input.encryptionVersion,
    });
  }

  public async delete(
    destination: HostedAuthenticatorAccountDestination,
    input: Readonly<{ accountId: string; expectedRevision: number }>,
  ): Promise<void> {
    validateDestination(destination);
    validateIdentifier(input.accountId, "accountId");
    validateRevision(input.expectedRevision);
    await this.requestEmpty(destination, "DELETE", {
      accountId: input.accountId,
      expectedRevision: input.expectedRevision,
    });
  }

  public async restore(
    destination: HostedAuthenticatorAccountDestination,
    input: Readonly<{ accountId: string }>,
  ): Promise<void> {
    validateDestination(destination);
    validateIdentifier(input.accountId, "accountId");
    await this.requestEmpty(destination, "PUT", { accountId: input.accountId });
  }

  private async requestCreated(
    destination: HostedAuthenticatorAccountDestination,
    method: "POST" | "PATCH",
    body: object,
  ): Promise<HostedAuthenticatorAccountCreated> {
    const response = await this.request(destination, method, body);
    if (response.status !== (method === "POST" ? 201 : 200)) throw await requestError(response);
    return parseCreatedAccount(await response.json<unknown>());
  }

  private async requestEmpty(
    destination: HostedAuthenticatorAccountDestination,
    method: "DELETE" | "PUT",
    body: object,
  ): Promise<void> {
    const response = await this.request(destination, method, body);
    if (response.status !== 204) throw await requestError(response);
  }

  private request(destination: HostedAuthenticatorAccountDestination, method: PlatformHttpMethod, body: object) {
    return this.transport.request({
      url: endpoint(destination),
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  }
}

function endpoint(destination: HostedAuthenticatorAccountDestination): string {
  const base = destination.vaultType === "PERSONAL" ? "/api/vaults" : "/api/shared-vaults";
  return `${base}/${encodeURIComponent(destination.vaultId)}/accounts`;
}

function parseCreatedAccount(value: unknown): HostedAuthenticatorAccountCreated {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== "id,revision") invalidResponse();
  if (typeof value.id !== "string") invalidResponse();
  validateIdentifier(value.id, "id");
  if (typeof value.revision !== "number") invalidResponse();
  validateRevision(value.revision);
  return { id: value.id, revision: value.revision };
}

async function requestError(response: PlatformHttpResponse): Promise<HostedAuthenticatorAccountTransportError> {
  let code = "request_failed";
  try {
    const value = await response.json<unknown>();
    if (
      isRecord(value) &&
      Object.keys(value).length === 1 &&
      typeof value.error === "string" &&
      /^[a-z][a-z0-9_]{0,63}$/.test(value.error)
    ) {
      code = value.error;
    }
  } catch {
    // A malformed failure body is normalized without exposing transport content.
  }
  return new HostedAuthenticatorAccountTransportError(response.status, code);
}

function validateDestination(destination: HostedAuthenticatorAccountDestination): void {
  validateIdentifier(destination.vaultId, "vaultId");
  if (destination.vaultType !== "PERSONAL" && destination.vaultType !== "SHARED") invalidResponse();
}

function validateIdentifier(value: string, _field: string): void {
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(value)) invalidResponse();
}

function validateRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) invalidResponse();
}

function validateCiphertext(value: string): void {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) invalidResponse();
  const byteLength = (value.length * 3) / 4 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
  if (byteLength < 13) invalidResponse();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidResponse(): never {
  throw new Error("The Hosted Authenticator Account protocol value is invalid.");
}
