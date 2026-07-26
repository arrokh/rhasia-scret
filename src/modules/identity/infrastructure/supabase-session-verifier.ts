import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SessionVerifier, VerifiedSession } from "../application/session-verifier";
import { BROWSER_E2E_SESSION_COOKIE, browserE2eTestSession } from "./browser-e2e-test-session";

export class SupabaseSessionVerifier implements SessionVerifier {
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
    const { data, error } = await client.auth.getUser();
    if (error && error.name !== "AuthSessionMissingError" && error.status !== 401) throw error;
    if (!data.user?.email) return null;
    return { subject: data.user.id, email: data.user.email };
  }
}
