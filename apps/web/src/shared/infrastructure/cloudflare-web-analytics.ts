import { isAnalyticsPublicRoute } from "./analytics-route-policy";

const SCRIPT_ID = "rhasia-cloudflare-web-analytics";
const SCRIPT_URL = "https://static.cloudflareinsights.com/beacon.min.js";

export function initializeCloudflareWebAnalytics(token: string | undefined): void {
  const publicToken = token?.trim();
  if (!publicToken || !isCurrentRoutePublic() || document.getElementById(SCRIPT_ID)) return;

  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.type = "module";
  script.src = SCRIPT_URL;
  script.async = true;
  script.dataset.cfBeacon = JSON.stringify({ token: publicToken, spa: false });
  document.head.append(script);
}

function isCurrentRoutePublic(): boolean {
  return typeof window !== "undefined" && isAnalyticsPublicRoute(window.location.pathname);
}
