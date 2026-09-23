import type {
  AuthenticatedTransport,
  CancellationPort,
  PlatformHttpResponse,
} from "../../../shared/application/platform-ports";
import { parseAuthorizedWorkspaceResponse, type AuthorizedWorkspaceResponse } from "../domain/offline-vault-bundle";

export class AuthorizedWorkspaceTransportError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(`Authorized workspace request failed with ${status} (${code}).`);
    this.name = "AuthorizedWorkspaceTransportError";
  }
}

export class AuthorizedWorkspaceTransport {
  public constructor(private readonly transport: AuthenticatedTransport) {}

  public async fetch(signal?: CancellationPort): Promise<AuthorizedWorkspaceResponse> {
    if (signal?.aborted) throw cancellationError();
    const response = await this.transport.request({
      url: "/v1/sync/workspace-bundle",
      method: "GET",
      cache: "no-store",
      ...(signal ? { signal } : {}),
    });
    if (signal?.aborted) throw cancellationError();
    if (response.status !== 200) throw await requestError(response);
    const body = await response.json<unknown>();
    if (signal?.aborted) throw cancellationError();
    return parseAuthorizedWorkspaceResponse(body);
  }
}

async function requestError(response: PlatformHttpResponse): Promise<AuthorizedWorkspaceTransportError> {
  let code = "request_failed";
  try {
    const value = await response.json<unknown>();
    if (
      isRecord(value) &&
      Object.keys(value).length === 1 &&
      typeof value.error === "string" &&
      /^[a-z][a-z0-9_]{0,63}$/.test(value.error)
    )
      code = value.error;
  } catch {
    // Normalize malformed error bodies without retaining their content.
  }
  return new AuthorizedWorkspaceTransportError(response.status, code);
}

function cancellationError(): Error {
  const error = new Error("Authorized workspace request was cancelled.");
  error.name = "AbortError";
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
