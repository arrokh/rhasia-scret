"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  initializeBrowserAuthenticationSessionChangeBridge,
  subscribeToBrowserAuthenticationSessionChange,
} from "@/shared/infrastructure/browser-authentication-session-change";

type QuerySession = { epoch: number; client: QueryClient };

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<QuerySession>(() => ({ epoch: 0, client: createQueryClient() }));
  const sessionRef = useRef(session);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    initializeBrowserAuthenticationSessionChangeBridge();
    return subscribeToBrowserAuthenticationSessionChange(() => {
      const current = sessionRef.current;
      current.client.clear();
      // Keep sign-in invitation listeners mounted when the auth-completion message follows this session change.
      const preserveAuthenticationFlow =
        typeof window !== "undefined" &&
        (window.location.pathname === "/auth/confirm" ||
          window.location.pathname === "/auth/pwa-confirm" ||
          window.location.pathname === "/sign-in");
      const next = {
        epoch: current.epoch + Number(!preserveAuthenticationFlow),
        client: createQueryClient(),
      };
      sessionRef.current = next;
      setSession(next);
    });
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_E2E_BROWSER_TESTS !== "1") return;
    const target = window as typeof window & { __RHSIA_E2E_QUERY_STATE__?: () => unknown };
    target.__RHSIA_E2E_QUERY_STATE__ = () => ({
      sessionEpoch: session.epoch,
      queries: session.client
        .getQueryCache()
        .getAll()
        .map((query) => ({
          key: query.queryKey,
          data: query.state.data,
          status: query.state.status,
          dataUpdatedAt: query.state.dataUpdatedAt,
        })),
      mutations: session.client
        .getMutationCache()
        .getAll()
        .map((mutation) => ({
          key: mutation.options.mutationKey,
          variables: mutation.state.variables,
          data: mutation.state.data,
        })),
    });
    return () => {
      delete target.__RHSIA_E2E_QUERY_STATE__;
    };
  }, [session.client, session.epoch]);

  return (
    <QueryClientProvider client={session.client}>
      <Fragment key={session.epoch}>{children}</Fragment>
    </QueryClientProvider>
  );
}
