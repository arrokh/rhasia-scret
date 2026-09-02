"use client";

import { useEffect } from "react";
import { initializeBrowserAnalytics } from "@/shared/infrastructure/browser-analytics";

export function BrowserAnalyticsBootstrap() {
  useEffect(() => {
    initializeBrowserAnalytics();
  }, []);

  return null;
}
