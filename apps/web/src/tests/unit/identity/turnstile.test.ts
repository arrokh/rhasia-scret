/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { CloudflareTurnstileValidator, isSafeTurnstileToken } from "@/modules/identity/infrastructure/turnstile";

describe("CloudflareTurnstileValidator", () => {
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

  it("rejects non-successful HTTP responses and unsafe token values", async () => {
    const validator = new CloudflareTurnstileValidator(
      "server-secret",
      vi.fn().mockResolvedValue(new Response(null, { status: 502 })),
    );

    await expect(validator.validate("token")).resolves.toBe("unavailable");
    expect(isSafeTurnstileToken("XXXX.DUMMY.TOKEN.XXXX")).toBe(true);
    expect(isSafeTurnstileToken("token with spaces")).toBe(false);
    expect(isSafeTurnstileToken("\u0000token")).toBe(false);
  });
});
