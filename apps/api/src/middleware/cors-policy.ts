export const API_CORS_ALLOW_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"] as const;
export const API_CORS_ALLOW_HEADERS = [
  "content-type",
  "authorization",
  "if-none-match",
  "if-match",
  "x-request-id",
] as const;
export const API_CORS_EXPOSE_HEADERS = ["etag", "last-modified", "x-request-id", "retry-after"] as const;
export const API_CORS_MAX_AGE_SECONDS = 600;

export const API_CORS_ALLOW_METHODS_VALUE = API_CORS_ALLOW_METHODS.join(",");
export const API_CORS_ALLOW_HEADERS_VALUE = API_CORS_ALLOW_HEADERS.join(",");
export const API_CORS_EXPOSE_HEADERS_VALUE = API_CORS_EXPOSE_HEADERS.join(",");

export function isAllowedApiOrigin(origin: string | undefined, configuredOrigin: string | undefined): boolean {
  return Boolean(origin && configuredOrigin && origin === configuredOrigin);
}
