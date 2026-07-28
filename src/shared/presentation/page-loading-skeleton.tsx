"use client";

import { useTranslations } from "next-intl";
import { AppPage, SurfaceCard } from "./app-ui";

export function PageLoadingSkeleton() {
  const t = useTranslations("Navigation");
  return (
    <AppPage>
      <div role="status" aria-live="polite" aria-label={t("loadingPage")} className="animate-pulse">
        <span className="sr-only">{t("loadingPage")}</span>
        <div className="mb-6 flex items-start justify-between gap-4" aria-hidden="true">
          <div className="grid flex-1 gap-2">
            <div className="h-7 w-48 rounded-md bg-muted" />
            <div className="h-4 w-full max-w-md rounded bg-muted" />
          </div>
          <div className="size-10 rounded-md bg-muted" />
        </div>
        <SurfaceCard aria-hidden="true" className="grid gap-4 p-5 sm:p-6">
          <div className="h-12 rounded-md bg-muted" />
          <div className="h-24 rounded-md bg-muted/80" />
          <div className="h-24 rounded-md bg-muted/80" />
        </SurfaceCard>
      </div>
    </AppPage>
  );
}
