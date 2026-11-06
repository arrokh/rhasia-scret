"use client";

import type { AnalyticsEventName, AnalyticsEventPropertiesFor } from "./browser-analytics-config";
import {
  ANALYTICS_EVENTS,
  BROWSER_ANALYTICS_CONFIG,
  normalizeAnalyticsErrorDigest,
  normalizeAnalyticsErrorName,
} from "./browser-analytics-config";
import type { BrowserAnalyticsRuntimeConfiguration } from "./browser-analytics-runtime-config";
import { isAnalyticsPublicRoute } from "./analytics-route-policy";

type PostHogClient = typeof import("posthog-js/dist/module.full.no-external").default;
let posthogPromise: Promise<PostHogClient | null> | undefined;
let activeConfiguration: BrowserAnalyticsRuntimeConfiguration | undefined;

export function initializeBrowserAnalytics(configuration: BrowserAnalyticsRuntimeConfiguration): void {
  if (!isCurrentRoutePublic()) return;
  activeConfiguration = configuration;
  void loadPostHog(configuration);
}

export function captureAnalyticsEvent<EventName extends AnalyticsEventName>(
  event: EventName,
  ...properties: AnalyticsEventPropertiesFor<EventName> extends undefined
    ? []
    : [properties: AnalyticsEventPropertiesFor<EventName>]
): void {
  if (event !== ANALYTICS_EVENTS.clientError || !isCurrentRoutePublic()) return;
  void loadPostHog(activeConfiguration).then((posthog) => posthog?.capture(event, properties[0]));
}

export function resetAnalytics(): void {
  void loadPostHog(activeConfiguration).then((posthog) => posthog?.reset());
}

export function captureAnalyticsError(error: Error & { digest?: string }): void {
  captureAnalyticsEvent(ANALYTICS_EVENTS.clientError, {
    error_name: normalizeAnalyticsErrorName(error.name),
    error_digest: normalizeAnalyticsErrorDigest(error.digest),
  });
}

function loadPostHog(configuration: BrowserAnalyticsRuntimeConfiguration | undefined): Promise<PostHogClient | null> {
  if (!isCurrentRoutePublic()) return Promise.resolve(null);
  const projectToken = configuration?.posthogProjectToken?.trim();
  const posthogHost = configuration?.posthogHost?.trim();
  if (!projectToken || !posthogHost) return Promise.resolve(null);
  activeConfiguration = configuration;
  posthogPromise ??= import("posthog-js/dist/module.full.no-external")
    .then(({ default: posthog }) => {
      posthog.init(projectToken, { api_host: posthogHost, ...BROWSER_ANALYTICS_CONFIG });
      return posthog;
    })
    .catch(() => null);
  return posthogPromise;
}

function isCurrentRoutePublic(): boolean {
  return typeof window !== "undefined" && isAnalyticsPublicRoute(window.location.pathname);
}
