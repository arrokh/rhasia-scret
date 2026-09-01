"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalVaultSession, LocalVaultSessionState } from "../application/local-vault-session";
import { createBrowserLocalVaultSession } from "../infrastructure/browser-local-vault-session";

export function useLocalVaultSession() {
  const sessionRef = useRef<LocalVaultSession | null>(null);
  const [state, setState] = useState<LocalVaultSessionState>({ available: true, discovered: false, migrationRequired: false, record: null, vault: null });
  const [discoveryError, setDiscoveryError] = useState<unknown>(null);

  useEffect(() => {
    const session = createBrowserLocalVaultSession();
    let active = true;
    sessionRef.current = session;
    const unsubscribe = session.subscribe(setState);
    void session.discover().catch((error) => { if (active) setDiscoveryError(error); });
    return () => {
      active = false;
      unsubscribe();
      session.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, []);

  const invoke = useCallback(<Result,>(operation: (session: LocalVaultSession) => Promise<Result>) => {
    const session = sessionRef.current;
    return session ? operation(session) : Promise.reject(new Error("The Local Vault session is not ready."));
  }, []);
  const lock = useCallback(() => sessionRef.current?.lock(), []);

  return {
    discoveryError,
    session: {
      clear: () => invoke((current) => current.clear()),
      create: (passphrase: string, name: string) => invoke((current) => current.create(passphrase, name)),
      migrate: (passphrase: string) => invoke((current) => current.migrate(passphrase)),
      mutate: <Result,>(operation: (vault: NonNullable<LocalVaultSessionState["vault"]>) => Promise<Result>) => invoke((current) => current.mutate(operation)),
      refresh: () => invoke((current) => current.refresh()),
      lock,
      unlock: (passphrase: string) => invoke((current) => current.unlock(passphrase)),
    },
    state,
  };
}
