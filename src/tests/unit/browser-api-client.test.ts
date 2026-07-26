/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserApiClient, BrowserApiError } from "@/shared/infrastructure/browser-api-client";

describe("BrowserApiClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("centralizes JSON request serialization and response parsing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "vault-1" }) });
    vi.stubGlobal("fetch", fetchMock);
    const client = new BrowserApiClient();

    await expect(client.postJson<{ id: string }>("/api/vaults", { encryptedName: "opaque" })).resolves.toEqual({ id: "vault-1" });
    expect(fetchMock).toHaveBeenCalledWith("/api/vaults", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encryptedName: "opaque" })
    });
  });

  it("preserves request options and reports unsuccessful responses consistently", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const client = new BrowserApiClient();

    await expect(client.getJson("/api/time", { cache: "no-store" })).rejects.toEqual(
      expect.objectContaining<Partial<BrowserApiError>>({ name: "BrowserApiError", status: 503 })
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/time", { cache: "no-store", method: "GET" });
  });
});
