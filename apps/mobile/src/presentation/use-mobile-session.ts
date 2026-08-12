import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking } from "react-native";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedTransport } from "../../../../src/shared/application/platform-ports";
import { classifyIncomingLink, completeAuthCallback, extractSecureShareLinkSecret } from "../application/incoming-link";
import { loadMobileApplicationUser } from "../application/load-mobile-application-user";

export type MobileSessionStatus = "idle" | "sending" | "link_sent" | "verifying" | "authenticated" | "inactive" | "session_unavailable" | "request_error" | "callback_error" | "share_link_ready";

const MOBILE_AUTH_REQUEST_TIMEOUT_MS = 15_000;

export function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Mobile authentication request timed out.")), milliseconds);
    void promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function useMobileSession(supabase: SupabaseClient, authRedirectUrl: string, transport: AuthenticatedTransport) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<MobileSessionStatus>("idle");
  const secureShareSecret = useRef<string | null>(null);

  const handleUrl = useCallback(async (url: string) => {
    const kind = classifyIncomingLink(url);
    if (kind === "secure_share_link") {
      secureShareSecret.current = extractSecureShareLinkSecret(url);
      setStatus(secureShareSecret.current ? "share_link_ready" : "callback_error");
      return;
    }
    if (kind !== "auth_callback") return;
    const result = await completeAuthCallback(url, supabase.auth);
    setStatus(result === "authenticated" ? "verifying" : "callback_error");
  }, [supabase]);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        if (data.session) setStatus("verifying");
      }
    });
    const authSubscription = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      if (nextSession) setStatus("verifying");
    }).data.subscription;
    const urlSubscription = Linking.addEventListener("url", ({ url }) => void handleUrl(url));
    void Linking.getInitialURL().then((url) => {
      if (url && mounted) void handleUrl(url);
    });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    if (AppState.currentState === "active") supabase.auth.startAutoRefresh();
    return () => {
      mounted = false;
      authSubscription.unsubscribe();
      urlSubscription.remove();
      appStateSubscription.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, [handleUrl, supabase]);

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
    return () => { mounted = false; };
  }, [session, transport]);

  const requestSignInLink = useCallback(async (email: string) => {
    setStatus("sending");
    try {
      const result = await withTimeout(
        supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: { emailRedirectTo: authRedirectUrl, shouldCreateUser: false },
        }),
        MOBILE_AUTH_REQUEST_TIMEOUT_MS,
      );
      setStatus(result.error ? "request_error" : "link_sent");
    } catch {
      // A native network request can remain pending when connectivity or TLS fails.
      // Never leave the form in its indefinite "sending" state.
      setStatus("request_error");
    }
  }, [authRedirectUrl, supabase]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut({ scope: "local" });
    setSession(null);
    setStatus("idle");
  }, [supabase]);

  const consumeSecureShareSecret = useCallback(() => {
    const secret = secureShareSecret.current;
    secureShareSecret.current = null;
    return secret;
  }, []);

  return { session, status, requestSignInLink, signOut, consumeSecureShareSecret };
}
