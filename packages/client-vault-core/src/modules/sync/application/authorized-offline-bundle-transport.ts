import type { AuthenticatedTransport, PlatformHttpResponse } from "../../../shared/application/platform-ports";
import { parseEncryptedOfflineVaultBundle, type EncryptedOfflineVaultBundle } from "../domain/offline-vault-bundle";

export class AuthorizedOfflineBundleTransportError extends Error {
  public constructor(public readonly status: number, public readonly code: string) {
    super(`Authorized offline bundle request failed with ${status} (${code}).`);
    this.name = "AuthorizedOfflineBundleTransportError";
  }
}

export class AuthorizedOfflineBundleTransport {
  public constructor(private readonly transport: AuthenticatedTransport) {}

  public async fetch(cached: EncryptedOfflineVaultBundle | null = null): Promise<EncryptedOfflineVaultBundle> {
    const response = await this.transport.request({
      url: "/api/sync/offline-bundle",
      method: "GET",
      headers: cached ? { "if-none-match": `"${cached.synchronizationToken}"` } : undefined,
      cache: "no-store"
    });
    if (response.status === 304) {
      if (!cached) throw new Error("The server returned an unchanged synchronization bundle without a cached encrypted snapshot.");
      return parseEncryptedOfflineVaultBundle({
        ...cached,
        synchronizedAt: response.headers.get("x-synchronized-at") ?? cached.synchronizedAt
      });
    }
    if (response.status !== 200) throw await requestError(response);
    return parseEncryptedOfflineVaultBundle(await response.json<unknown>());
  }
}

async function requestError(response: PlatformHttpResponse): Promise<AuthorizedOfflineBundleTransportError> {
  let code = "request_failed";
  try {
    const value = await response.json<unknown>();
    if (isRecord(value) && Object.keys(value).length === 1 && typeof value.error === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value.error)) code = value.error;
  } catch {
    // Normalize malformed error bodies without retaining their content.
  }
  return new AuthorizedOfflineBundleTransportError(response.status, code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
