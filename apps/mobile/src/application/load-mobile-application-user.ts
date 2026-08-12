import type { AuthenticatedTransport } from "@rhasia-scret/client-vault-core";

export type MobileApplicationUser = { id: string; email: string };
export type MobileApplicationUserResult =
  | { status: "active"; user: MobileApplicationUser }
  | { status: "unauthenticated" | "inactive" | "unavailable" };

export async function loadMobileApplicationUser(transport: AuthenticatedTransport): Promise<MobileApplicationUserResult> {
  const response = await transport.request({ url: "/api/me", method: "GET", cache: "no-store" });
  if (response.status === 401) return { status: "unauthenticated" };
  if (response.status === 403) return { status: "inactive" };
  if (!response.ok) return { status: "unavailable" };
  const body = await response.json<unknown>();
  if (!isMobileApplicationUser(body)) return { status: "unavailable" };
  return { status: "active", user: body };
}

function isMobileApplicationUser(value: unknown): value is MobileApplicationUser {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === "string" && typeof record.email === "string";
}
