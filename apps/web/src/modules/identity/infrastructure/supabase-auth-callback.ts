import { createServerClient, type CookieOptions } from "@supabase/ssr";
type AuthCookie = { name: string; value: string; options: CookieOptions };
export type SupabaseCallbackCookieStore = {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options: CookieOptions): void;
};

type SupabaseCallbackConfiguration = { url: string; key: string };
type SupabaseCallback = { kind: "code"; value: string } | { kind: "token_hash"; value: string };

export async function completeSupabaseCallback(
  code: string | null,
  tokenHash: string | null,
  cookieStore: SupabaseCallbackCookieStore,
  configuration: SupabaseCallbackConfiguration,
): Promise<boolean> {
  const callback = parseCallback(code, tokenHash);
  if (!callback) return false;
  const client = createServerClient(configuration.url, configuration.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet: AuthCookie[]) => {
        for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
      },
    },
  });
  switch (callback.kind) {
    case "code":
      return !(await client.auth.exchangeCodeForSession(callback.value)).error;
    case "token_hash":
      return !(await client.auth.verifyOtp({ token_hash: callback.value, type: "email" })).error;
  }
}

function parseCallback(code: string | null, tokenHash: string | null): SupabaseCallback | null {
  if (code && tokenHash) return null;
  if (code) return { kind: "code", value: code };
  if (tokenHash) return { kind: "token_hash", value: tokenHash };
  return null;
}

export function readSupabaseCallbackConfiguration(): SupabaseCallbackConfiguration | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}
