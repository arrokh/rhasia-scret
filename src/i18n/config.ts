export const locales = ["id", "en"] as const;
export type AppLocale = (typeof locales)[number];

export const defaultLocale: AppLocale = "id";
export const localeCookieName = "RHSIA_LOCALE";
export const localeCookieMaxAge = 60 * 60 * 24 * 365;

export const formattingLocales: Record<AppLocale, string> = {
  id: "id-ID",
  en: "en-US"
};
export const deterministicTimeZone = "UTC";

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && locales.some((locale) => locale === value);
}

export function resolveLocale(value: unknown): AppLocale {
  return isAppLocale(value) ? value : defaultLocale;
}
