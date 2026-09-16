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

export async function loadServerVaultPageContext(): Promise<WebVaultPageContext | null> {
  const userResponse = await requestApi("/v1/me");
  if (userResponse.status === 401 || userResponse.status === 403) return null;
  if (!userResponse.ok) throw new Error("API user lookup failed.");
  const user = (await userResponse.json()) as { id?: unknown; email?: unknown };
  if (typeof user.id !== "string" || typeof user.email !== "string") throw new Error("Invalid API user response.");

  const vaultResponse = await requestApi("/v1/personal-vault");
  if (vaultResponse.status === 401 || vaultResponse.status === 403) return null;
  if (!vaultResponse.ok) throw new Error("API Personal Vault lookup failed.");
  const vault = (await vaultResponse.json()) as { id?: unknown; lifecycle?: unknown };
  if (typeof vault.id !== "string" || (vault.lifecycle !== "UNINITIALIZED" && vault.lifecycle !== "ACTIVE"))
    throw new Error("Invalid API Personal Vault response.");
  return {
    user: { id: user.id, email: user.email, status: "ACTIVE" },
    personalVault: { id: vault.id as string, lifecycle: vault.lifecycle as "UNINITIALIZED" | "ACTIVE" },
  };
}

export async function loadServerDestructiveResetEligibility(): Promise<DestructiveResetEligibility> {
  const response = await requestApi("/v1/personal-vault/destructive-reset");
  if (!response.ok) throw new Error("API recovery eligibility lookup failed.");
  const value = (await response.json()) as Partial<DestructiveResetEligibility>;
  if (
    typeof value.passkeyRecoveryEnrolled !== "boolean" ||
    typeof value.activeOwnedSharedVaults !== "number" ||
    !Array.isArray(value.activeOwnedSharedVaultIds) ||
    !value.activeOwnedSharedVaultIds.every((id): id is string => typeof id === "string")
  )
    throw new Error("Invalid API recovery eligibility response.");
  return value as DestructiveResetEligibility;
}

export async function loadServerAccountDeletionContext(): Promise<{
  email: string;
  authBackend: "passwordless" | "oidc";
} | null> {
  const context = await loadServerVaultPageContext();
  if (!context) return null;
  const backend = process.env.AUTH_BACKEND;
  if (backend !== "passwordless" && backend !== "oidc") throw new Error("Account deletion requires an auth backend.");
  return { email: context.user.email, authBackend: backend };
}

export async function requestApi(path: string, init?: RequestInit): Promise<Response> {
  const apiOrigin = process.env.API_ORIGIN?.trim();
  const proxySecret = process.env.API_PROXY_SECRET?.trim();
  if (!apiOrigin || !proxySecret) throw new Error("API_ORIGIN and API_PROXY_SECRET are required.");
  const origin = new URL(apiOrigin);
  const internalDockerApi = origin.protocol === "http:" && origin.hostname === "api";
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    origin.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(origin.hostname);
  if (origin.protocol !== "https:" && !internalDockerApi && !localDevelopment)
    throw new Error("API_ORIGIN must use HTTPS in production.");
  if (origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password)
    throw new Error("API_ORIGIN must contain only an origin.");
  const incoming = await headers();
  const outgoing = new Headers(init?.headers);
  outgoing.set("accept", "application/json");
  outgoing.set("origin", process.env.WEB_ORIGIN ?? `${origin.protocol}//${origin.host}`);
  outgoing.set("x-rhasia-proxy-secret", proxySecret);
  const cookie = incoming.get("cookie");
  if (cookie && !outgoing.has("cookie")) outgoing.set("cookie", cookie);
  return fetch(new URL(path, origin), { ...init, headers: outgoing, cache: "no-store" });
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
