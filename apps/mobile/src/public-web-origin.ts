export function readPublicWebOrigin(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error("EXPO_PUBLIC_WEB_ORIGIN is required.");
  const parsed = new URL(normalized);
  if (parsed.protocol !== "https:") throw new Error("EXPO_PUBLIC_WEB_ORIGIN uses an unsupported protocol.");
  if (parsed.username || parsed.password) throw new Error("EXPO_PUBLIC_WEB_ORIGIN must not contain credentials.");
  if (parsed.pathname !== "/" || parsed.search || parsed.hash)
    throw new Error("EXPO_PUBLIC_WEB_ORIGIN must contain only an origin.");
  return parsed.origin;
}
