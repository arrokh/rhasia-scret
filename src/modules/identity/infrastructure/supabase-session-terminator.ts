import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SessionTerminator } from "../application/session-terminator";

type AuthCookie = { name: string; value: string; options: CookieOptions };
type AuthCookieStore = {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options: CookieOptions): void;
};
type SignOutClient = {
  auth: { signOut(options: { scope: "local" }): Promise<{ error: unknown }> };
};
type SignOutClientFactory = (
  url: string,
  key: string,
  cookies: { getAll(): { name: string; value: string }[]; setAll(cookies: AuthCookie[]): void }
) => SignOutClient;
type SupabaseConfiguration = { url: string; key: string };

export class SupabaseSessionTerminator implements SessionTerminator {
  public constructor(
    private readonly createClient: SignOutClientFactory = createSignOutClient,
    private readonly getCookieStore: () => Promise<AuthCookieStore> = getNextCookieStore,
    private readonly getConfiguration: () => SupabaseConfiguration = readSupabaseConfiguration
  ) {}

  public async terminateCurrentSession(): Promise<void> {
    const { url, key } = this.getConfiguration();
    const cookieStore = await this.getCookieStore();
    const client = this.createClient(url, key, {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
      }
    });
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw new Error("Supabase logout failed.", { cause: error });
  }
}

function createSignOutClient(
  url: string,
  key: string,
  cookieMethods: { getAll(): { name: string; value: string }[]; setAll(cookies: AuthCookie[]): void }
): SignOutClient {
  return createServerClient(url, key, { cookies: cookieMethods });
}

async function getNextCookieStore(): Promise<AuthCookieStore> {
  return await cookies();
}

function readSupabaseConfiguration(): SupabaseConfiguration {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase environment is not configured.");
  return { url, key };
}
