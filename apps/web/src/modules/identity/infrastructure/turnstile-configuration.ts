export function readRuntimeTurnstileSiteKey(): string | undefined {
  const value: unknown = Reflect.get(process.env, "NEXT_PUBLIC_TURNSTILE_SITE_KEY");
  return typeof value === "string" ? value : undefined;
}
