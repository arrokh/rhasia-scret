import { describe, expect, it, vi } from "vitest";
import { ApiClient, ApiClientError } from "./index";

describe("ApiClient", () => {
  it("targets the canonical API origin and versioned path", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new ApiClient({ origin: "https://api.example.test", fetch: send });
    await expect(client.json("health")).resolves.toEqual({ ok: true });
    expect(send.mock.calls[0]?.[0]).toEqual(new URL("https://api.example.test/v1/health"));
  });

  it("normalizes structured failures without exposing response content", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ error: "unauthenticated", secret: "redact" }), { status: 401 }));
    const client = new ApiClient({ origin: "https://api.example.test", fetch: send });
    const failure = await client.json("me").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiClientError);
    expect(failure).toMatchObject({ status: 401, code: "unauthenticated" });
    expect((failure as Error).message).not.toContain("redact");
  });
});
