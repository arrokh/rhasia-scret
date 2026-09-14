"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FunctionComponent } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { INVITATION_AUTH_RETURN_PATH, resolveAuthReturnPath } from "../application/auth-return-path";
import { announceAuthenticationCompletion, requestInvitationSecret } from "./auth-completion-channel";
import { redeemBrowserMagicLink } from "../infrastructure/browser-passwordless-client";

type MagicLinkConfirmationProps = { navigate?: (path: string) => void };

export const MagicLinkConfirmation: FunctionComponent<MagicLinkConfirmationProps> = ({ navigate }) => {
  const t = useTranslations("Identity.confirm");
  const goTo = useCallback(
    (path: string) => {
      if (navigate) navigate(path);
      else window.location.replace(path);
    },
    [navigate],
  );
  const [failed, setFailed] = useState(false);
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
      const token = readAndClearToken();
      if (!token) {
        if (mounted.current) setFailed(true);
        return;
      }
      try {
        const returnPath = resolveAuthReturnPath((await redeemBrowserMagicLink(token)).returnPath);
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
  }, [goTo]);

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

function readAndClearToken(): string | null {
  const hash = window.location.hash;
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const token = params.get("token");
  return token && /^[A-Za-z0-9_-]{43,128}$/.test(token) ? token : null;
}
