// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { initializeCloudflareWebAnalytics } from "@/shared/infrastructure/cloudflare-web-analytics";

describe("Cloudflare Web Analytics", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/landing");
    document.head.replaceChildren();
  });

  it("loads the beacon once with the public token on an allowed route", () => {
    const token = "synthetic-cloudflare-analytics-token";

    initializeCloudflareWebAnalytics(token);
    initializeCloudflareWebAnalytics(token);

    const script = document.getElementById("rhasia-cloudflare-web-analytics") as HTMLScriptElement | null;
    expect(script).not.toBeNull();
    expect(script?.type).toBe("module");
    expect(script?.src).toBe("https://static.cloudflareinsights.com/beacon.min.js");
    expect(script?.async).toBe(true);
    expect(script?.dataset.cfBeacon).toBe(JSON.stringify({ token, spa: false }));
    expect(document.querySelectorAll("script#rhasia-cloudflare-web-analytics")).toHaveLength(1);
  });

  it("does not load the beacon without configuration or on a private route", () => {
    initializeCloudflareWebAnalytics(undefined);
    window.history.replaceState({}, "", "/vaults");
    initializeCloudflareWebAnalytics("synthetic-cloudflare-analytics-token");

    expect(document.querySelector("script#rhasia-cloudflare-web-analytics")).toBeNull();
  });
});
