import { headers } from "next/headers";

export type WebApiUser = {
  id: string;
  email: string;
  status: "ACTIVE";
};

export type WebVaultPageContext = {
  user: WebApiUser;
  personalVault: { id: string; lifecycle: "UNINITIALIZED" | "ACTIVE" };
};

export type DestructiveResetEligibility = {
  passkeyRecoveryEnrolled: boolean;
  activeOwnedSharedVaults: number;
  activeOwnedSharedVaultIds: string[];
};

type ApiError = { error?: string };
export type ServerApiConfigurationCode = "authentication_misconfigured" | "api_misconfigured";

export class ServerApiConfigurationError extends Error {
  public constructor(public readonly code: ServerApiConfigurationCode) {
    super(code);
    this.name = "ServerApiConfigurationError";
  }
}

export class ServerApiUnavailableError extends Error {
  public constructor() {
    super("Hosted API is temporarily unavailable.");
    this.name = "ServerApiUnavailableError";
  }
}

export function isServerApiConfigurationError(error: unknown): error is ServerApiConfigurationError {
  return error instanceof ServerApiConfigurationError;
}

export function isServerApiUnavailableError(error: unknown): error is ServerApiUnavailableError {
  return error instanceof ServerApiUnavailableError;
}

export async function loadServerVaultPageContext(): Promise<WebVaultPageContext | null> {
  const userResponse = await requestPageContextApi("/v1/me");
  if (userResponse.status === 401 || userResponse.status === 403) return null;
  if (!userResponse.ok) {
    throwServerApiConfigurationError(userResponse, await readApiError(userResponse));
    throw new ServerApiUnavailableError();
  }
  const user = await readPageContextJson(userResponse);
  if (!isRecord(user) || typeof user.id !== "string" || typeof user.email !== "string")
    throw new ServerApiUnavailableError();

  const vaultResponse = await requestPageContextApi("/v1/personal-vault");
  if (vaultResponse.status === 401 || vaultResponse.status === 403) return null;
  if (!vaultResponse.ok) {
    throwServerApiConfigurationError(vaultResponse, await readApiError(vaultResponse));
    throw new ServerApiUnavailableError();
  }
  const vault = await readPageContextJson(vaultResponse);
  if (
    !isRecord(vault) ||
    typeof vault.id !== "string" ||
    (vault.lifecycle !== "UNINITIALIZED" && vault.lifecycle !== "ACTIVE")
  )
    throw new ServerApiUnavailableError();
  return {
    user: { id: user.id, email: user.email, status: "ACTIVE" },
    personalVault: { id: vault.id, lifecycle: vault.lifecycle },
  };
}

export async function loadServerDestructiveResetEligibility(): Promise<DestructiveResetEligibility> {
  const response = await requestPageContextApi("/v1/personal-vault/destructive-reset");
  if (!response.ok) {
    throwServerApiConfigurationError(response, await readApiError(response));
    throw new ServerApiUnavailableError();
  }
  const value = await readPageContextJson(response);
  if (!isRecord(value)) throw new ServerApiUnavailableError();
  const passkeyRecoveryEnrolled = value.passkeyRecoveryEnrolled;
  const activeOwnedSharedVaults = value.activeOwnedSharedVaults;
  const activeOwnedSharedVaultIds = value.activeOwnedSharedVaultIds;
  if (
    typeof passkeyRecoveryEnrolled !== "boolean" ||
    typeof activeOwnedSharedVaults !== "number" ||
    !Array.isArray(activeOwnedSharedVaultIds) ||
    !activeOwnedSharedVaultIds.every((id: unknown): id is string => typeof id === "string")
  )
    throw new ServerApiUnavailableError();
  return { passkeyRecoveryEnrolled, activeOwnedSharedVaults, activeOwnedSharedVaultIds };
}

export async function loadServerAccountDeletionContext(): Promise<{ email: string } | null> {
  const context = await loadServerVaultPageContext();
  if (!context) return null;
  return { email: context.user.email };
}

async function requestPageContextApi(path: string): Promise<Response> {
  try {
    return await requestApi(path);
  } catch (error) {
    if (isServerApiConfigurationError(error)) throw error;
    throw new ServerApiUnavailableError();
  }
}

async function readPageContextJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ServerApiUnavailableError();
  }
}

export async function requestApi(path: string, init?: RequestInit): Promise<Response> {
  const apiOrigin = process.env.API_ORIGIN?.trim();
  const proxySecret = process.env.API_PROXY_SECRET?.trim();
  if (!apiOrigin || !proxySecret) throw new ServerApiConfigurationError("api_misconfigured");
  let origin: URL;
  try {
    origin = new URL(apiOrigin);
  } catch {
    throw new ServerApiConfigurationError("api_misconfigured");
  }
  const internalDockerApi = origin.protocol === "http:" && origin.hostname === "api";
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    origin.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(origin.hostname);
  if (origin.protocol !== "https:" && !internalDockerApi && !localDevelopment)
    throw new ServerApiConfigurationError("api_misconfigured");
  if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password)
    throw new ServerApiConfigurationError("api_misconfigured");
  const incoming = await headers();
  const outgoing = new Headers(init?.headers);
  outgoing.set("accept", "application/json");
  outgoing.set("origin", process.env.WEB_ORIGIN ?? `${origin.protocol}//${origin.host}`);
  outgoing.set("x-rhasia-proxy-secret", proxySecret);
  const cookie = incoming.get("cookie");
  if (cookie && !outgoing.has("cookie")) outgoing.set("cookie", cookie);
  return fetch(new URL(path, origin), { ...init, headers: outgoing, cache: "no-store" });
}

function throwServerApiConfigurationError(response: Response, error: ApiError): void {
  if (response.status === 503 && isServerApiConfigurationCode(error.error))
    throw new ServerApiConfigurationError(error.error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isServerApiConfigurationCode(value: string | undefined): value is ServerApiConfigurationCode {
  return value === "authentication_misconfigured" || value === "api_misconfigured";
}

export async function readApiError(response: Response): Promise<ApiError> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string")
      return { error: body.error };
  } catch {
    // Preserve the generic error when the API did not return JSON.
  }
  return {};
}
