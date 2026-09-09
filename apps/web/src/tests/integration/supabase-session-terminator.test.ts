import { describe, expect, it, vi } from "vitest";
import { SupabaseSessionTerminator } from "@/modules/identity/infrastructure/supabase-session-terminator";

describe("SupabaseSessionTerminator", () => {
  it("signs out only the current session and persists cleared SSR cookies", async () => {
    const set = vi.fn();
    const signOut = vi.fn().mockImplementation(async () => ({ error: null }));
    const createClient = vi.fn().mockImplementation((_url, _key, cookieMethods) => {
      signOut.mockImplementationOnce(async () => {
        cookieMethods.setAll([{ name: "sb-session", value: "", options: { path: "/", maxAge: 0 } }]);
        return { error: null };
      });
      return { auth: { signOut } };
    });
    const terminator = new SupabaseSessionTerminator(
      createClient,
      async () => ({ getAll: () => [{ name: "sb-session", value: "stale" }], set }),
      () => ({ url: "https://project.supabase.co", key: "publishable-key" }),
    );

    await expect(terminator.terminateCurrentSession()).resolves.toBeUndefined();
    expect(createClient).toHaveBeenCalledWith("https://project.supabase.co", "publishable-key", expect.any(Object));
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(set).toHaveBeenCalledWith("sb-session", "", { path: "/", maxAge: 0 });
  });

  it("treats a missing stale session as an idempotent successful logout", async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    const terminator = new SupabaseSessionTerminator(
      () => ({ auth: { signOut } }),
      async () => ({ getAll: () => [], set: vi.fn() }),
      () => ({ url: "https://project.supabase.co", key: "publishable-key" }),
    );

    await expect(terminator.terminateCurrentSession()).resolves.toBeUndefined();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("reports provider failures without exposing provider details", async () => {
    const providerFailure = { message: "sensitive provider details" };
    const terminator = new SupabaseSessionTerminator(
      () => ({ auth: { signOut: vi.fn().mockResolvedValue({ error: providerFailure }) } }),
      async () => ({ getAll: () => [], set: vi.fn() }),
      () => ({ url: "https://project.supabase.co", key: "publishable-key" }),
    );

    await expect(terminator.terminateCurrentSession()).rejects.toThrow("Supabase logout failed.");
  });
});
