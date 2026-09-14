import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking } from "react-native";
import type { AuthenticatedTransport } from "@rhasia-scret/client-vault-core";
import { completeMagicLink, classifyIncomingLink, extractSecureShareLinkSecret } from "../application/incoming-link";
import { loadMobileApplicationUser } from "../application/load-mobile-application-user";
import type { MobilePasswordlessAuthPort } from "../application/incoming-link";
import type {
  MobilePasswordlessAuthClient,
  NativeMobileSession,
} from "../infrastructure/mobile-passwordless-auth-client";

export type MobileSessionStatus =
  | "idle"
  | "sending"
  | "link_sent"
  | "verifying"
  | "authenticated"
  | "inactive"
  | "session_unavailable"
  | "request_error"
  | "callback_error"
  | "share_link_ready";

export function useMobileSession(
  auth: MobilePasswordlessAuthClient & MobilePasswordlessAuthPort,
  webOrigin: string,
  transport: AuthenticatedTransport,
) {
  const [session, setSession] = useState<NativeMobileSession | null>(null);
  const [status, setStatus] = useState<MobileSessionStatus>("idle");
  const secureShareSecret = useRef<string | null>(null);

  const handleUrl = useCallback(
    async (url: string) => {
      const kind = classifyIncomingLink(url, webOrigin);
      if (kind === "secure_share_link") {
        secureShareSecret.current = extractSecureShareLinkSecret(url, webOrigin);
        setStatus(secureShareSecret.current ? "share_link_ready" : "callback_error");
        return;
      }
      if (kind !== "magic_link") return;
      const result = await completeMagicLink(url, auth, webOrigin);
      if (result === "authenticated") {
        setSession(await auth.getSession());
        setStatus("verifying");
      } else {
        setStatus("callback_error");
      }
    },
    [auth, webOrigin],
  );

  useEffect(() => {
    let mounted = true;
    void auth.getSession().then((storedSession) => {
      if (mounted) {
        setSession(storedSession);
        if (storedSession) setStatus("verifying");
      }
    });
    const urlSubscription = Linking.addEventListener("url", ({ url }) => void handleUrl(url));
    void Linking.getInitialURL().then((url) => {
      if (url && mounted) void handleUrl(url);
    });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void auth
          .refreshIfNeeded()
          .then((storedSession) => {
            if (mounted) setSession(storedSession);
          })
          .catch(() => {
            // Keep the current session on transient network failures; the next
            // foreground transition retries refresh without exposing credentials.
          });
      }
    });
    return () => {
      mounted = false;
      urlSubscription.remove();
      appStateSubscription.remove();
    };
  }, [auth, handleUrl]);

  useEffect(() => {
    if (!session) return;
    let mounted = true;
    void loadMobileApplicationUser(transport)
      .then((result) => {
        if (!mounted) return;
        if (result.status === "active") setStatus("authenticated");
        else if (result.status === "inactive") setStatus("inactive");
        else setStatus("session_unavailable");
      })
      .catch(() => {
        if (mounted) setStatus("session_unavailable");
      });
    return () => {
      mounted = false;
    };
  }, [session, transport]);

  const requestSignInLink = useCallback(
    async (email: string) => {
      setStatus("sending");
      try {
        setStatus((await auth.requestMagicLink(email)) ? "link_sent" : "request_error");
      } catch {
        setStatus("request_error");
      }
    },
    [auth],
  );

  const signOut = useCallback(async () => {
    await auth.signOut();
    setSession(null);
    setStatus("idle");
  }, [auth]);

  const consumeSecureShareSecret = useCallback(() => {
    const secret = secureShareSecret.current;
    secureShareSecret.current = null;
    return secret;
  }, []);

  return { session, status, requestSignInLink, signOut, consumeSecureShareSecret };
}
