import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { measureServerOperation } from "@/shared/infrastructure/server-performance";
import type { SessionVerifier, VerifiedSession } from "../application/session-verifier";
import { BROWSER_E2E_SESSION_COOKIE, browserE2eTestSession } from "./browser-e2e-test-session";

export type SessionVerificationFreshness = "claims" | "fresh-user";

export class SupabaseSessionVerifier implements SessionVerifier {
  /**
   * Server mutations default to an auth-server-backed user check. The proxy uses
   * getClaims separately for inexpensive page gating; it must not authorize a
   * sensitive API mutation from a stale local claim alone.
   */
  public constructor(private readonly freshness: SessionVerificationFreshness = "fresh-user") {}

  public async verify(): Promise<VerifiedSession | null> {
    const cookieStore = await cookies();
    const testSession = browserE2eTestSession(cookieStore.get(BROWSER_E2E_SESSION_COOKIE)?.value);
    if (testSession) return testSession;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Supabase environment is not configured.");
    const client = createServerClient(url, key, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        }
      }
    });
    if (this.freshness === "fresh-user") {
      const { data, error } = await measureServerOperation("rhsia:server:session-fresh-user", () => client.auth.getUser());
      if (error && error.name !== "AuthSessionMissingError" && error.status !== 401) throw error;
      if (!data.user?.email) return null;
      return { subject: data.user.id, email: data.user.email };
    }

    const { data, error } = await measureServerOperation("rhsia:server:session-claims", () => client.auth.getClaims());
    if (error && error.name !== "AuthSessionMissingError") throw error;
    const subject = data?.claims.sub;
    const email = data?.claims.email;
    if (typeof subject !== "string" || typeof email !== "string") return null;
    return { subject, email };
  }
}
