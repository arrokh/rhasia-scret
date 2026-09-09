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
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} aria-hidden="true" className="grid min-h-16 gap-2 rounded-md border bg-muted/30 p-3">
          <div className="h-4 w-2/5 rounded bg-muted" />
          <div className="h-3 w-4/5 rounded bg-muted/80" />
        </div>
      ))}
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
    <span aria-hidden="true" className="block size-10 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
  );
}
