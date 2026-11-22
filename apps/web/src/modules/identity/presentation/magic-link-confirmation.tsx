"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FunctionComponent } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/shared/presentation/app-ui";
import { consumeBrowserLocationFragment } from "@/shared/infrastructure/browser-location-fragment";
import {
  AUTH_COMPLETION_PATH,
  INVITATION_AUTH_RETURN_PATH,
  resolveAuthReturnPath,
} from "../application/auth-return-path";
import { isSafePwaHandoffId, isSessionToken } from "../application/passwordless-client-contract";
import { announceAuthenticationCompletion } from "./auth-completion-channel";
import {
  pollPwaAuthenticationHandoff,
  publishPwaAuthenticationHandoff,
  redeemBrowserMagicLink,
  redeemPwaMagicLink,
} from "../infrastructure/browser-passwordless-client";
import {
  announcePwaAuthenticationCompletion,
  clearPwaAuthenticationHandoff,
  isPwaDisplayMode,
  readPwaAuthenticationHandoffById,
  requestPwaAuthenticationVerifier,
  subscribeToPwaAuthenticationCompletion,
  type PendingPwaAuthenticationHandoff,
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
  const [handoffFailed, setHandoffFailed] = useState(false);
  const [pwaHandoffPending, setPwaHandoffPending] = useState(false);
  const redemptionAttempted = useRef(false);
  const pwaCompletionHandled = useRef(false);
  const pwaCompletionUnsubscribe = useRef<(() => void) | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    if (redemptionAttempted.current)
      return () => {
        mounted.current = false;
        pwaCompletionUnsubscribe.current?.();
        pwaCompletionUnsubscribe.current = null;
      };
    redemptionAttempted.current = true;
    void (async () => {
      let completingHandoff = false;
      let pwaHandoffPublished = false;
      try {
        const fragment = readAndClearFragment();
        if (!fragment.token) {
          if (mounted.current) setFailed(true);
          return;
        }
        if (client === "pwa") {
          const handoffId = fragment.handoffId;
          if (!handoffId || !isSafePwaHandoffId(handoffId)) throw new Error("Invalid PWA handoff.");
          const pwaDisplayMode = isPwaDisplayMode();
          const finishPwaHandoff = (acceptedReturnPathValue: unknown, announceCompletion: boolean) => {
            if (pwaCompletionHandled.current) return;
            pwaCompletionHandled.current = true;
            clearPwaAuthenticationHandoff(handoffId);
            pwaCompletionUnsubscribe.current?.();
            pwaCompletionUnsubscribe.current = null;
            const returnPath = resolveAuthReturnPath(acceptedReturnPathValue);
            if (mounted.current) goTo(returnPath === INVITATION_AUTH_RETURN_PATH ? AUTH_COMPLETION_PATH : returnPath);
            if (announceCompletion) {
              try {
                announcePwaAuthenticationCompletion(handoffId, returnPath);
              } catch {
                // The server accepted authentication; completion announcements are best-effort.
              }
              try {
                announceAuthenticationCompletion();
              } catch {
                // A failed session-change announcement must not block successful sign-in navigation.
              }
            }
          };
          completingHandoff = pwaDisplayMode;
          const pending = pwaDisplayMode ? await resolvePwaAuthenticationHandoff(handoffId) : null;
          if (pwaDisplayMode && !pending) throw new Error("PWA handoff is unavailable.");
          if (pwaDisplayMode) {
            pwaCompletionUnsubscribe.current?.();
            pwaCompletionUnsubscribe.current = subscribeToPwaAuthenticationCompletion((completedId, returnPath) => {
              if (completedId !== handoffId) return;
              finishPwaHandoff(returnPath, false);
            });
          }
          completingHandoff = false;
          const result = await redeemPwaMagicLink(fragment.token);
          completingHandoff = true;
          if (!isSessionToken(result.refreshToken)) throw new Error("Invalid PWA session handoff.");
          await publishPwaAuthenticationHandoff(handoffId, result.refreshToken);
          pwaHandoffPublished = true;
          if (pwaDisplayMode) {
            if (!pending) throw new Error("PWA handoff is unavailable.");
            const accepted = await pollPwaAuthenticationHandoff(pending);
            if (!("accepted" in accepted)) {
              if (pwaCompletionHandled.current) return;
              if (mounted.current) setPwaHandoffPending(true);
              return;
            }
            finishPwaHandoff(accepted.returnPath, true);
            return;
          }
          if (mounted.current) setPwaHandoffPending(true);
          return;
        }
        const returnPath = resolveAuthReturnPath((await redeemBrowserMagicLink(fragment.token)).returnPath);
        if (mounted.current) {
          goTo(returnPath === INVITATION_AUTH_RETURN_PATH ? AUTH_COMPLETION_PATH : returnPath);
        }
        announceAuthenticationCompletion();
      } catch {
        if (pwaCompletionHandled.current) return;
        if (pwaHandoffPublished && mounted.current) {
          setPwaHandoffPending(true);
          return;
        }
        if (mounted.current) {
          setHandoffFailed(completingHandoff);
          setFailed(true);
        }
      }
    })();
    return () => {
      mounted.current = false;
      pwaCompletionUnsubscribe.current?.();
      pwaCompletionUnsubscribe.current = null;
    };
  }, [client, goTo]);

  if (failed) {
    return (
      <>
        <StatusBanner tone="danger" role="alert">
          {t(handoffFailed ? "pwaFailed" : "failed")}
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
  if (pwaHandoffPending) {
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

async function resolvePwaAuthenticationHandoff(handoffId: string): Promise<PendingPwaAuthenticationHandoff | null> {
  const pending = readPwaAuthenticationHandoffById(handoffId);
  if (pending) return pending;
  const verifier = await requestPwaAuthenticationVerifier(handoffId);
  return verifier ? { handoffId, verifier } : null;
}

function readAndClearFragment(): Readonly<{ token: string | null; handoffId: string | null }> {
  const fragment = consumeBrowserLocationFragment();
  if (fragment === null) throw new Error("Could not safely consume the authentication fragment.");
  const params = new URLSearchParams(fragment);
  const token = params.get("token");
  const handoffId = params.get("handoff");
  return {
    token: token && /^[A-Za-z0-9_-]{43,128}$/.test(token) ? token : null,
    handoffId,
  };
}
