export const API_VERSION = "v1" as const;
export const API_VERSION_PREFIX = `/${API_VERSION}` as const;

export function apiPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized === API_VERSION_PREFIX || normalized.startsWith(`${API_VERSION_PREFIX}/`)) return normalized;
  return `${API_VERSION_PREFIX}${normalized}`;
}

export function browserApiPath(path: string): string {
  return `/api${apiPath(path)}`;
}

export function isVersionedApiPath(path: string): boolean {
  return path === API_VERSION_PREFIX || path.startsWith(`${API_VERSION_PREFIX}/`);
}
