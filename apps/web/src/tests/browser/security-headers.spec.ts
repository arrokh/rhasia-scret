import { expect, test } from "@playwright/test";

test.describe("browser security delivery headers", () => {
  test("protects pages, APIs, offline shell, manifest, service worker, and static assets", async ({ page }) => {
    const pageResponse = await page.goto("/");
    expect(pageResponse).not.toBeNull();
    expectSecurityHeaders(pageResponse!, true);

    const responses = await Promise.all([
      page.request.get("/api/health"),
      page.request.get("/offline"),
      page.request.get("/manifest.webmanifest"),
      page.request.get("/sw.js"),
      page.request.get("/pwa/icon512_rounded.png")
    ]);
    for (const response of responses) expectSecurityHeaders(response, response.url().endsWith("/offline"));
    expect(responses[0].headers()["cache-control"]).toBe("no-store, private");
    expect(responses[2].headers()["content-type"]).toContain("manifest");
    expect(responses[3].headers()["content-type"]).toContain("javascript");
  });
});

type HeaderResponse = { headers(): Record<string, string>; url(): string };

function expectSecurityHeaders(response: HeaderResponse, dynamicCsp: boolean): void {
  const headers = response.headers();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toContain("camera=(self)");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
  expect(headers["strict-transport-security"]).toContain("preload");
  expect(headers["content-security-policy"]).toContain("object-src 'none'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).not.toContain("script-src 'unsafe-inline'");
  if (dynamicCsp) expect(headers["content-security-policy"]).toMatch(/nonce-[^']+/);
}
