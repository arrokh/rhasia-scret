"use client";

import { useTranslations } from "next-intl";

export function SectionLoadingPlaceholder({
  rows = 3,
  className = "",
  label,
}: {
  rows?: number;
  className?: string;
  label?: string;
}) {
  const t = useTranslations("Navigation");
  const accessibleLabel = label ?? t("loadingPage");
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={accessibleLabel}
      className={`grid animate-pulse gap-3 motion-reduce:animate-none ${className}`.trim()}
    >
      <span className="sr-only">{accessibleLabel}</span>
      <LoadingPlaceholderRows rows={rows} />
    </div>
  );
}

export function LoadingPlaceholderRows({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="grid gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="grid min-h-16 gap-2 rounded-md border bg-muted/30 p-3">
          <div className="h-4 w-2/5 rounded bg-muted" />
          <div className="h-3 w-4/5 rounded bg-muted/80" />
        </div>
      ))}
    </div>
  );
}

export function DirectoryPlaceholderContent({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="grid gap-5">
      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <div className="h-7 w-32 rounded bg-muted" />
          <div className="mt-1 h-5 w-48 rounded bg-muted/80" />
        </div>
        <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 sm:flex sm:shrink-0">
          <div className="size-12 rounded-md bg-muted" />
          <div className="size-12 rounded-md bg-muted" />
          <div className="h-12 w-full rounded-md bg-muted sm:w-36" />
        </div>
      </div>
      <LoadingPlaceholderRows rows={rows} />
    </div>
  );
}

export function DirectoryLoadingPlaceholder({ rows = 3 }: { rows?: number }) {
  const t = useTranslations("Navigation");
  const accessibleLabel = t("loadingPage");
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={accessibleLabel}
      className="animate-pulse motion-reduce:animate-none"
    >
      <span className="sr-only">{accessibleLabel}</span>
      <DirectoryPlaceholderContent rows={rows} />
    </div>
  );
}

export function FormLoadingPlaceholder({ fields = 3 }: { fields?: number }) {
  const t = useTranslations("Navigation");
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={t("loadingPage")}
      className="grid animate-pulse gap-3 rounded-md border bg-muted/30 p-4 motion-reduce:animate-none"
    >
      <span className="sr-only">{t("loadingPage")}</span>
      <div aria-hidden="true" className="h-5 w-48 rounded bg-muted" />
      <div aria-hidden="true" className="h-3 w-4/5 rounded bg-muted/80" />
      <div aria-hidden="true" className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: fields }, (_, index) => (
          <div key={index} className="h-20 rounded-md bg-card" />
        ))}
      </div>
    </div>
  );
}

export function ActionLoadingPlaceholder() {
  return (
    <span aria-hidden="true" className="block size-12 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
  );
}
