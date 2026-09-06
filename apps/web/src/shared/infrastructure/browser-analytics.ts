"use client";

import type { AnalyticsEventName, AnalyticsEventPropertiesFor } from "./browser-analytics-config";
import {
  ANALYTICS_EVENTS,
  BROWSER_ANALYTICS_CONFIG,
  isAnalyticsEmail,
  normalizeAnalyticsErrorDigest,
  normalizeAnalyticsErrorName
} from "./browser-analytics-config";

type PostHogClient = typeof import("posthog-js").default;
const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;
let posthogPromise: Promise<PostHogClient | null> | undefined;

export function initializeBrowserAnalytics(): void {
  void loadPostHog();
}

export async function identifyAnalyticsUser(userId: string, email: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(userId) || !isAnalyticsEmail(email)) return false;
  const posthog = await loadPostHog();
  if (!posthog) return false;
  posthog.identify(userId, { email });
  return true;
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
    error_name: normalizeAnalyticsErrorName(error.name),
    error_digest: normalizeAnalyticsErrorDigest(error.digest)
  });
}

function loadPostHog(): Promise<PostHogClient | null> {
  if (!projectToken || !posthogHost) return Promise.resolve(null);
  posthogPromise ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(projectToken, { api_host: posthogHost, ...BROWSER_ANALYTICS_CONFIG });
    return posthog;
  }).catch(() => null);
  return posthogPromise;
}
