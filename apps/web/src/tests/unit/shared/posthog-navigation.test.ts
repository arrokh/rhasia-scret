/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { posthog } from "posthog-js";
import { BROWSER_ANALYTICS_CONFIG } from "@/shared/infrastructure/browser-analytics-config";

describe("PostHog navigation path redaction", () => {
  afterEach(async () => {
    await posthog.shutdown();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("captures sanitized initial and client-side navigation paths through the real SDK", async () => {
    window.history.replaceState({}, "", "/vaults");
    const pageviews: Record<string, unknown>[] = [];
    posthog.init("phc_navigation_test", {
      ...BROWSER_ANALYTICS_CONFIG,
      api_host: "https://us.i.posthog.test",
      loaded: () => undefined,
      capture_performance: false,
      autocapture: false,
      before_send: (capture) => {
        const sanitized = BROWSER_ANALYTICS_CONFIG.before_send(capture);
        if (sanitized?.event === "$pageview") pageviews.push(sanitized.properties);
        // Exercise SDK capture without sending test traffic.
        return null;
      }
    });

    await vi.waitFor(() => expect(pageviews).toHaveLength(1));
    window.history.pushState({}, "", "/vaults/manage/cms1btg0p00wt9spon6tz59d4?secret=hidden#key");
    window.history.replaceState({}, "", "/vaults/manage/personal");

    expect(pageviews.map((properties) => properties.$pathname)).toEqual([
      "/vaults", "/vaults/manage/[redacted]", "/vaults/manage/personal"
    ]);
    expect(pageviews.map((properties) => new URL(String(properties.$current_url)).pathname)).toEqual([
      "/vaults", "/vaults/manage/[redacted]", "/vaults/manage/personal"
    ]);
    expect(JSON.stringify(pageviews)).not.toMatch(/cms1btg0p00wt9spon6tz59d4|secret=hidden|#key/);
    expect(Object.keys(window.sessionStorage)).toEqual([]);
    expect(Object.keys(window.localStorage)).toEqual([]);
  });
});
