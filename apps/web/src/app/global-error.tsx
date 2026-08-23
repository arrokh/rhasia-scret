"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type enMessages from "../../messages/en.json";
import { defaultLocale, localeCookieName, resolveLocale, type AppLocale } from "@/i18n/config";
import { captureAnalyticsError } from "@/shared/infrastructure/browser-analytics";

type GlobalErrorCopy = (typeof enMessages)["Common"]["globalError"];

export default function GlobalError({
  error,
  reset
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  const locale = useSyncExternalStore(noopSubscribe, readLocaleCookie, () => defaultLocale);
  const [copy, setCopy] = useState<GlobalErrorCopy>();

  useEffect(() => {
    document.documentElement.lang = locale;
    let active = true;
    const messages = locale === "id" ? import("../../messages/id.json") : import("../../messages/en.json");
    void messages.then(({ default: catalog }) => {
      if (active) setCopy(catalog.Common.globalError);
    });
    return () => {
      active = false;
    };
  }, [locale]);

  useEffect(() => {
    captureAnalyticsError(error);
  }, [error]);

  return (
    <html lang={locale}>
      <body>
        <main aria-busy={!copy}>
          {copy && <><h1>{copy.title}</h1><p>{copy.description}</p><button type="button" onClick={reset}>{copy.retry}</button></>}
        </main>
      </body>
    </html>
  );
}

function noopSubscribe() {
  return () => undefined;
}

function readLocaleCookie(): AppLocale {
  const cookie = document.cookie.split("; ").find((entry) => entry.startsWith(`${localeCookieName}=`));
  return resolveLocale(cookie?.slice(localeCookieName.length + 1));
}
