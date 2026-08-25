"use client";

import type { AnalyticsEventName, AnalyticsEventPropertiesFor } from "./browser-analytics-config";
import { ANALYTICS_EVENTS, BROWSER_ANALYTICS_CONFIG } from "./browser-analytics-config";

type PostHogClient = typeof import("posthog-js").default;
const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
let posthogPromise: Promise<PostHogClient | null> | undefined;

export function initializeBrowserAnalytics(): void {
  void loadPostHog();
}

export function identifyAnalyticsUser(userId: string): void {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(userId)) return;
  void hashAnalyticsUserId(userId).then((hashedUserId) => {
    if (!hashedUserId) return;
    void loadPostHog().then((posthog) => posthog?.identify(hashedUserId));
  });
}

export function captureAnalyticsEvent<EventName extends AnalyticsEventName>(
  event: EventName,
  ...properties: AnalyticsEventPropertiesFor<EventName> extends undefined
    ? []
    : [properties: AnalyticsEventPropertiesFor<EventName>]
): void {
  void loadPostHog().then((posthog) => posthog?.capture(event, properties[0]));
}

export function resetAnalytics(): void {
  void loadPostHog().then((posthog) => posthog?.reset());
}

export function captureAnalyticsError(error: Error & { digest?: string }): void {
  captureAnalyticsEvent(ANALYTICS_EVENTS.clientError, {
    error_name: error.name,
    error_digest: error.digest ?? "unknown"
  });
}

async function hashAnalyticsUserId(userId: string): Promise<string | null> {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function loadPostHog(): Promise<PostHogClient | null> {
  if (!projectToken || !posthogHost) return Promise.resolve(null);
  posthogPromise ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(projectToken, { api_host: posthogHost, ...BROWSER_ANALYTICS_CONFIG });
    return posthog;
  }).catch(() => null);
  return posthogPromise;
}
