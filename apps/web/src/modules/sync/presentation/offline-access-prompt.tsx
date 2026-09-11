"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ConfirmationDialog } from "@/shared/presentation/confirmation-dialog";
import { useOnlineStatus } from "@/shared/presentation/use-online-status";
import { offlineNavigationDetectedMessage } from "./service-worker-registration";

export function OfflineAccessPrompt() {
  const pathname = usePathname();
  const router = useRouter();
  const online = useOnlineStatus();
  const t = useTranslations("Sync.offlinePrompt");
  const [dismissed, setDismissed] = useState(false);
  const isLandingPage = pathname === "/";

  useEffect(() => {
    const handleOnline = () => setDismissed(false);
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  useEffect(() => {
    if (!isLandingPage || !navigator.serviceWorker) return;
    const handleMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === offlineNavigationDetectedMessage && !navigator.onLine) setDismissed(false);
    };
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, [isLandingPage]);

  const open = !online && !dismissed && isLandingPage;
  if (!open) return null;

  return (
    <ConfirmationDialog
      title={t("title")}
      description={t("description")}
      confirmLabel={t("confirm")}
      onCancel={() => setDismissed(true)}
      onConfirm={() => {
        setDismissed(true);
        router.push("/offline");
      }}
    />
  );
}
