"use client";

import { useEffect, useRef } from "react";
import { INVITATION_AUTH_RETURN_PATH, resolveAuthReturnPath } from "../application/auth-return-path";
import { subscribeToAuthenticationCompletion } from "./auth-completion-channel";

export function InvitationAuthContinuation({ nextPath }: { nextPath: string }) {
  const invitationSecret = useRef("");
  const invitationSecretSent = useRef(false);

  useEffect(() => {
    invitationSecret.current = "";
    invitationSecretSent.current = false;
    if (resolveAuthReturnPath(nextPath) !== INVITATION_AUTH_RETURN_PATH) return;
    const fragment = window.location.hash.slice(1);
    invitationSecret.current = /^[A-Za-z0-9_-]{16,4096}$/.test(fragment) ? fragment : "";
    if (!invitationSecret.current) return;

    return subscribeToAuthenticationCompletion(
      () => {
        const destination = new URL(INVITATION_AUTH_RETURN_PATH, window.location.origin);
        destination.hash = invitationSecret.current;
        window.location.replace(destination.toString());
      },
      () => {
        if (invitationSecretSent.current) return "";
        invitationSecretSent.current = true;
        return invitationSecret.current;
      },
    );
  }, [nextPath]);

  return null;
}
