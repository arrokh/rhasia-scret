import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import {
  loadServerDestructiveResetEligibility,
  loadServerVaultPageContext,
  ServerApiConfigurationError,
  ServerApiUnavailableError,
} from "@/shared/infrastructure/server-api-gateway";

beforeEach(() => {
  vi.stubEnv("API_ORIGIN", "https://api.example.test");
  vi.stubEnv("API_PROXY_SECRET", "synthetic-api-proxy-secret");
  vi.stubGlobal("fetch", mocks.fetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("server API gateway", () => {
  it("maps an upstream user lookup 500 to a safe typed availability error", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "internal_error" }), { status: 500 }));

    await expect(loadServerVaultPageContext()).rejects.toBeInstanceOf(ServerApiUnavailableError);
  });

  it("maps malformed lookup responses to a safe availability error", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("null"));

    await expect(loadServerVaultPageContext()).rejects.toBeInstanceOf(ServerApiUnavailableError);
  });

  it("maps Personal Vault lookup failures to the same safe availability error", async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "user-1", email: "person@example.test" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "internal_error" }), { status: 500 }));

    await expect(loadServerVaultPageContext()).rejects.toBeInstanceOf(ServerApiUnavailableError);
  });

  it("maps recovery eligibility failures to the same safe availability error", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "internal_error" }), { status: 500 }));

    await expect(loadServerDestructiveResetEligibility()).rejects.toBeInstanceOf(ServerApiUnavailableError);
  });

  it("maps transport failures without retaining or exposing their details", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("transport failed"));

    await expect(loadServerVaultPageContext()).rejects.toMatchObject({
      name: "ServerApiUnavailableError",
      message: "Hosted API is temporarily unavailable.",
    });
  });

  it("keeps unauthenticated responses distinct from upstream failures", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));

    await expect(loadServerVaultPageContext()).resolves.toBeNull();
  });

  it("maps missing web API configuration to the configuration error", async () => {
    vi.stubEnv("API_ORIGIN", "");

    await expect(loadServerVaultPageContext()).rejects.toBeInstanceOf(ServerApiConfigurationError);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("preserves known API configuration failures", async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "authentication_misconfigured" }), { status: 503 }),
    );

    await expect(loadServerVaultPageContext()).rejects.toMatchObject({
      name: "ServerApiConfigurationError",
      code: "authentication_misconfigured",
    });
  });
});
