"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { formattingLocales, resolveLocale } from "@/i18n/config";

export function useLandingPhoneClock() {
  const locale = resolveLocale(useLocale());
  const [now, setNow] = useState(() => new Date());
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(formattingLocales[locale], {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    [locale],
  );

  useEffect(() => {
    let intervalId: number | undefined;
    const delayUntilNextMinute = 60_000 - (Date.now() % 60_000);
    const timeoutId = window.setTimeout(() => {
      setNow(new Date());
      intervalId = window.setInterval(() => setNow(new Date()), 60_000);
    }, delayUntilNextMinute);

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, []);

  return formatter.format(now);
}
