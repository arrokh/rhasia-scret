"use client";

import type { BeforeSendFn, PostHogConfig } from "posthog-js";

/**
 * Automatic capture is enabled only with the safeguards below: private routes
 * expose only redacted page/performance events, DOM interaction capture is
 * ignored there, copied text is disabled, and before_send drops sensitive
 * fields before anything leaves the browser. Persistence is session-only and
 * excludes referrer/campaign data.
 */
export const ANALYTICS_EVENTS = {
  applicationOpened: "application_opened",
  authenticatorAccountCreated: "authenticator_account_created",
  authenticatorAccountUpdated: "authenticator_account_updated",
  authenticatorAccountDeleted: "authenticator_account_deleted",
  secureShareLinkRedeemed: "secure_share_link_redeemed",
  personalVaultResetCompleted: "personal_vault_reset_completed",
  vaultArchiveExportPrepared: "vault_archive_export_prepared",
  vaultArchiveImportCompleted: "vault_archive_import_completed",
  passkeyRecoveryEnabled: "passkey_recovery_enabled",
  passkeyRecoveryResetCompleted: "passkey_recovery_reset_completed",
  clientError: "client_error"
} as const;

export type AnalyticsEventName = keyof AnalyticsEventProperties;
type AnalyticsVaultType = "PERSONAL" | "SHARED";

type AnalyticsEventProperties = {
  application_opened: undefined;
  authenticator_account_created: { vault_type: AnalyticsVaultType };
  authenticator_account_updated: { vault_type: AnalyticsVaultType };
  authenticator_account_deleted: { vault_type: AnalyticsVaultType };
  secure_share_link_redeemed: undefined;
  personal_vault_reset_completed: undefined;
  vault_archive_export_prepared: { vault_type: AnalyticsVaultType };
  vault_archive_import_completed: {
    account_count: number;
    destination_type: AnalyticsVaultType;
    created_new_vault: boolean;
  };
  passkey_recovery_enabled: undefined;
  passkey_recovery_reset_completed: undefined;
  client_error: { error_name: string; error_digest: string };
};

export type AnalyticsEventPropertiesFor<Name extends AnalyticsEventName> = AnalyticsEventProperties[Name];

const SANITIZED_URL_PROPERTIES = ["$current_url", "$referrer", "$initial_referrer"] as const;
const PRIVATE_ROUTE_PREFIXES = ["/auth", "/local", "/offline", "/sign-in", "/totp", "/vaults"] as const;
const AUTOMATIC_CAPTURE_PROPERTY_PATTERN = /(?:account|attr|cipher|content|cookie|description|email|error|exception|hash|href|input|issuer|key|label|message|name|otp|passphrase|password|path|plain|private|qr|query|referrer|secret|stack|text|title|token|trace|url|value|vault)/i;
const SAFE_ANALYTICS_PROPERTY_KEYS = new Set([
  "account_count",
  "created_new_vault",
  "destination_type",
  "error_digest",
  "error_name",
  "vault_type"
]);
const PRIVATE_ROUTE_ALLOWED_AUTOMATIC_EVENTS = new Set(["$pageview", "$pageleave", "$web_vitals", "$performance_event"]);

export function sanitizeAnalyticsCapture(capture: Parameters<BeforeSendFn>[0]): Parameters<BeforeSendFn>[0] {
  if (!capture) return null;
  const automaticCapture = capture.event.startsWith("$") && capture.event !== "$identify";
  const privateRoute = isPrivateRoute(getAnalyticsPath(capture));
  for (const property of Object.keys(capture.properties)) {
    const value = capture.properties[property];
    if (SANITIZED_URL_PROPERTIES.includes(property as (typeof SANITIZED_URL_PROPERTIES)[number])) {
      if (typeof value !== "string") { delete capture.properties[property]; continue; }
      try {
        capture.properties[property] = sanitizeAnalyticsUrl(value);
      } catch {
        delete capture.properties[property];
      }
      continue;
    }
    if (property.startsWith("$el_") || AUTOMATIC_CAPTURE_PROPERTY_PATTERN.test(property) && !SAFE_ANALYTICS_PROPERTY_KEYS.has(property) || typeof value === "object") delete capture.properties[property];
  }
  if (automaticCapture && privateRoute && !PRIVATE_ROUTE_ALLOWED_AUTOMATIC_EVENTS.has(capture.event)) return null;
  return capture;
}

const sanitizeAnalyticsUrls: BeforeSendFn = sanitizeAnalyticsCapture;

function sanitizeAnalyticsUrl(value: string): string {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  if (isPrivateRoute(url.pathname)) url.pathname = "/[private]";
  return url.toString();
}

function getAnalyticsPath(capture: NonNullable<Parameters<BeforeSendFn>[0]>): string {
  const currentUrl = capture.properties.$current_url;
  if (typeof currentUrl === "string") {
    try { return new URL(currentUrl).pathname; } catch { return ""; }
  }
  return typeof window === "undefined" ? "" : window.location.pathname;
}

function isPrivateRoute(pathname: string): boolean {
  return PRIVATE_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export const BROWSER_ANALYTICS_CONFIG = {
  defaults: "2026-01-30",
  autocapture: {
    url_ignorelist: [/\/(?:auth|local|offline|sign-in|totp|vaults)(?:\/|$)/],
    dom_event_allowlist: ["click", "submit"],
    element_allowlist: ["a", "button"],
    css_selector_ignorelist: [".ph-no-capture", "[data-ph-no-capture]"],
    element_attribute_ignorelist: ["aria-label", "data-slot", "data-testid", "for", "href", "id", "name", "placeholder", "title", "value"],
    capture_copied_text: false
  },
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
  respect_dnt: true,
  loaded: (posthog) => posthog.capture(ANALYTICS_EVENTS.applicationOpened),
  before_send: sanitizeAnalyticsUrls,
  debug: process.env.NODE_ENV === "development"
} satisfies Partial<PostHogConfig>;
