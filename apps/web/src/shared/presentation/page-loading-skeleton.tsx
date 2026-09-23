"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { AppPage, SurfaceCard, SURFACE_CARD_CONTENT_PADDING_CLASS } from "./app-ui";
import { DirectoryPlaceholderContent } from "./loading-placeholder";

type PageLoadingSkeletonProps = {
  showBackButton?: boolean;
  contentSkeleton?: "summary" | "directory";
};

export function PageLoadingSkeleton({
  showBackButton = false,
  contentSkeleton = "summary",
}: PageLoadingSkeletonProps = {}) {
  const t = useTranslations("Navigation");
  return (
    <AppPage>
      <div role="status" aria-live="polite" aria-label={t("loadingPage")} className="animate-pulse">
        <span className="sr-only">{t("loadingPage")}</span>
        <div className="mb-6 flex items-start justify-between gap-3 sm:gap-4" aria-hidden="true">
          <div className="flex min-w-0 items-start gap-2 sm:gap-3">
            {showBackButton && (
              <div data-slot="page-loading-back-action" className="size-12 shrink-0 rounded-md bg-muted" />
            )}
            <div className="grid min-w-0 flex-1 gap-1.5">
              <div className="h-7 w-48 rounded-md bg-muted sm:h-8" />
              <div className="h-12 w-full max-w-md rounded bg-muted sm:h-6" />
            </div>
          </div>
          <div className="size-12 shrink-0 rounded-md bg-muted" />
        </div>
        <SurfaceCard
          aria-hidden="true"
          className={
            contentSkeleton === "directory"
              ? SURFACE_CARD_CONTENT_PADDING_CLASS
              : cn("grid gap-4", SURFACE_CARD_CONTENT_PADDING_CLASS)
          }
        >
          {contentSkeleton === "directory" ? (
            <DirectoryPlaceholderContent rows={3} />
          ) : (
            <>
              <div className="h-12 rounded-md bg-muted" />
              <div className="h-24 rounded-md bg-muted/80" />
              <div className="h-24 rounded-md bg-muted/80" />
            </>
          )}
        </SurfaceCard>
      </div>
    </AppPage>
  );
}
