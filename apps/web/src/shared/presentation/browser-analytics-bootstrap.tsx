"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { initializeBrowserAnalytics } from "@/shared/infrastructure/browser-analytics";
import type { BrowserAnalyticsRuntimeConfiguration } from "@/shared/infrastructure/browser-analytics-runtime-config";
import {
  isAnalyticsPublicRoute,
  requiresAnalyticsDocumentNavigation,
} from "@/shared/infrastructure/analytics-route-policy";
import { initializeCloudflareWebAnalytics } from "@/shared/infrastructure/cloudflare-web-analytics";

export function BrowserAnalyticsBootstrap({ configuration }: { configuration: BrowserAnalyticsRuntimeConfiguration }) {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || !isAnalyticsPublicRoute(pathname)) return;
    initializeBrowserAnalytics(configuration);
    initializeCloudflareWebAnalytics(configuration.cloudflareWebAnalyticsToken);
  }, [configuration, pathname]);

  useEffect(() => {
    if (!pathname) return;
    const cloudflareEnabled = Boolean(configuration.cloudflareWebAnalyticsToken?.trim());
    const posthogEnabled = Boolean(configuration.posthogProjectToken?.trim() && configuration.posthogHost?.trim());
    if (!cloudflareEnabled && !posthogEnabled) return;

    const handleAnalyticsBoundaryNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link || (link.target && link.target.toLowerCase() !== "_self") || link.hasAttribute("download")) return;

      const destination = new URL(link.href);
      if (destination.origin !== window.location.origin) return;
      if (!requiresAnalyticsDocumentNavigation(pathname, destination.pathname, cloudflareEnabled)) return;

      event.preventDefault();
      window.location.assign(destination.href);
    };

    document.addEventListener("click", handleAnalyticsBoundaryNavigation, true);
    return () => document.removeEventListener("click", handleAnalyticsBoundaryNavigation, true);
  }, [
    configuration.cloudflareWebAnalyticsToken,
    configuration.posthogHost,
    configuration.posthogProjectToken,
    pathname,
  ]);

  return null;
}
