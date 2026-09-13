import { createServerClient, type CookieOptions } from "@supabase/ssr";
type AuthCookie = { name: string; value: string; options: CookieOptions };
export type SupabaseCallbackCookieStore = {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options: CookieOptions): void;
};

type SupabaseCallbackConfiguration = { url: string; key: string };
type SupabaseCallback = { kind: "code"; value: string } | { kind: "token_hash"; value: string };
type SupabaseCallbackResult = "success" | "missing_code" | "verification_failed";

export async function completeSupabaseCallback(
  code: string | null,
  tokenHash: string | null,
  cookieStore: SupabaseCallbackCookieStore,
  configuration: SupabaseCallbackConfiguration,
): Promise<SupabaseCallbackResult> {
  const callback = parseCallback(code, tokenHash);
  if (callback === "missing_code") return callback;
  if (!callback) return "verification_failed";
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
      return (await client.auth.exchangeCodeForSession(callback.value)).error ? "verification_failed" : "success";
    case "token_hash":
      return (await client.auth.verifyOtp({ token_hash: callback.value, type: "email" })).error
        ? "verification_failed"
        : "success";
  }
}

function parseCallback(code: string | null, tokenHash: string | null): SupabaseCallback | "missing_code" | null {
  if (!code && !tokenHash) return "missing_code";
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
