import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_EVENTS, sanitizeAnalyticsCapture } from "@/shared/infrastructure/browser-analytics-config";
import type { BROWSER_ANALYTICS_CONFIG } from "@/shared/infrastructure/browser-analytics-config";

const posthogMocks = vi.hoisted(() => ({
  capture: vi.fn(),
  identify: vi.fn(),
  init: vi.fn(),
  reset: vi.fn()
}));

vi.mock("posthog-js", () => ({ default: posthogMocks }));

type AnalyticsInitOptions = {
  autocapture?: {
    url_ignorelist?: RegExp[];
    dom_event_allowlist?: string[];
    element_allowlist?: string[];
    css_selector_ignorelist?: string[];
    element_attribute_ignorelist?: string[];
    capture_copied_text?: boolean;
  };
  capture_pageview?: boolean;
  capture_pageleave?: boolean;
  capture_dead_clicks?: boolean;
  capture_heatmaps?: boolean;
  capture_performance?: boolean;
  capture_exceptions?: boolean;
  disable_session_recording?: boolean;
  disable_surveys?: boolean;
  disable_persistence?: boolean;
  persistence?: string;
  persistence_name?: string;
  disable_capture_url_hashes?: boolean;
  save_referrer?: boolean;
  save_campaign_params?: boolean;
  mask_all_text?: boolean;
  mask_all_element_attributes?: boolean;
  respect_dnt?: boolean;
  before_send?: typeof BROWSER_ANALYTICS_CONFIG.before_send;
  loaded?: (client: typeof posthogMocks) => void;
};

describe("browser analytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "phc_test_project_token");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://us.i.posthog.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("emits one privacy-safe application event after PostHog loads", async () => {
    const { initializeBrowserAnalytics } = await import("@/shared/infrastructure/browser-analytics");

    initializeBrowserAnalytics();
    initializeBrowserAnalytics();

    await vi.waitFor(() => expect(posthogMocks.init).toHaveBeenCalledOnce());
    const options = posthogMocks.init.mock.calls[0]?.[1] as AnalyticsInitOptions;
    expect(options.autocapture).toMatchObject({
      dom_event_allowlist: ["click", "submit"],
      element_allowlist: ["a", "button"],
      capture_copied_text: false
    });
    expect(options).toMatchObject({
      capture_pageview: true,
      capture_pageleave: true,
      capture_dead_clicks: true,
      capture_heatmaps: false,
      capture_performance: true,
      capture_exceptions: true,
      disable_session_recording: true,
      disable_surveys: true,
      disable_persistence: false,
      persistence: "sessionStorage",
      persistence_name: "rhasia_scret_posthog",
      disable_capture_url_hashes: true,
      save_referrer: false,
      save_campaign_params: false,
      mask_all_text: true,
      mask_all_element_attributes: true,
      respect_dnt: true
    });
    expect(options.loaded).toBeTypeOf("function");
    expect(options.before_send).toBeTypeOf("function");

    options.loaded?.(posthogMocks);

    expect(posthogMocks.capture).toHaveBeenCalledOnce();
    expect(posthogMocks.capture).toHaveBeenCalledWith(ANALYTICS_EVENTS.applicationOpened);
  });

  it("preserves PostHog's required ingestion token while sanitizing captures", () => {
    const capture = sanitizeAnalyticsCapture({
      uuid: "capture-token-test-uuid",
      event: ANALYTICS_EVENTS.applicationOpened,
      properties: {
        token: "phc_test_project_token",
        distinct_id: "anonymous-test-id",
        email: "alice@example.test"
      }
    });

    expect(capture?.properties).toEqual({
      token: "phc_test_project_token",
      distinct_id: "anonymous-test-id"
    });
  });

  it("drops automatic events on private routes and removes sensitive automatic properties", () => {
    const privateCapture = sanitizeAnalyticsCapture({
      uuid: "capture-test-uuid",
      event: "$autocapture",
      properties: {
        $current_url: "https://vault.example.test/vaults/cuid-private?tab=accounts#secret",
        $el_text: "Alice",
        email: "alice@example.test",
        safe_number: 1
      }
    });
    expect(privateCapture).toBeNull();

    const privatePageview = sanitizeAnalyticsCapture({
      uuid: "private-pageview-test-uuid",
      event: "$pageview",
      properties: {
        $current_url: "https://vault.example.test/vaults/cuid-private?tab=accounts#secret",
        $pathname: "/vaults/cuid-private",
        title: "Private Account Label",
        safe_number: 1
      }
    });
    expect(privatePageview?.properties).toEqual({
      $current_url: "https://vault.example.test/[private]",
      safe_number: 1
    });

    const publicCapture = sanitizeAnalyticsCapture({
      uuid: "pageview-test-uuid",
      event: "$pageview",
      properties: {
        $current_url: "https://vault.example.test/?utm_source=private#fragment",
        $el_text: "Landing",
        email: "alice@example.test",
        $exception: "secret exception details",
        safe_number: 1
      }
    });
    expect(publicCapture?.properties).toEqual({
      $current_url: "https://vault.example.test/",
      safe_number: 1
    });
  });

  it("forwards explicit events through the initialized singleton", async () => {
    const { captureAnalyticsEvent } = await import("@/shared/infrastructure/browser-analytics");

    captureAnalyticsEvent(ANALYTICS_EVENTS.authenticatorAccountCreated, { vault_type: "PERSONAL" });

    await vi.waitFor(() => expect(posthogMocks.capture).toHaveBeenCalledWith(ANALYTICS_EVENTS.authenticatorAccountCreated, { vault_type: "PERSONAL" }));
    expect(posthogMocks.init).toHaveBeenCalledOnce();
  });

  it("hashes an opaque user identifier before identifying it", async () => {
    const { identifyAnalyticsUser } = await import("@/shared/infrastructure/browser-analytics");
    const rawUserId = "2d7f6ef7-0d69-4da2-9b7d-2c2a1e2f9b44";

    identifyAnalyticsUser(rawUserId);

    await vi.waitFor(() => expect(posthogMocks.identify).toHaveBeenCalledOnce());
    const identifiedUserId = posthogMocks.identify.mock.calls[0]?.[0];
    expect(identifiedUserId).not.toBe(rawUserId);
    expect(identifiedUserId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not identify an email-shaped identifier", async () => {
    const { identifyAnalyticsUser } = await import("@/shared/infrastructure/browser-analytics");

    identifyAnalyticsUser("user@example.test");
    await Promise.resolve();

    expect(posthogMocks.init).not.toHaveBeenCalled();
    expect(posthogMocks.identify).not.toHaveBeenCalled();
  });

  it("stays disabled when public PostHog configuration is incomplete", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN", "");
    const { initializeBrowserAnalytics } = await import("@/shared/infrastructure/browser-analytics");

    initializeBrowserAnalytics();
    await Promise.resolve();

    expect(posthogMocks.init).not.toHaveBeenCalled();
    expect(posthogMocks.capture).not.toHaveBeenCalled();
  });
});
