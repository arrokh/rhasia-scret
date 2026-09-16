import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpEmailSender } from "@api/modules/identity/infrastructure/http-email-sender";

afterEach(() => vi.unstubAllGlobals());

describe("HTTP email delivery", () => {
  it("sends credentials in headers and never places them in the provider URL", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", send);
    const sender = createHttpEmailSender({
      EMAIL_PROVIDER_URL: "https://mail.example.test/send",
      EMAIL_PROVIDER_TOKEN: "provider-token",
      AUTH_EMAIL_FROM: "no-reply@example.test",
      AUTH_EMAIL_FROM_NAME: "Rhasia",
    });

    await sender.sendMagicLinkEmail({
      recipientEmail: "user@example.test",
      actionUrl: new URL("https://web.example.test/auth/complete#token=one-time-secret"),
    });

    const [url, init] = send.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://mail.example.test/send");
    expect(url.toString()).not.toContain("provider-token");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer provider-token");
    expect(String(init.body)).toContain("one-time-secret");
  });

  it("rejects insecure non-local provider endpoints", () => {
    expect(() =>
      createHttpEmailSender({
        EMAIL_PROVIDER_URL: "http://mail.example.test/send",
        EMAIL_PROVIDER_TOKEN: "provider-token",
        AUTH_EMAIL_FROM: "no-reply@example.test",
      }),
    ).toThrow("EMAIL_PROVIDER_URL must use HTTPS.");
  });
});
