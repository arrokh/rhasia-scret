/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { posthog } from "posthog-js";
import { BROWSER_ANALYTICS_CONFIG } from "@/shared/infrastructure/browser-analytics-config";

describe("PostHog public-route navigation policy", () => {
  afterEach(async () => {
    await posthog.shutdown();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("allows public pageviews and suppresses client-side navigation to application routes", async () => {
    window.history.replaceState({}, "", "/landing");
    const pageviews: Record<string, unknown>[] = [];
    const candidates: Record<string, unknown>[] = [];
    posthog.init("phc_navigation_test", {
      ...BROWSER_ANALYTICS_CONFIG,
      api_host: "https://us.i.posthog.test",
      capture_performance: false,
      autocapture: false,
      before_send: (capture) => {
        if (capture?.event === "$pageview") candidates.push(capture.properties);
        const sanitized = BROWSER_ANALYTICS_CONFIG.before_send(capture);
        if (sanitized?.event === "$pageview") pageviews.push(sanitized.properties);
        // Exercise SDK capture without sending test traffic.
        return null;
      },
    });

    await vi.waitFor(() => expect(pageviews).toHaveLength(1));
    expect(pageviews.map((properties) => properties.$pathname)).toEqual(["/landing"]);
    window.history.pushState({}, "", "/vaults/manage/cms1btg0p00wt9spon6tz59d4?secret=hidden#key");
    window.history.replaceState({}, "", "/vaults/manage/personal");
    await vi.waitFor(() => expect(candidates).toHaveLength(3));

    expect(pageviews).toHaveLength(1);
    expect(new URL(String(pageviews[0]?.$current_url)).pathname).toBe("/landing");
    expect(JSON.stringify(pageviews)).not.toMatch(/cms1btg0p00wt9spon6tz59d4|secret=hidden|#key/);
    expect(Object.keys(window.sessionStorage)).toEqual([]);
    expect(Object.keys(window.localStorage)).toEqual([]);
  });
});
