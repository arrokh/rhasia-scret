// @vitest-environment jsdom

import { readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_EVENTS, sanitizeAnalyticsCapture } from "@/shared/infrastructure/browser-analytics-config";
import type { BROWSER_ANALYTICS_CONFIG } from "@/shared/infrastructure/browser-analytics-config";
import {
  isAnalyticsPublicRoute,
  requiresAnalyticsDocumentNavigation,
} from "@/shared/infrastructure/analytics-route-policy";
import type { BrowserAnalyticsRuntimeConfiguration } from "@/shared/infrastructure/browser-analytics-runtime-config";

const posthogMocks = vi.hoisted(() => ({
  capture: vi.fn(),
  identify: vi.fn(),
  init: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("posthog-js/dist/module.full.no-external", () => ({ default: posthogMocks }));

const POSTHOG_CONFIGURATION: BrowserAnalyticsRuntimeConfiguration = {
  posthogProjectToken: "phc_test_project_token",
  posthogHost: "https://us.i.posthog.test",
};

type AnalyticsInitOptions = {
  autocapture?: {
    url_ignorelist?: RegExp[];
    dom_event_allowlist?: string[];
    element_allowlist?: string[];
    css_selector_ignorelist?: string[];
    element_attribute_ignorelist?: string[];
    capture_copied_text?: boolean;
  };
  capture_pageview?: boolean | "history_change";
  capture_pageleave?: boolean;
  capture_dead_clicks?: boolean;
  capture_heatmaps?: boolean;
  capture_performance?:
    | boolean
    | {
        web_vitals?: boolean;
        web_vitals_allowed_metrics?: string[];
        web_vitals_delayed_flush_ms?: number;
        web_vitals_attribution?: boolean;
        network_timing?: boolean;
      };
  capture_exceptions?:
    | boolean
    | {
        capture_unhandled_errors?: boolean;
        capture_unhandled_rejections?: boolean;
        capture_console_errors?: boolean;
      };
  error_tracking?: {
    captureExtensionExceptions?: boolean;
    exception_steps?: { enabled?: boolean };
  };
  disable_session_recording?: boolean;
  disable_surveys?: boolean;
  disable_persistence?: boolean;
  persistence_name?: string;
  disable_capture_url_hashes?: boolean;
  save_referrer?: boolean;
  save_campaign_params?: boolean;
  mask_all_text?: boolean;
  mask_all_element_attributes?: boolean;
  mask_personal_data_properties?: boolean;
  custom_personal_data_properties?: string[];
  person_profiles?: string;
  respect_dnt?: boolean;
  advanced_disable_flags?: boolean;
  disable_web_experiments?: boolean;
  disable_product_tours?: boolean;
  disable_conversations?: boolean;
  disable_external_dependency_loading?: boolean;
  logs?: { captureConsoleLogs?: boolean };
  loaded?: (client: typeof posthogMocks) => void;
  before_send?: typeof BROWSER_ANALYTICS_CONFIG.before_send;
};

describe("browser analytics", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("initializes PostHog without identifying users or emitting product events", async () => {
    const { initializeBrowserAnalytics } = await import("@/shared/infrastructure/browser-analytics");

    initializeBrowserAnalytics(POSTHOG_CONFIGURATION);
    initializeBrowserAnalytics(POSTHOG_CONFIGURATION);

    await vi.waitFor(() => expect(posthogMocks.init).toHaveBeenCalledOnce());
    const options = posthogMocks.init.mock.calls[0]?.[1] as AnalyticsInitOptions;
    expect(options.autocapture).toMatchObject({
      dom_event_allowlist: ["click", "submit"],
      element_allowlist: ["a", "button"],
      capture_copied_text: false,
    });
    expect(options.autocapture?.url_ignorelist?.some((pattern) => pattern.test("/account/delete"))).toBe(true);
    expect(options).toMatchObject({
      capture_pageview: "history_change",
      capture_pageleave: true,
      capture_dead_clicks: true,
      capture_heatmaps: false,
      capture_performance: {
        web_vitals: true,
        web_vitals_allowed_metrics: ["LCP", "CLS", "FCP", "INP"],
        web_vitals_delayed_flush_ms: 5_000,
        web_vitals_attribution: false,
        network_timing: false,
      },
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      error_tracking: { captureExtensionExceptions: false, exception_steps: { enabled: false } },
      disable_session_recording: true,
      disable_surveys: true,
      disable_persistence: true,
      persistence_name: "rhasia_scret_posthog",
      disable_capture_url_hashes: true,
      save_referrer: false,
      save_campaign_params: false,
      mask_all_text: true,
      mask_all_element_attributes: true,
      mask_personal_data_properties: true,
      custom_personal_data_properties: ["email", "token", "secret", "passphrase", "password", "otp", "code"],
      person_profiles: "identified_only",
      respect_dnt: true,
      advanced_disable_flags: true,
      disable_web_experiments: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_external_dependency_loading: true,
      logs: { captureConsoleLogs: false },
    });
    expect(options.loaded).toBeTypeOf("function");
    options.loaded?.(posthogMocks);
    expect(posthogMocks.reset).toHaveBeenCalledExactlyOnceWith(true);
    expect(options.before_send).toBeTypeOf("function");
    expect(posthogMocks.capture).not.toHaveBeenCalled();
    expect(posthogMocks.identify).not.toHaveBeenCalled();
  });

  it("preserves PostHog's required ingestion token while sanitizing captures", () => {
    const capture = sanitizeAnalyticsCapture({
      uuid: "capture-token-test-uuid",
      event: "$pageview",
      properties: {
        token: "phc_test_project_token",
        distinct_id: "anonymous-test-id",
        $current_url: "https://vault.example.test/?secret=hidden#key",
        email: "alice@example.test",
      },
    });

    expect(capture?.properties).toEqual({
      token: "phc_test_project_token",
      distinct_id: "anonymous-test-id",
      $current_url: "https://vault.example.test/",
    });
  });

  it("retains the typed product event catalog but drops product captures on public routes", () => {
    expect(Object.values(ANALYTICS_EVENTS)).toContain("authentication_sign_in_link_requested");
    expect(Object.values(ANALYTICS_EVENTS)).toContain("authentication_session_established");
    expect(Object.values(ANALYTICS_EVENTS)).toContain("shared_vault_operation_failed");
    expect(Object.values(ANALYTICS_EVENTS)).toContain("local_vault_archive_import_completed");

    const capture = sanitizeAnalyticsCapture({
      uuid: "aggregate-event-test-uuid",
      event: ANALYTICS_EVENTS.vaultUnlockFailed,
      properties: {
        method: "passkey",
        failure_code: "passkey_error",
        $current_url: "https://vault.example.test/",
      },
    });
    expect(capture).toBeNull();
  });

  it("keeps error properties only on bounded explicit error events", () => {
    const automaticException = sanitizeAnalyticsCapture({
      uuid: "automatic-exception-test-uuid",
      event: "$exception",
      properties: {
        error_name: "Error: alice@example.test",
        error_digest: "https://example.test/?secret=private",
        safe_number: 1,
      },
    });
    expect(automaticException?.properties).toEqual({});

    const explicitError = sanitizeAnalyticsCapture({
      uuid: "explicit-error-test-uuid",
      event: ANALYTICS_EVENTS.clientError,
      properties: {
        error_name: "Error: alice@example.test",
        error_digest: "https://example.test/?secret=private",
      },
    });
    expect(explicitError?.properties).toEqual({ error_name: "Error", error_digest: "unknown" });
  });

  it("drops automatic events on private routes and removes sensitive automatic properties", () => {
    const privateCapture = sanitizeAnalyticsCapture({
      uuid: "capture-test-uuid",
      event: "$autocapture",
      properties: {
        $current_url: "https://vault.example.test/vaults/cuid-private?tab=accounts#secret",
        $el_text: "Alice",
        email: "alice@example.test",
        safe_number: 1,
      },
    });
    expect(privateCapture).toBeNull();

    const privatePageview = sanitizeAnalyticsCapture({
      uuid: "private-pageview-test-uuid",
      event: "$pageview",
      properties: {
        $current_url: "https://vault.example.test/vaults/cuid-private?tab=accounts#secret",
        $pathname: "/vaults/cuid-private",
        title: "Private Account Label",
        safe_number: 1,
      },
    });
    expect(privatePageview).toBeNull();

    const publicCapture = sanitizeAnalyticsCapture({
      uuid: "pageview-test-uuid",
      event: "$pageview",
      properties: {
        $current_url: "https://vault.example.test/?utm_source=private#fragment",
        $el_text: "Landing",
        email: "alice@example.test",
        $exception: "secret exception details",
        safe_number: 1,
      },
    });
    expect(publicCapture?.properties).toEqual({
      $current_url: "https://vault.example.test/",
    });
  });

  it("drops stale public events after the browser has navigated to a private route", () => {
    window.history.replaceState({}, "", "/vaults/accounts/new");
    const capture = sanitizeAnalyticsCapture({
      uuid: "stale-public-pageview-test",
      event: "$pageview",
      properties: { $current_url: "https://vault.example.test/landing" },
    });

    expect(capture).toBeNull();
  });

  it("keeps only aggregate Web Vitals values", () => {
    const capture = sanitizeAnalyticsCapture({
      uuid: "web-vitals-test-uuid",
      event: "$web_vitals",
      properties: {
        $current_url: "https://vault.example.test/",
        $web_vitals_LCP_value: 1234,
        $web_vitals_CLS_value: 0.04,
        $web_vitals_INP_value: 80,
        $web_vitals_LCP_event: { name: "LCP", navigationURL: "https://vault.example.test/vaults/private-id" },
        email: "alice@example.test",
        $web_vitals_FCP_value: "private",
      },
    });

    expect(capture?.properties).toEqual({
      $current_url: "https://vault.example.test/",
      $web_vitals_LCP_value: 1234,
      $web_vitals_CLS_value: 0.04,
      $web_vitals_INP_value: 80,
    });
  });

  it("retains only a bounded exception type for public error tracking", () => {
    const capture = sanitizeAnalyticsCapture({
      uuid: "exception-redaction-test-uuid",
      event: "$exception",
      properties: {
        $current_url: "https://vault.example.test/",
        $exception_list: [
          {
            type: "TypeError",
            value: "alice@example.test",
            stacktrace: { frames: [{ filename: "https://vault.example.test/private" }] },
          },
        ],
      },
    });

    expect(capture?.properties).toEqual({
      $current_url: "https://vault.example.test/",
      $exception_list: [{ type: "TypeError" }],
    });
  });

  it("drops unknown, product, and identity events on public routes", () => {
    expect(sanitizeAnalyticsCapture({ uuid: "unknown-event", event: "private_event", properties: {} })).toBeNull();
    expect(
      sanitizeAnalyticsCapture({
        uuid: "explicit-redaction-test",
        event: ANALYTICS_EVENTS.vaultUnlocked,
        properties: { method: "passkey", $current_url: "https://vault.example.test/" },
      }),
    ).toBeNull();
    expect(
      sanitizeAnalyticsCapture({
        uuid: "identity-event-test",
        event: "$identify",
        properties: { $current_url: "https://vault.example.test/", distinct_id: "synthetic-user-id" },
      }),
    ).toBeNull();
  });

  it.each([
    ["/", "/"],
    ["/landing", "/landing"],
    ["/privacy", "/privacy"],
    ["/support", "/support"],
  ])("records only the public route structure for %s", (path, expected) => {
    window.history.replaceState({}, "", path);
    for (const event of ["$pageview", "$pageleave", "$web_vitals", "$performance_event"]) {
      const capture = sanitizeAnalyticsCapture({
        uuid: "route-test-uuid",
        event,
        properties: {
          $current_url: `https://vault.example.test${path}?secret=hidden#key`,
          $referrer: `https://vault.example.test${path}?secret=hidden#key`,
          $initial_referrer: `https://vault.example.test${path}?secret=hidden#key`,
          $pathname: path,
        },
      });
      expect(capture?.properties).toEqual({
        $current_url: `https://vault.example.test${expected}`,
        $pathname: expected,
      });
    }
  });

  it("allows analytics only on public App Router pages", () => {
    const pages = readdirSync("src/app", { recursive: true, encoding: "utf8" }).filter(
      (path) => /(?:^|\/)page\.tsx$/.test(path) && !path.includes("["),
    );
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const path = `/${page.replace(/(?:^|\/)page\.tsx$/, "")}`;
      window.history.replaceState({}, "", path);
      const capture = sanitizeAnalyticsCapture({
        uuid: "static-route-inventory-test",
        event: "$pageview",
        properties: { $current_url: `https://vault.example.test${path}`, $pathname: path },
      });
      expect(capture !== null, page).toBe(isAnalyticsPublicRoute(path));
    }
  });

  it("uses document navigation across the public/private boundary and between Cloudflare public pages", () => {
    expect(requiresAnalyticsDocumentNavigation("/landing", "/vaults", false)).toBe(true);
    expect(requiresAnalyticsDocumentNavigation("/vaults", "/privacy", false)).toBe(true);
    expect(requiresAnalyticsDocumentNavigation("/landing", "/support", true)).toBe(true);
    expect(requiresAnalyticsDocumentNavigation("/landing", "/support", false)).toBe(false);
    expect(requiresAnalyticsDocumentNavigation("/vaults", "/vaults/accounts/new", true)).toBe(false);
    expect(requiresAnalyticsDocumentNavigation("/privacy", "/privacy", true)).toBe(false);
  });

  it("removes URL credentials and rejects non-web or malformed URLs", () => {
    const capture = sanitizeAnalyticsCapture({
      uuid: "unsafe-url-test",
      event: "$pageview",
      properties: {
        $current_url: "https://alice:secret@vault.example.test/landing?secret=hidden#key",
        $referrer: "mailto:alice@example.test",
        $initial_referrer: "not a URL",
        $pathname: "//alice:secret@vault.example.test",
      },
    });
    expect(capture?.properties).toEqual({
      $current_url: "https://vault.example.test/landing",
    });
  });

  it("drops raw referrers and campaign values from PostHog pageviews", () => {
    const capture = sanitizeAnalyticsCapture({
      uuid: "attribution-redaction-test",
      event: "$pageview",
      properties: {
        $current_url:
          "https://vault.example.test/landing?utm_source=instagram&utm_medium=paid_social&utm_campaign=cmp_launch_01&email=alice%40example.test",
        $referrer: "https://www.instagram.com/private-profile?private=hidden",
        $initial_referrer: "https://www.instagram.com/private-profile?private=hidden",
        public_source: "referral",
        public_medium: "referral",
      },
    });

    expect(capture?.properties).toEqual({
      $current_url: "https://vault.example.test/landing",
    });

    const unsafeCampaign = sanitizeAnalyticsCapture({
      uuid: "unsafe-campaign-redaction-test",
      event: "$pageview",
      properties: {
        $current_url: "https://vault.example.test/landing?utm_campaign=alice%40example.test",
      },
    });
    expect(unsafeCampaign?.properties).toEqual({
      $current_url: "https://vault.example.test/landing",
    });
  });

  it("drops page and performance events on application routes", () => {
    for (const event of ["$pageview", "$pageleave", "$web_vitals", "$performance_event"]) {
      expect(
        sanitizeAnalyticsCapture({
          uuid: "private-pageview-test",
          event,
          properties: { $current_url: "https://vault.example.test/vaults" },
        }),
      ).toBeNull();
    }
  });

  it.each([
    "/vaults",
    "/vaults/manage/personal",
    "/vaults/manage/private-id",
    "/local",
    "/offline",
    "/sign-in",
    "/totp",
    "/auth/confirm",
  ])("still suppresses private interactions on %s", (path) => {
    for (const event of ["$autocapture", "$dead_click", "$exception", "$heatmaps"]) {
      expect(
        sanitizeAnalyticsCapture({
          uuid: "private-interaction-test",
          event,
          properties: { $current_url: `https://vault.example.test${path}`, $el_text: "private content" },
        }),
      ).toBeNull();
    }
  });

  it("transmits only bounded explicit errors from public routes", async () => {
    const { captureAnalyticsError, captureAnalyticsEvent, initializeBrowserAnalytics } =
      await import("@/shared/infrastructure/browser-analytics");

    initializeBrowserAnalytics(POSTHOG_CONFIGURATION);
    captureAnalyticsEvent(ANALYTICS_EVENTS.authenticatorAccountCreated, { vault_type: "PERSONAL" });
    captureAnalyticsError(Object.assign(new Error("synthetic private details"), { digest: "synthetic-digest" }));

    await vi.waitFor(() =>
      expect(posthogMocks.capture).toHaveBeenCalledWith(ANALYTICS_EVENTS.clientError, {
        error_name: "Error",
        error_digest: "synthetic-digest",
      }),
    );
    expect(posthogMocks.capture).not.toHaveBeenCalledWith(ANALYTICS_EVENTS.authenticatorAccountCreated, {
      vault_type: "PERSONAL",
    });
    expect(posthogMocks.init).toHaveBeenCalledOnce();
  });

  it("does not initialize, identify, or capture analytics on an application route", async () => {
    window.history.replaceState({}, "", "/vaults");
    const { captureAnalyticsEvent, initializeBrowserAnalytics } =
      await import("@/shared/infrastructure/browser-analytics");

    initializeBrowserAnalytics(POSTHOG_CONFIGURATION);
    captureAnalyticsEvent(ANALYTICS_EVENTS.vaultUnlocked, { method: "passphrase" });
    await Promise.resolve();

    expect(posthogMocks.init).not.toHaveBeenCalled();
    expect(posthogMocks.identify).not.toHaveBeenCalled();
    expect(posthogMocks.capture).not.toHaveBeenCalled();
  });

  it("does not identify the application user on public routes", async () => {
    const { captureAnalyticsError, initializeBrowserAnalytics } =
      await import("@/shared/infrastructure/browser-analytics");

    initializeBrowserAnalytics(POSTHOG_CONFIGURATION);
    captureAnalyticsError(new Error("synthetic public page error"));

    await vi.waitFor(() => expect(posthogMocks.capture).toHaveBeenCalledOnce());
    expect(posthogMocks.identify).not.toHaveBeenCalled();
  });

  it("normalizes error boundary properties before capture", async () => {
    const { captureAnalyticsError, initializeBrowserAnalytics } =
      await import("@/shared/infrastructure/browser-analytics");
    const error = Object.assign(new Error("private details"), {
      name: "Error: alice@example.test",
      digest: "https://example.test/?secret=private",
    });

    initializeBrowserAnalytics(POSTHOG_CONFIGURATION);
    captureAnalyticsError(error);

    await vi.waitFor(() =>
      expect(posthogMocks.capture).toHaveBeenCalledWith(ANALYTICS_EVENTS.clientError, {
        error_name: "Error",
        error_digest: "unknown",
      }),
    );
  });

  it("stays disabled when public PostHog configuration is incomplete", async () => {
    const { initializeBrowserAnalytics } = await import("@/shared/infrastructure/browser-analytics");

    initializeBrowserAnalytics({ posthogProjectToken: "", posthogHost: POSTHOG_CONFIGURATION.posthogHost });
    await Promise.resolve();

    expect(posthogMocks.init).not.toHaveBeenCalled();
    expect(posthogMocks.capture).not.toHaveBeenCalled();
  });
});
