import type { VerifiedSession } from "../application/session-verifier";

export const BROWSER_E2E_SESSION_COOKIE = "rhsia-e2e-session";

type ConfiguredSession = Readonly<{ subject: string; email: string }>;

export function browserE2eTestSession(alias: string | undefined): VerifiedSession | null {
  if (!browserE2eTestsEnabled() || !alias) return null;
  const configured = configuredSessions()[alias];
  if (!configured) return null;
  return { subject: configured.subject, email: configured.email };
}

export function browserE2eTestsEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.E2E_BROWSER_TESTS === "1";
}

function configuredSessions(): Record<string, ConfiguredSession> {
  const raw = process.env.E2E_BROWSER_TEST_USERS;
  if (!raw || raw.length > 16_384) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const sessions: Record<string, ConfiguredSession> = {};
  for (const [alias, value] of Object.entries(parsed)) {
    if (!/^[a-z0-9-]{1,80}$/.test(alias) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.subject !== "string" || !/^[a-z0-9:-]{1,128}$/.test(candidate.subject)) continue;
    if (typeof candidate.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email) || candidate.email.length > 254) continue;
    sessions[alias] = { subject: candidate.subject, email: candidate.email.toLowerCase() };
  }
  return sessions;
}
