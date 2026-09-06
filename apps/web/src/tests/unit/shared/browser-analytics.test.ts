import { readdirSync } from "node:fs";
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
  capture_pageview?: boolean | "history_change";
  capture_pageleave?: boolean;
  capture_dead_clicks?: boolean;
  capture_heatmaps?: boolean;
  capture_performance?: boolean;
  capture_exceptions?: boolean;
  disable_session_recording?: boolean;
  disable_surveys?: boolean;
  disable_persistence?: boolean;
  persistence_name?: string;
  disable_capture_url_hashes?: boolean;
  save_referrer?: boolean;
  save_campaign_params?: boolean;
  mask_all_text?: boolean;
  mask_all_element_attributes?: boolean;
  respect_dnt?: boolean;
  advanced_disable_flags?: boolean;
  disable_web_experiments?: boolean;
  disable_product_tours?: boolean;
  disable_conversations?: boolean;
  disable_external_dependency_loading?: boolean;
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
      capture_pageview: "history_change",
      capture_pageleave: true,
      capture_dead_clicks: true,
      capture_heatmaps: false,
      capture_performance: true,
      capture_exceptions: true,
      disable_session_recording: true,
      disable_surveys: true,
      disable_persistence: true,
      persistence_name: "rhasia_scret_posthog",
      disable_capture_url_hashes: true,
      save_referrer: false,
      save_campaign_params: false,
      mask_all_text: true,
      mask_all_element_attributes: true,
      respect_dnt: true,
      advanced_disable_flags: true,
      disable_web_experiments: true,
      disable_product_tours: true,
      disable_conversations: true,
      disable_external_dependency_loading: true
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

  it("keeps the product event catalog aggregate-only", () => {
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
        operation: "unlock",
        participant_type: "member",
        email: "alice@example.test",
        vault_id: "vault-private-id"
      }
    });

    expect(capture?.properties).toEqual({
      method: "passkey",
      failure_code: "passkey_error",
      operation: "unlock",
      participant_type: "member"
    });
  });

  it("keeps error properties only on bounded explicit error events", () => {
    const automaticException = sanitizeAnalyticsCapture({
      uuid: "automatic-exception-test-uuid",
      event: "$exception",
      properties: {
        error_name: "Error: alice@example.test",
        error_digest: "https://example.test/?secret=private",
        safe_number: 1
      }
    });
    expect(automaticException?.properties).toEqual({ safe_number: 1 });

    const explicitError = sanitizeAnalyticsCapture({
      uuid: "explicit-error-test-uuid",
      event: ANALYTICS_EVENTS.clientError,
      properties: {
        error_name: "Error: alice@example.test",
        error_digest: "https://example.test/?secret=private"
      }
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
      $current_url: "https://vault.example.test/vaults/[redacted]",
      $pathname: "/vaults/[redacted]",
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

  it.each([
    ["/", "/"],
    ["/vaults", "/vaults"],
    ["/vaults/accounts/new", "/vaults/accounts/new"],
    ["/vaults/manage/personal", "/vaults/manage/personal"],
    ["/vaults/manage/new", "/vaults/manage/new"],
    ["/vaults/manage/cms1btg0p00wt9spon6tz59d4", "/vaults/manage/[redacted]"],
    ["/vaults/manage/personal-id/secret", "/vaults/manage/[redacted]/[redacted]"],
    ["/vaults/manage/%61lice%40example.test", "/vaults/manage/[redacted]"],
    ["/vaults/invitations/redeem", "/vaults/invitations/redeem"],
    ["/local", "/local"],
    ["/offline", "/offline"],
    ["/totp", "/totp"],
    ["/sign-in", "/sign-in"],
    ["/auth/oidc/callback", "/auth/oidc/callback"],
    ["/ui-preview/vaults", "/ui-preview/vaults"],
    ["/unknown-user-value", "/[redacted]"],
    ["/vaults/manage/new/", "/vaults/manage/new/"]
  ])("records safe route structure for %s", (path, expected) => {
    for (const event of ["$pageview", "$pageleave", "$web_vitals", "$performance_event", ANALYTICS_EVENTS.applicationOpened]) {
      const capture = sanitizeAnalyticsCapture({
        uuid: "route-test-uuid",
        event,
        properties: {
          $current_url: `https://vault.example.test${path}?secret=hidden#key`,
          $referrer: `https://vault.example.test${path}?secret=hidden#key`,
          $initial_referrer: `https://vault.example.test${path}?secret=hidden#key`,
          $pathname: path
        }
      });
      expect(capture?.properties).toEqual({
        $current_url: `https://vault.example.test${expected}`,
        $referrer: `https://vault.example.test${expected}`,
        $initial_referrer: `https://vault.example.test${expected}`,
        $pathname: expected
      });
    }
  });

  it("preserves every current static App Router page", () => {
    const pages = readdirSync("src/app", { recursive: true, encoding: "utf8" })
      .filter((path) => /(?:^|\/)page\.tsx$/.test(path) && !path.includes("["));
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      const path = `/${page.replace(/(?:^|\/)page\.tsx$/, "")}`;
      const capture = sanitizeAnalyticsCapture({
        uuid: "static-route-inventory-test",
        event: "$pageview",
        properties: { $pathname: path }
      });
      expect(capture?.properties.$pathname, page).toBe(path);
    }
  });

  it("removes URL credentials and rejects non-web or malformed URLs", () => {
    const capture = sanitizeAnalyticsCapture({
      uuid: "unsafe-url-test",
      event: "$pageview",
      properties: {
        $current_url: "https://alice:secret@vault.example.test/vaults?secret=hidden#key",
        $referrer: "mailto:alice@example.test",
        $initial_referrer: "not a URL",
        $pathname: "//alice:secret@vault.example.test"
      }
    });
    expect(capture?.properties).toEqual({ $current_url: "https://vault.example.test/vaults" });
  });

  it.each(["/vaults", "/vaults/manage/personal", "/vaults/manage/private-id", "/local", "/offline", "/sign-in", "/totp", "/auth/confirm"])("still suppresses private interactions on %s", (path) => {
    for (const event of ["$autocapture", "$dead_click", "$exception", "$heatmaps"]) {
      expect(sanitizeAnalyticsCapture({
        uuid: "private-interaction-test",
        event,
        properties: { $current_url: `https://vault.example.test${path}`, $el_text: "private content" }
      })).toBeNull();
    }
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

  it("normalizes error boundary properties before capture", async () => {
    const { captureAnalyticsError } = await import("@/shared/infrastructure/browser-analytics");
    const error = Object.assign(new Error("private details"), {
      name: "Error: alice@example.test",
      digest: "https://example.test/?secret=private"
    });

    captureAnalyticsError(error);

    await vi.waitFor(() => expect(posthogMocks.capture).toHaveBeenCalledWith(ANALYTICS_EVENTS.clientError, { error_name: "Error", error_digest: "unknown" }));
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
