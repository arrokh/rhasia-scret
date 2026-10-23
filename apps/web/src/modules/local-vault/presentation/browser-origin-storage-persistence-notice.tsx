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
        <p>{t("description")}</p>
        <p className="mt-1">{t(statusMessage[status])}</p>
        {canRequest && (
          <div className="mt-3 flex justify-end">
            <Button type="button" disabled={requesting} aria-busy={requesting} onClick={() => void request()}>
              {requesting ? t("requesting") : t("request")}
            </Button>
          </div>
        )}
      </StatusBanner>
    </div>
  );
}
