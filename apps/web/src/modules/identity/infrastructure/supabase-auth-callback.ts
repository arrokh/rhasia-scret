import { createServerClient, type CookieOptions } from "@supabase/ssr";
type AuthCookie = { name: string; value: string; options: CookieOptions };
export type SupabaseCallbackCookieStore = {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options: CookieOptions): void;
};

type SupabaseCallbackConfiguration = { url: string; key: string };

export async function completeSupabaseCallback(
  code: string | null,
  tokenHash: string | null,
  cookieStore: SupabaseCallbackCookieStore,
  configuration: SupabaseCallbackConfiguration
): Promise<boolean> {
  if (!code && !tokenHash) return false;
  const client = createServerClient(configuration.url, configuration.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet: AuthCookie[]) => {
        for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
      }
    }
  });
  const { error } = code
    ? await client.auth.exchangeCodeForSession(code)
    : await client.auth.verifyOtp({ token_hash: tokenHash!, type: "email" });
  return !error;
}

export function readSupabaseCallbackConfiguration(): SupabaseCallbackConfiguration | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}
