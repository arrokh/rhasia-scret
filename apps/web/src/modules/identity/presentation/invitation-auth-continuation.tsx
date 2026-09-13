"use client";

import { useEffect, useRef } from "react";
import { INVITATION_AUTH_RETURN_PATH, resolveAuthReturnPath } from "../application/auth-return-path";
import { subscribeToAuthenticationCompletion } from "./auth-completion-channel";

export function InvitationAuthContinuation({ nextPath }: { nextPath: string }) {
  const invitationSecret = useRef("");

  useEffect(() => {
    if (resolveAuthReturnPath(nextPath) !== INVITATION_AUTH_RETURN_PATH) return;
    invitationSecret.current = window.location.hash.slice(1);
    if (!invitationSecret.current) return;

    return subscribeToAuthenticationCompletion(() => {
      const destination = new URL(INVITATION_AUTH_RETURN_PATH, window.location.origin);
      destination.hash = invitationSecret.current;
      window.location.replace(destination.toString());
    });
  }, [nextPath]);

  return null;
}
