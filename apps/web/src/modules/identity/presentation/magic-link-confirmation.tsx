"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FunctionComponent } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { INVITATION_AUTH_RETURN_PATH, resolveAuthReturnPath } from "../application/auth-return-path";
import { isSafePwaHandoffId, isSessionToken } from "../application/passwordless-authentication";
import { announceAuthenticationCompletion, requestInvitationSecret } from "./auth-completion-channel";
import {
  pollPwaAuthenticationHandoff,
  publishPwaAuthenticationHandoff,
  redeemBrowserMagicLink,
  redeemPwaMagicLink,
} from "../infrastructure/browser-passwordless-client";
import {
  clearPwaAuthenticationHandoff,
  isPwaDisplayMode,
  readPwaAuthenticationHandoff,
} from "../infrastructure/pwa-authentication";

type MagicLinkConfirmationProps = { client?: "web" | "pwa"; navigate?: (path: string) => void };

export const MagicLinkConfirmation: FunctionComponent<MagicLinkConfirmationProps> = ({ client = "web", navigate }) => {
  const t = useTranslations("Identity.confirm");
  const goTo = useCallback(
    (path: string) => {
      if (navigate) navigate(path);
      else window.location.replace(path);
    },
    [navigate],
  );
  const [failed, setFailed] = useState(false);
  const [pwaHandoffSent, setPwaHandoffSent] = useState(false);
  const redemptionAttempted = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    if (redemptionAttempted.current)
      return () => {
        mounted.current = false;
      };
    redemptionAttempted.current = true;
    void (async () => {
      const fragment = readAndClearFragment();
      if (!fragment.token) {
        if (mounted.current) setFailed(true);
        return;
      }
      try {
        if (client === "pwa") {
          if (!fragment.handoffId || !isSafePwaHandoffId(fragment.handoffId)) throw new Error("Invalid PWA handoff.");
          const result = await redeemPwaMagicLink(fragment.token);
          if (!isSessionToken(result.refreshToken)) throw new Error("Invalid PWA session handoff.");
          await publishPwaAuthenticationHandoff(fragment.handoffId, result.refreshToken);
          if (isPwaDisplayMode()) {
            const pending = readPwaAuthenticationHandoff();
            if (!pending || pending.handoffId !== fragment.handoffId) throw new Error("PWA handoff is unavailable.");
            const accepted = await pollPwaAuthenticationHandoff(pending);
            if (!("accepted" in accepted)) throw new Error("PWA handoff is pending.");
            clearPwaAuthenticationHandoff();
            announceAuthenticationCompletion();
            if (mounted.current) goTo(accepted.returnPath);
            return;
          }
          if (mounted.current) setPwaHandoffSent(true);
          return;
        }
        const returnPath = resolveAuthReturnPath((await redeemBrowserMagicLink(fragment.token)).returnPath);
        const invitationSecret = returnPath === INVITATION_AUTH_RETURN_PATH ? await requestInvitationSecret() : null;
        if (mounted.current) {
          announceAuthenticationCompletion();
          goTo(buildAuthenticatedDestination(returnPath, invitationSecret));
        }
      } catch {
        if (mounted.current) setFailed(true);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [client, goTo]);

  if (failed) {
    return (
      <>
        <StatusBanner tone="danger" role="alert">
          {t("failed")}
        </StatusBanner>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button asChild>
            <Link href="/sign-in">{t("backToSignIn")}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">{t("backToHome")}</Link>
          </Button>
        </div>
      </>
    );
  }
  if (pwaHandoffSent) {
    return (
      <>
        <StatusBanner tone="success" role="status">
          {t("pwaCompleted")}
        </StatusBanner>
        <p className="text-center text-xs leading-5 text-muted-foreground">{t("pwaDoNotClose")}</p>
      </>
    );
  }

  return (
    <>
      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        {t("verifying")}
      </div>
      <p className="text-center text-xs leading-5 text-muted-foreground">{t("doNotClose")}</p>
    </>
  );
};

function buildAuthenticatedDestination(returnPath: string, invitationSecret: string | null): string {
  if (returnPath !== INVITATION_AUTH_RETURN_PATH || !invitationSecret) return returnPath;
  const destination = new URL(returnPath, window.location.origin);
  destination.hash = invitationSecret;
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

function readAndClearFragment(): Readonly<{ token: string | null; handoffId: string | null }> {
  const hash = window.location.hash;
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const token = params.get("token");
  const handoffId = params.get("handoff");
  return {
    token: token && /^[A-Za-z0-9_-]{43,128}$/.test(token) ? token : null,
    handoffId,
  };
}
