"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";
import { KeyRound, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { redeemSecureShareLink } from "../infrastructure/browser-secure-share-link-workflow";

export function SecureShareLinkRedemption({ userRootKey }: { userRootKey: Uint8Array }) {
  const t = useTranslations("VaultMembership.redemption");
  const secret = useSyncExternalStore(subscribeToHash, readHash, () => "");
  const [status, setStatus] = useState<"idle" | "redeeming" | "error">("idle");
  async function redeem() {
    if (!secret) {
      setStatus("error");
      return;
    }
    setStatus("redeeming");
    try {
      await redeemSecureShareLink(secret, userRootKey);
      captureAnalyticsEvent(ANALYTICS_EVENTS.secureShareLinkRedeemed);
      window.location.assign(new URL("/vaults", window.location.origin).toString());
    } catch {
      setStatus("error");
    }
  }
  return (
    <div className="grid gap-5 p-5 sm:p-6">
      <div className="grid justify-items-center gap-3 text-center">
        <span className="grid size-14 place-items-center rounded-xl bg-gold-soft text-ink-strong">
          <KeyRound />
        </span>
        <div>
          <h2 className="font-bold text-ink-strong">{t("title")}</h2>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{t("description")}</p>
        </div>
      </div>
      {!secret && (
        <StatusBanner tone="danger" role="alert">
          {t("missing")}
        </StatusBanner>
      )}
      <Button
        type="button"
        onClick={() => void redeem()}
        disabled={!secret || status === "redeeming"}
        aria-busy={status === "redeeming"}
      >
        {status === "redeeming" && <LoaderCircle className="animate-spin" />}
        {status === "redeeming" ? t("redeeming") : t("redeem")}
      </Button>
      {status === "error" && secret && (
        <StatusBanner tone="danger" role="alert">
          {t("error")}
        </StatusBanner>
      )}
    </div>
  );
}

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
function readHash() {
  return window.location.hash.slice(1);
}
