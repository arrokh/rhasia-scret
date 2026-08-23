"use client";

import type { BeforeSendFn } from "posthog-js";

type AnalyticsProperties = Record<string, string | number | boolean>;
type PostHogClient = typeof import("posthog-js").default;

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
let posthogPromise: Promise<PostHogClient | null> | undefined;

const sanitizeEventUrls: BeforeSendFn = (capture) => {
  if (!capture) return null;
  for (const property of ["$current_url", "$referrer", "$initial_referrer"]) {
    const value = capture.properties[property];
    if (typeof value !== "string") continue;
    try {
      const url = new URL(value);
      url.search = "";
      url.hash = "";
      capture.properties[property] = url.toString();
    } catch {
      delete capture.properties[property];
    }
  }
  return capture;
};

export function initializeBrowserAnalytics(): void {
  void loadPostHog();
}

export function identifyAnalyticsUser(userId: string): void {
  void loadPostHog().then((posthog) => posthog?.identify(userId));
}

export function captureAnalyticsEvent(event: string, properties?: AnalyticsProperties): void {
  void loadPostHog().then((posthog) => posthog?.capture(event, properties));
}

export function resetAnalytics(): void {
  void loadPostHog().then((posthog) => posthog?.reset());
}

export function captureAnalyticsError(error: Error & { digest?: string }): void {
  captureAnalyticsEvent("client_error", { error_name: error.name, error_digest: error.digest ?? "unknown" });
}

function loadPostHog(): Promise<PostHogClient | null> {
  if (!projectToken || !posthogHost) return Promise.resolve(null);
  posthogPromise ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(projectToken, {
      api_host: posthogHost,
      defaults: "2026-01-30",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      capture_performance: false,
      capture_exceptions: false,
      before_send: sanitizeEventUrls,
      disable_session_recording: true,
      disable_surveys: true,
      disable_persistence: true,
      mask_all_text: true,
      mask_all_element_attributes: true,
      respect_dnt: true,
      debug: process.env.NODE_ENV === "development"
    });
    return posthog;
  }).catch(() => null);
  return posthogPromise;
}
