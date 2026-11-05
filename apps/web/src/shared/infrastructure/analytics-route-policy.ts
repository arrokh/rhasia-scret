const ANALYTICS_PUBLIC_ROUTES = new Set(["/", "/landing", "/privacy", "/support"]);

export function isAnalyticsPublicRoute(pathname: string): boolean {
  return ANALYTICS_PUBLIC_ROUTES.has(pathname);
}
