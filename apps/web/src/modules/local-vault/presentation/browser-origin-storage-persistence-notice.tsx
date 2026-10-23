"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { useBrowserOriginStoragePersistence } from "./hooks/use-browser-origin-storage-persistence";

const statusMessage = {
  checking: "checking",
  not_granted: "notGranted",
  already_granted: "alreadyGranted",
  granted: "granted",
  denied: "denied",
  unavailable: "unavailable",
  error: "error",
} as const;

export function BrowserOriginStoragePersistenceNotice() {
  const t = useTranslations("LocalVault.browserStorage");
  const { status, requesting, request } = useBrowserOriginStoragePersistence();
  const tone = status === "denied" || status === "error" ? "warning" : "info";
  const canRequest = status === "not_granted" || status === "denied" || status === "error";

  return (
    <div className="mb-5" data-storage-persistence={status}>
      <StatusBanner tone={tone} title={t("title")} role="status">
        <div className="grid gap-3">
          <span className="block">{t("description")}</span>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0 flex-1">{t(statusMessage[status])}</span>
            {canRequest && (
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={requesting}
                aria-busy={requesting}
                onClick={() => void request()}
              >
                {requesting ? t("requesting") : t("request")}
              </Button>
            )}
          </div>
        </div>
      </StatusBanner>
    </div>
  );
}
