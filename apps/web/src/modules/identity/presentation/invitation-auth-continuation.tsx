"use client";

import { useCallback, useEffect } from "react";
import {
  AUTH_COMPLETION_PATH,
  INVITATION_AUTH_RETURN_PATH,
  resolveAuthReturnPath,
} from "../application/auth-return-path";
import {
  beginSecureShareLinkAuthentication,
  clearPendingSecureShareLinkAuthentication,
  consumeSecureShareLinkAuthenticationCompletion,
  consumeSecureShareLinkSecretFromLocation,
  replacePendingSecureShareLinkSecret,
  retainSecureShareLinkAuthentication,
  scheduleSecureShareLinkAuthenticationClear,
} from "@/modules/vault-membership";
import { subscribeToAuthenticationCompletion } from "./auth-completion-channel";

export function InvitationAuthContinuation({
  nextPath,
  navigate,
}: {
  nextPath: string;
  navigate?: (path: string) => void;
}) {
  const goTo = useCallback(
    (path: string) => {
      if (navigate) {
        navigate(path);
        return;
      }
      window.location.replace(path);
    },
    [navigate],
  );

  useEffect(() => {
    if (resolveAuthReturnPath(nextPath) !== INVITATION_AUTH_RETURN_PATH) {
      clearPendingSecureShareLinkAuthentication();
      return;
    }

    retainSecureShareLinkAuthentication();
    // Scrub every initial fragment so incomplete secrets never remain in the URL; later hash changes preserve ordinary anchors.
    beginSecureShareLinkAuthentication(consumeSecureShareLinkSecretFromLocation());

    function consumeChangedFragment() {
      replacePendingSecureShareLinkSecret(consumeSecureShareLinkSecretFromLocation({ clearInvalidFragment: false }));
    }
    window.addEventListener("hashchange", consumeChangedFragment);
    const unsubscribe = subscribeToAuthenticationCompletion(() => {
      const secret = consumeSecureShareLinkAuthenticationCompletion();
      if (secret === null) return;
      if (!secret) {
        goTo(AUTH_COMPLETION_PATH);
        return;
      }
      const destination = new URL(INVITATION_AUTH_RETURN_PATH, window.location.origin);
      destination.hash = secret;
      goTo(destination.toString());
    });
    return () => {
      window.removeEventListener("hashchange", consumeChangedFragment);
      unsubscribe();
      scheduleSecureShareLinkAuthenticationClear();
    };
  }, [goTo, nextPath]);

  return null;
}
