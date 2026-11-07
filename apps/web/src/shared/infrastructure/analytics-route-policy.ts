const ANALYTICS_PUBLIC_ROUTES = new Set(["/", "/landing", "/privacy", "/support"]);

export function isAnalyticsPublicRoute(pathname: string): boolean {
  return ANALYTICS_PUBLIC_ROUTES.has(pathname);
}

export function requiresAnalyticsDocumentNavigation(
  sourcePath: string,
  destinationPath: string,
  cloudflareWebAnalyticsEnabled: boolean,
): boolean {
  const sourceIsPublic = isAnalyticsPublicRoute(sourcePath);
  return (
    sourceIsPublic !== isAnalyticsPublicRoute(destinationPath) ||
    (cloudflareWebAnalyticsEnabled && sourceIsPublic && sourcePath !== destinationPath)
  );
}
