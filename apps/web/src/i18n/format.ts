import { createFormatter } from "next-intl";
import { deterministicTimeZone, type AppLocale } from "./config";

export function formatLocalDateTime(value: string | Date, locale: AppLocale): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return formatter(locale, timeZone).dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" });
}

export function formatJakartaAuditDateTime(value: string, locale: AppLocale): string {
  return formatter(locale, "Asia/Jakarta").dateTime(new Date(value), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatRelativeDateTime(value: string, locale: AppLocale, now = Date.now()): string {
  return formatter(locale).relativeTime(new Date(value), { now: new Date(now) });
}

function formatter(locale: AppLocale, timeZone = deterministicTimeZone) {
  return createFormatter({ locale, timeZone });
}
