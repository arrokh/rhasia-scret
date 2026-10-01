export function parseCanonicalOrigin(value) {
  if (typeof value !== "string") return undefined;
  try {
    const origin = new URL(value);
    if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) return undefined;
    return origin;
  } catch {
    return undefined;
  }
}
