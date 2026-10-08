/** @vitest-environment node */

import { describe, expect, it, vi } from "vitest";
import { createTurnstileValidator } from "@api/modules/identity/server";
import {
  CloudflareTurnstileValidator,
  isSafeTurnstileToken,
  type TurnstileValidationPolicy,
} from "@api/modules/identity/infrastructure/turnstile";

describe("CloudflareTurnstileValidator", () => {
  it("trims the production secret before sending it to Cloudflare", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    try {
      const validator = createTurnstileValidator({
        TURNSTILE_SECRET_KEY: "  server-secret  ",
        AUTH_APP_ORIGIN: "https://auth.example.test",
      });

      await expect(validator.validate("token")).resolves.toBe("invalid");
      expect(fetcher).toHaveBeenCalledWith(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        expect.objectContaining({ body: "secret=server-secret&response=token" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips verification when disabled and rejects a missing token when enabled", async () => {
    const fetcher = vi.fn();
    const disabled = new CloudflareTurnstileValidator(undefined, undefined, fetcher);
    const enabled = new CloudflareTurnstileValidator(
      "server-secret",
      { kind: "strict", expectedAction: "magic_link_request", expectedHostname: "auth.example.test" },
      fetcher,
    );

    await expect(disabled.validate()).resolves.toBe("valid");
    await expect(disabled.validateWithDiagnostics()).resolves.toEqual({ result: "valid" });
    await expect(enabled.validate()).resolves.toBe("invalid");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(createTurnstileValidator({ TURNSTILE_SECRET_KEY: "" }).validate()).resolves.toBe("valid");
    await expect(
      createTurnstileValidator({
        TURNSTILE_SECRET_KEY: "synthetic-turnstile-secret",
        AUTH_APP_ORIGIN: "https://auth.example.test",
      }).validate(),
    ).resolves.toBe("invalid");
  });

  it("accepts only the expected action and hostname without exposing the secret in the request URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, action: "magic_link_request", hostname: "auth.example.test" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const validator = new CloudflareTurnstileValidator(
      "server-secret",
      { kind: "strict", expectedAction: "magic_link_request", expectedHostname: "auth.example.test" },
      fetcher,
    );

    await expect(validator.validate("XXXX.DUMMY.TOKEN.XXXX")).resolves.toBe("valid");
    expect(fetcher).toHaveBeenCalledWith(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      expect.objectContaining({
        method: "POST",
        body: "secret=server-secret&response=XXXX.DUMMY.TOKEN.XXXX",
      }),
    );
  });

  it("accepts the observed Cloudflare sandbox response without production action/hostname metadata", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            hostname: "example.com",
            "error-codes": [],
            metadata: { result_with_testing_key: true },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetcher);
    try {
      const validator = createTurnstileValidator({
        NODE_ENV: "development",
        TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
        AUTH_APP_ORIGIN: "http://localhost:3000",
      });

      await expect(validator.validate("XXXX.DUMMY.TOKEN.XXXX")).resolves.toBe("valid");
      await expect(validator.validate("XXXX.DUMMY.TOKEN.XXXX")).resolves.toBe("invalid");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects unsuccessful, wrong-action, wrong-host, and incomplete successful responses", async () => {
    const responses = [
      { success: false },
      { success: true, action: "another_action", hostname: "auth.example.test" },
      { success: true, action: "magic_link_request", hostname: "untrusted.example.test" },
      { success: true, action: "magic_link_request" },
    ];
    const validator = new CloudflareTurnstileValidator(
      "server-secret",
      { kind: "strict", expectedAction: "magic_link_request", expectedHostname: "auth.example.test" },
      vi.fn().mockImplementation(async () => new Response(JSON.stringify(responses.shift()), { status: 200 })),
    );

    await expect(validator.validate("token")).resolves.toBe("invalid");
    await expect(validator.validate("token")).resolves.toBe("invalid");
    await expect(validator.validate("token")).resolves.toBe("invalid");
    await expect(validator.validate("token")).resolves.toBe("invalid");
  });

  it("classifies transport failures as unavailable", async () => {
    const unavailable = new CloudflareTurnstileValidator(
      "server-secret",
      { kind: "strict", expectedAction: "magic_link_request", expectedHostname: "auth.example.test" },
      vi.fn().mockRejectedValue(new Error("offline")),
    );

    await expect(unavailable.validate("token")).resolves.toBe("unavailable");
  });

  it("reports bounded diagnostics for provider failures without exposing response content", async () => {
    const strictPolicy: TurnstileValidationPolicy = {
      kind: "strict",
      expectedAction: "magic_link_request",
      expectedHostname: "auth.example.test",
    };
    const httpFailure = new CloudflareTurnstileValidator(
      "server-secret",
      strictPolicy,
      vi.fn().mockResolvedValue(new Response(null, { status: 502 })),
    );
    const malformedFailure = new CloudflareTurnstileValidator(
      "server-secret",
      strictPolicy,
      vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })),
    );
    const transportFailure = new CloudflareTurnstileValidator(
      "server-secret",
      strictPolicy,
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
