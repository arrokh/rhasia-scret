/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { createTurnstileValidator } from "@api/modules/identity/server";
import { CloudflareTurnstileValidator, isSafeTurnstileToken } from "@api/modules/identity/infrastructure/turnstile";

describe("CloudflareTurnstileValidator", () => {
  it("trims the production secret before sending it to Cloudflare", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    try {
      const validator = createTurnstileValidator({ TURNSTILE_SECRET_KEY: "  server-secret  " });

      await expect(validator.validate("token")).resolves.toBe("invalid");
      expect(fetcher).toHaveBeenCalledWith(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        expect.objectContaining({ body: "secret=server-secret&response=token" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("accepts a successful Cloudflare validation without exposing the secret in the request URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const validator = new CloudflareTurnstileValidator("server-secret", fetcher);

    await expect(validator.validate("XXXX.DUMMY.TOKEN.XXXX")).resolves.toBe("valid");
    expect(fetcher).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({
        method: "POST",
        body: "secret=server-secret&response=XXXX.DUMMY.TOKEN.XXXX",
      }),
    );
  });

  it("classifies rejected tokens as invalid and transport failures as unavailable", async () => {
    const rejected = new CloudflareTurnstileValidator(
      "server-secret",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 })),
    );
    const unavailable = new CloudflareTurnstileValidator(
      "server-secret",
      vi.fn().mockRejectedValue(new Error("offline")),
    );

    await expect(rejected.validate("token")).resolves.toBe("invalid");
    await expect(unavailable.validate("token")).resolves.toBe("unavailable");
  });

  it("reports bounded diagnostics for provider failures without exposing response content", async () => {
    const httpFailure = new CloudflareTurnstileValidator(
      "server-secret",
      vi.fn().mockResolvedValue(new Response(null, { status: 502 })),
    );
    const malformedFailure = new CloudflareTurnstileValidator(
      "server-secret",
      vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })),
    );
    const transportFailure = new CloudflareTurnstileValidator(
      "server-secret",
      vi.fn().mockRejectedValue(new Error("secret provider detail")),
    );

    await expect(httpFailure.validate("token")).resolves.toBe("unavailable");
    await expect(httpFailure.validateWithDiagnostics("token")).resolves.toEqual({
      result: "unavailable",
      unavailableReason: "http_error",
      responseStatus: 502,
    });
    await expect(malformedFailure.validateWithDiagnostics("token")).resolves.toEqual({
      result: "unavailable",
      unavailableReason: "malformed_response",
      responseStatus: 200,
    });
    await expect(transportFailure.validateWithDiagnostics("token")).resolves.toEqual({
      result: "unavailable",
      unavailableReason: "transport",
    });
    expect(isSafeTurnstileToken("XXXX.DUMMY.TOKEN.XXXX")).toBe(true);
    expect(isSafeTurnstileToken("token with spaces")).toBe(false);
    expect(isSafeTurnstileToken("\u0000token")).toBe(false);
  });
});
