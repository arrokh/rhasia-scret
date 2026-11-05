"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { initializeBrowserAnalytics } from "@/shared/infrastructure/browser-analytics";
import { isAnalyticsPublicRoute } from "@/shared/infrastructure/analytics-route-policy";

export function BrowserAnalyticsBootstrap() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname && isAnalyticsPublicRoute(pathname)) initializeBrowserAnalytics();
  }, [pathname]);

  return null;
}
