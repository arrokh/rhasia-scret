import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { measureServerOperation } from "@/shared/infrastructure/server-performance";
import type { SessionAssurance, SessionVerifier, VerifiedPrincipal } from "../application/session-verifier";
import { assuranceSatisfies } from "../application/session-verifier";
import { BROWSER_E2E_SESSION_COOKIE, browserE2eTestSession } from "./browser-e2e-test-session";

export type SessionVerificationFreshness = "claims" | "fresh-user";

export class SupabaseSessionVerifier implements SessionVerifier {
  public constructor(private readonly freshness: SessionVerificationFreshness = "fresh-user") {}

  public async verify(minimumAssurance: SessionAssurance = this.freshness === "claims" ? "verified-claims" : "fresh-provider-user"): Promise<VerifiedPrincipal | null> {
    const cookieStore = await cookies();
    const testSession = browserE2eTestSession(cookieStore.get(BROWSER_E2E_SESSION_COOKIE)?.value);
    if (testSession && assuranceSatisfies(testSession.assurance, minimumAssurance)) return testSession;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Supabase environment is not configured.");
    const client = createServerClient(url, key, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        }
      }
    });
    if (this.freshness === "fresh-user") {
      const { data, error } = await measureServerOperation("rhsia:server:session-fresh-user", () => client.auth.getUser());
      if (error && error.name !== "AuthSessionMissingError" && error.status !== 401) throw error;
      if (!data.user?.email || data.user.email_confirmed_at === null) return null;
      const session = {
        issuer: supabaseIssuer(url),
        subject: data.user.id,
        email: data.user.email.toLowerCase(),
        emailVerified: Boolean(data.user.email_confirmed_at),
        assurance: "fresh-provider-user" as const
      };
      return assuranceSatisfies(session.assurance, minimumAssurance) ? session : null;
    }

    const { data, error } = await measureServerOperation("rhsia:server:session-claims", () => client.auth.getClaims());
    if (error && error.name !== "AuthSessionMissingError") throw error;
    const claims = data?.claims;
    const subject = claims?.sub;
    const email = claims?.email;
    const issuer = claims?.iss;
    const emailVerified = claims?.email_verified;
    if (typeof subject !== "string" || typeof email !== "string" || emailVerified !== true) return null;
    const session = {
      issuer: typeof issuer === "string" ? issuer : supabaseIssuer(url),
      subject,
      email: email.toLowerCase(),
      emailVerified: true,
      assurance: "verified-claims" as const,
      sessionId: typeof claims?.session_id === "string" ? claims.session_id : undefined
    };
    return assuranceSatisfies(session.assurance, minimumAssurance) ? session : null;
  }
}

export function supabaseIssuer(url = process.env.NEXT_PUBLIC_SUPABASE_URL): string {
  if (!url) throw new Error("Supabase environment is not configured.");
  return `${url.replace(/\/$/, "")}/auth/v1`;
}
