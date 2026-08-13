"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false
      },
      mutations: {
        retry: 0
      }
    }
  }));

  useEffect(() => {
    if (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_E2E_BROWSER_TESTS !== "1") return;
    const target = window as typeof window & { __RHSIA_E2E_QUERY_STATE__?: () => unknown };
    target.__RHSIA_E2E_QUERY_STATE__ = () => ({
      queries: queryClient.getQueryCache().getAll().map((query) => ({ key: query.queryKey, data: query.state.data })),
      mutations: queryClient.getMutationCache().getAll().map((mutation) => ({ key: mutation.options.mutationKey, variables: mutation.state.variables, data: mutation.state.data }))
    });
    return () => { delete target.__RHSIA_E2E_QUERY_STATE__; };
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
