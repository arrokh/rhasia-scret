/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostHog } from "posthog-js";
import { BROWSER_ANALYTICS_CONFIG } from "@/shared/infrastructure/browser-analytics-config";

describe("PostHog browser persistence", () => {
  let posthog: PostHog;
  beforeEach(() => {
    posthog = new PostHog();
  });

  afterEach(async () => {
    await posthog.shutdown();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("sends raw user identity and email through the real SDK sanitizer without persisting them", () => {
    window.history.replaceState({}, "", "/vaults/private-vault?secret=query-value#private");
    const beforeSend = vi.fn(BROWSER_ANALYTICS_CONFIG.before_send);
    const instance = posthog.init("phc_test_project_token", {
      ...BROWSER_ANALYTICS_CONFIG,
      api_host: "https://us.i.posthog.test",
      loaded: () => undefined,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      autocapture: false,
      request_batching: true,
      before_send: beforeSend
    });

    instance.identify("application-user-id", { email: "alice@example.test", secret: "private" });
    const identified = beforeSend.mock.results.find(({ value }) => value?.event === "$identify")?.value;
    expect(identified?.properties.distinct_id).toBe("application-user-id");
    expect(identified?.$set).toEqual({ email: "alice@example.test" });
    expect(identified?.$set_once).toBeUndefined();

    beforeSend.mockClear();
    instance.identify("application-user-id", { email: "updated@example.test", secret: "private" });
    const updated = beforeSend.mock.results.find(({ value }) => value?.event === "$set")?.value;
    expect(updated?.properties.distinct_id).toBe("application-user-id");
    expect(updated?.properties.$set).toEqual({ email: "updated@example.test" });

    const event = instance.capture("authentication_session_established");
    expect(event?.properties.distinct_id).toBe("application-user-id");
    expect(event?.properties.email).toBeUndefined();
    expect(event?.$set).toBeUndefined();
    expect(Object.keys(window.sessionStorage)).toEqual([]);
    expect(Object.keys(window.localStorage)).toEqual([]);
    instance.reset();
    expect(instance.get_distinct_id()).not.toBe("application-user-id");
  });

  it("does not persist private URL data in browser storage", async () => {
    window.history.replaceState({}, "", "/vaults/private-vault?secret=query-value#secret=hash-value");
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.sessionStorage.setItem("ph_rhasia_scret_posthog", JSON.stringify({
      $client_session_props: {
        props: { u: "https://vault.example.test/vaults/private-vault?secret=old-query-value" }
      }
    }));

    const instance = posthog.init("phc_test_project_token", {
      ...BROWSER_ANALYTICS_CONFIG,
      api_host: "https://us.i.posthog.test",
      loaded: () => undefined,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      autocapture: false,
      request_batching: false
    });

    instance.capture("analytics_test_event");

    expect(Object.keys(window.sessionStorage)).toEqual([]);
    expect(Object.keys(window.localStorage)).toEqual([]);
  });
});
