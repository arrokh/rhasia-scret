/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserApiClient, BrowserApiError } from "@/shared/infrastructure/browser-api-client";
import { OfflineMutationError, setBrowserWritesReadOnly } from "@/shared/infrastructure/browser-write-policy";

describe("BrowserApiClient", () => {
  afterEach(() => {
    setBrowserWritesReadOnly(null);
    vi.unstubAllGlobals();
  });

  it("centralizes JSON request serialization and response parsing", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "vault-1" }) });
    vi.stubGlobal("fetch", fetchMock);
    const client = new BrowserApiClient();

    await expect(client.postJson<{ id: string }>("/api/vaults", { encryptedName: "opaque" })).resolves.toEqual({
      id: "vault-1",
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/vaults", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ encryptedName: "opaque" }),
    });
  });

  it("preserves request options and reports unsuccessful responses consistently", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal("fetch", fetchMock);
    const client = new BrowserApiClient();

    await expect(client.getJson("/api/time", { cache: "no-store" })).rejects.toEqual(
      expect.objectContaining<Partial<BrowserApiError>>({ name: "BrowserApiError", status: 503 }),
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/time", { cache: "no-store", method: "GET" });
  });

  it("rejects every non-GET request at the common transport boundary while offline without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setBrowserWritesReadOnly("offline test");
    const client = new BrowserApiClient();

    await expect(client.postEmpty("/api/write", {})).rejects.toBeInstanceOf(OfflineMutationError);
    await expect(client.patchEmpty("/api/write", {})).rejects.toBeInstanceOf(OfflineMutationError);
    await expect(client.putEmpty("/api/write", {})).rejects.toBeInstanceOf(OfflineMutationError);
    await expect(client.deleteEmpty("/api/write")).rejects.toBeInstanceOf(OfflineMutationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disposes platform cancellation listeners after the request settles", async () => {
    let disposed = false;
    const cancellation = {
      aborted: false,
      subscribe: () => () => {
        disposed = true;
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200, ok: true, headers: new Headers() }));
    const client = new BrowserApiClient();

    await client.requestPlatform({ url: "/api/time", method: "GET", signal: cancellation });

    expect(disposed).toBe(true);
  });

  it("preserves structured API error codes for context-specific messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "passkey_prf_required" }) }),
    );
    const client = new BrowserApiClient();

    await expect(client.postEmpty("/api/passkey-recovery/registration/verify", {})).rejects.toEqual(
      expect.objectContaining<Partial<BrowserApiError>>({ status: 400, code: "passkey_prf_required" }),
    );
  });
});
