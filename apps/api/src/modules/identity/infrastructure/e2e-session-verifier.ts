import type { ResponseCookieStore } from "@api/http/cookies";
import type { SessionAssurance, SessionVerifier, VerifiedPrincipal } from "../application/session-verifier";
import { assuranceSatisfies } from "../application/session-verifier";

export const E2E_SESSION_COOKIE = "rhsia-e2e-session";

export function clearE2eSessionCookie(cookies: ResponseCookieStore): void {
  cookies.set(E2E_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

type ConfiguredSession = Readonly<{ subject: string; email: string; emailVerified?: boolean }>;

export function createE2eSessionVerifier(bindings: {
  NODE_ENV?: string;
  E2E_BROWSER_TESTS?: string;
  E2E_BROWSER_TEST_USERS?: string;
}): SessionVerifier | null {
  if (bindings.NODE_ENV !== "development" || bindings.E2E_BROWSER_TESTS !== "1") return null;
  const sessions = parseConfiguredSessions(bindings.E2E_BROWSER_TEST_USERS);
  return {
    verify: async (
      request: Request,
      minimum: SessionAssurance = "active-session",
    ): Promise<VerifiedPrincipal | null> => {
      const alias = readCookie(request.headers.get("cookie"), E2E_SESSION_COOKIE);
      if (!alias || request.headers.has("authorization") || !request.headers.has("x-rhasia-proxy-secret")) return null;
      const configured = sessions[alias];
      if (!configured) return null;
      const principal: VerifiedPrincipal = {
        issuer: "e2e",
        subject: configured.subject,
        email: configured.email,
        emailVerified: configured.emailVerified ?? true,
        assurance: "active-session",
        sessionId: `e2e:${alias}`,
      };
      return assuranceSatisfies(principal.assurance, minimum) ? principal : null;
    },
  };
}

function parseConfiguredSessions(raw: string | undefined): Record<string, ConfiguredSession> {
  if (!raw || raw.length > 16_384) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const sessions: Record<string, ConfiguredSession> = {};
  for (const [alias, value] of Object.entries(parsed)) {
    if (!/^[a-z0-9-]{1,80}$/.test(alias) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.subject !== "string" || !/^[a-z0-9:-]{1,128}$/.test(candidate.subject)) continue;
    if (
      typeof candidate.email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email) ||
      candidate.email.length > 254
    )
      continue;
    sessions[alias] = {
      subject: candidate.subject,
      email: candidate.email.toLowerCase(),
      emailVerified: candidate.emailVerified !== false,
    };
  }
  return sessions;
}

function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}
