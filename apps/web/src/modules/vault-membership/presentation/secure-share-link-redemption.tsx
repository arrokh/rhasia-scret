"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { captureAnalyticsEvent } from "@/shared/infrastructure/browser-analytics";
import { ANALYTICS_EVENTS } from "@/shared/infrastructure/browser-analytics-config";
import { KeyRound, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeading, StatusBanner } from "@/shared/presentation/app-ui";
import { ContextualHelpButton } from "@/shared/presentation/contextual-help";
import { SecureShareLinkHttpTransportError, type PortableJsonWebKey } from "@rhasia-scret/client-vault-core";
import { redeemSecureShareLink } from "../infrastructure/browser-secure-share-link-workflow";
import { useSecureShareLinkSecret } from "./secure-share-link-secret-provider";

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
  const { secret, clearSecret } = useSecureShareLinkSecret();
  const [status, setStatus] = useState<"idle" | "redeeming" | "accepted" | "error" | "identity-stale">("idle");
  const [statusSecret, setStatusSecret] = useState(secret);
  const visibleStatus = status === "redeeming" || status === "accepted" || statusSecret === secret ? status : "idle";

  async function redeem() {
    const redeemingSecret = secret;
    if (!redeemingSecret || !userEncryptionPublicKey) {
      setStatusSecret(redeemingSecret);
      setStatus("error");
      return;
    }
    setStatusSecret(redeemingSecret);
    setStatus("redeeming");
    try {
      await redeemSecureShareLink(redeemingSecret, { profileId, publicKey: userEncryptionPublicKey });
      captureAnalyticsEvent(ANALYTICS_EVENTS.secureShareLinkRedeemed);
      if (!clearSecret(redeemingSecret)) {
        setStatus("accepted");
        return;
      }
      window.location.replace(new URL("/vaults", window.location.origin).toString());
    } catch (error) {
      if (
        error instanceof SecureShareLinkHttpTransportError &&
        error.code === "stale_user_encryption_identity" &&
        onIdentityStale
      ) {
        try {
          await onIdentityStale();
          setStatusSecret(redeemingSecret);
          setStatus("identity-stale");
          return;
        } catch {
          // Keep the ordinary failure state if workspace authorization cannot be refreshed.
        }
      }
      setStatusSecret(redeemingSecret);
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
        disabled={!secret || visibleStatus === "redeeming"}
        aria-busy={visibleStatus === "redeeming"}
      >
        {visibleStatus === "redeeming" && <LoaderCircle className="animate-spin" />}
        {visibleStatus === "redeeming" ? t("redeeming") : t("redeem")}
      </Button>
      {visibleStatus === "accepted" && (
        <StatusBanner tone="success" role="status">
          {t("previousAccepted")}
        </StatusBanner>
      )}
      {(visibleStatus === "error" || visibleStatus === "identity-stale") && secret && (
        <StatusBanner tone="danger" role="alert">
          {visibleStatus === "identity-stale" ? (
            t("identityChanged")
          ) : (
            <>
              <p>{t("error")}</p>
              <p className="mt-1">{t("errorHelp")}</p>
            </>
          )}
        </StatusBanner>
      )}
    </div>
  );
}
