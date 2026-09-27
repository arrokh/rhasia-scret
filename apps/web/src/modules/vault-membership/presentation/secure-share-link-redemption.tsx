"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";
import { KeyRound, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeading, StatusBanner } from "@/shared/presentation/app-ui";
import { ContextualHelpButton } from "@/shared/presentation/contextual-help";
import { SecureShareLinkHttpTransportError, type PortableJsonWebKey } from "@rhasia-scret/client-vault-core";
import { redeemSecureShareLink } from "../infrastructure/browser-secure-share-link-workflow";

export function SecureShareLinkRedemption({
  profileId,
  userEncryptionPublicKey,
  onIdentityStale,
}: {
  profileId: string;
  userEncryptionPublicKey?: PortableJsonWebKey;
  onIdentityStale?: () => Promise<void>;
}) {
  const t = useTranslations("VaultMembership.redemption");
  const secret = useSyncExternalStore(subscribeToHash, readHash, () => "");
  const [status, setStatus] = useState<"idle" | "redeeming" | "error" | "identity-stale">("idle");

  useEffect(() => {
    function resetRedemptionStatus() {
      setStatus("idle");
    }
    window.addEventListener("hashchange", resetRedemptionStatus);
    return () => window.removeEventListener("hashchange", resetRedemptionStatus);
  }, []);

  async function redeem() {
    if (!secret || !userEncryptionPublicKey) {
      setStatus("error");
      return;
    }
    setStatus("redeeming");
    try {
      await redeemSecureShareLink(secret, { profileId, publicKey: userEncryptionPublicKey });
      captureAnalyticsEvent(ANALYTICS_EVENTS.secureShareLinkRedeemed);
      window.location.replace(new URL("/vaults", window.location.origin).toString());
    } catch (error) {
      if (
        error instanceof SecureShareLinkHttpTransportError &&
        error.code === "stale_user_encryption_identity" &&
        onIdentityStale
      ) {
        try {
          await onIdentityStale();
          setStatus("identity-stale");
          return;
        } catch {
          // Keep the ordinary failure state if workspace authorization cannot be refreshed.
        }
      }
      setStatus("error");
    }
  }
  return (
    <div className="grid gap-5 p-5 sm:p-6">
      <SectionHeading
        icon={KeyRound}
        title={t("title")}
        description={t("description")}
        action={<ContextualHelpButton topic="sharedVaultInvitations" />}
      />
      {!secret && (
        <>
          <StatusBanner tone="danger" role="alert">
            <p>{t("missing")}</p>
            <p className="mt-1">{t("missingHelp")}</p>
          </StatusBanner>
          <Button variant="outline" asChild>
            <Link href="/vaults">{t("backToVaults")}</Link>
          </Button>
        </>
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
      {(status === "error" || status === "identity-stale") && secret && (
        <StatusBanner tone="danger" role="alert">
          {status === "identity-stale" ? t("identityChanged") : t("error")}
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
  const secret = window.location.hash.slice(1);
  return /^[A-Za-z0-9_-]{16,4096}$/.test(secret) ? secret : "";
}
