"use client";

import { useEffect, useState } from "react";
import type { LocalVaultSessionState } from "../application/local-vault-session";
import { createBrowserLocalVaultSession } from "../infrastructure/browser-local-vault-session";

export function useLocalVaultSession() {
  const [session] = useState(createBrowserLocalVaultSession);
  const [state, setState] = useState<LocalVaultSessionState>(session.state);
  const [discoveryError, setDiscoveryError] = useState<unknown>(null);

  useEffect(() => {
    const unsubscribe = session.subscribe(setState);
    void session.discover().catch(setDiscoveryError);
    return () => {
      unsubscribe();
      session.dispose();
    };
  }, [session]);

  return { discoveryError, session, state };
}
