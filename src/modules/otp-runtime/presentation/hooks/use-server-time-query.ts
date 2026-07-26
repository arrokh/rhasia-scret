"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";
import { loadServerTime } from "../../infrastructure/browser-time-client";

export const serverTimeQueryOptions = queryOptions({
  queryKey: ["otp-runtime", "server-time"],
  queryFn: loadServerTime,
  staleTime: 30_000
});

export function useServerTimeQuery(enabled: boolean) {
  return useQuery({ ...serverTimeQueryOptions, enabled });
}
