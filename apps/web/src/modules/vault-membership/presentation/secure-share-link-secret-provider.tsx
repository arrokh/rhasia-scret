"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { consumeSecureShareLinkSecretFromLocation } from "../infrastructure/browser-secure-share-link-fragment";
import {
  clearSecureShareLinkSecret,
  getSecureShareLinkSecretRemainingLifetime,
  readSecureShareLinkSecret,
  replaceSecureShareLinkSecret,
  retainSecureShareLinkSecret,
  scheduleSecureShareLinkSecretClear,
} from "../infrastructure/browser-secure-share-link-secret-state";

type SecureShareLinkSecretContextValue = Readonly<{
  secret: string;
  clearSecret: (expectedSecret?: string) => boolean;
}>;

const SecureShareLinkSecretContext = createContext<SecureShareLinkSecretContextValue | null>(null);

export function SecureShareLinkSecretProvider({ children }: Readonly<{ children: ReactNode }>) {
  const scope = typeof window === "undefined" ? "" : `${window.location.pathname}${window.location.search}`;
  const [secretState, setSecretState] = useState(() => ({ scope, secret: readSecureShareLinkSecret(scope) }));
  const secret = secretState.scope === scope ? secretState.secret : readSecureShareLinkSecret(scope);
  const initialFragmentConsumed = useRef(false);
  const replaceSecret = useCallback(
    (nextSecret: string) => {
      if (!nextSecret) return;
      replaceSecureShareLinkSecret(scope, nextSecret);
      setSecretState({ scope, secret: nextSecret });
    },
    [scope],
  );
  const clearSecret = useCallback(
    (expectedSecret?: string) => {
      if (!clearSecureShareLinkSecret(scope, expectedSecret)) return false;
      setSecretState({ scope, secret: "" });
      return true;
    },
    [scope],
  );

  useEffect(() => {
    retainSecureShareLinkSecret(scope);
    if (!initialFragmentConsumed.current) {
      initialFragmentConsumed.current = true;
      // Scrub every initial fragment so incomplete secrets never remain in the URL; later hash changes preserve ordinary anchors.
      replaceSecret(consumeSecureShareLinkSecretFromLocation());
    }

    function consumeChangedFragment() {
      const nextSecret = consumeSecureShareLinkSecretFromLocation({ clearInvalidFragment: false });
      if (nextSecret) replaceSecret(nextSecret);
    }

    window.addEventListener("hashchange", consumeChangedFragment);
    return () => {
      window.removeEventListener("hashchange", consumeChangedFragment);
      scheduleSecureShareLinkSecretClear(scope);
    };
  }, [replaceSecret, scope]);

  useEffect(() => {
    const remainingLifetime = getSecureShareLinkSecretRemainingLifetime(scope);
    if (remainingLifetime === undefined) return;
    const timer = window.setTimeout(() => clearSecret(secret), remainingLifetime);
    return () => window.clearTimeout(timer);
  }, [clearSecret, scope, secret]);

  const value = useMemo(() => ({ secret, clearSecret }), [secret, clearSecret]);
  return <SecureShareLinkSecretContext.Provider value={value}>{children}</SecureShareLinkSecretContext.Provider>;
}

export function useSecureShareLinkSecret(): SecureShareLinkSecretContextValue {
  const value = useContext(SecureShareLinkSecretContext);
  if (!value) throw new Error("SecureShareLinkSecretProvider is required for invitation redemption.");
  return value;
}
