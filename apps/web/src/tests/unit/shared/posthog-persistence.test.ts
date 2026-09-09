/** @vitest-environment jsdom */

import { afterEach, describe, expect, it } from "vitest";
import { posthog } from "posthog-js";
import { BROWSER_ANALYTICS_CONFIG } from "@/shared/infrastructure/browser-analytics-config";

describe("PostHog browser persistence", () => {
  afterEach(async () => {
    await posthog.shutdown();
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it("does not persist private URL data in browser storage", async () => {
    window.history.replaceState({}, "", "/vaults/private-vault?secret=query-value#secret=hash-value");
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.sessionStorage.setItem(
      "ph_rhasia_scret_posthog",
      JSON.stringify({
        $client_session_props: {
          props: { u: "https://vault.example.test/vaults/private-vault?secret=old-query-value" },
        },
      }),
    );

    const instance = posthog.init("phc_test_project_token", {
      ...BROWSER_ANALYTICS_CONFIG,
      api_host: "https://us.i.posthog.test",
      loaded: () => undefined,
      capture_pageview: false,
      capture_pageleave: false,
      capture_performance: false,
      autocapture: false,
      request_batching: false,
    });

    instance.capture("analytics_test_event");

    expect(Object.keys(window.sessionStorage)).toEqual([]);
    expect(Object.keys(window.localStorage)).toEqual([]);
  });
});
