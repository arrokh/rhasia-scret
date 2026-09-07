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
      page.request.get("/assets/icon.png")
    ]);
    for (const response of responses) expectSecurityHeaders(response, response.url().endsWith("/offline"));
    expect(responses[0].headers()["cache-control"]).toBe("no-store, private");
    expect(responses[2].headers()["content-type"]).toContain("manifest");
    expect(responses[3].headers()["content-type"]).toContain("javascript");
  });

  test("allows same-origin Next.js chunks across client-side navigation", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.headers()["content-security-policy"]).toMatch(/script-src-elem 'self' 'nonce-[^']+'/);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      const state = window as typeof window & { __cspNavigationMarker?: boolean; __cspChunkViolations?: string[] };
      state.__cspNavigationMarker = true;
      state.__cspChunkViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        if (event.blockedURI.includes("/_next/static/chunks/")) state.__cspChunkViolations?.push(event.blockedURI);
      });
    });

    await page.locator('a[href="/sign-in"]').first().evaluate((link) => (link as HTMLElement).click());
    await expect(page).toHaveURL(/\/sign-in$/, { timeout: 30_000 });
    expect(await page.evaluate(() => (window as typeof window & { __cspNavigationMarker?: boolean }).__cspNavigationMarker)).toBe(true);
    expect(await page.evaluate(() => (window as typeof window & { __cspChunkViolations?: string[] }).__cspChunkViolations)).toEqual([]);
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
