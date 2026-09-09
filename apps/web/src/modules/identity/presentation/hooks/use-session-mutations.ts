"use client";

import { useMutation } from "@tanstack/react-query";
import { terminateBrowserSession } from "../../infrastructure/browser-session-client";

export function useTerminateSessionMutation() {
  return useMutation({
    mutationKey: ["identity", "terminate-session"],
    mutationFn: terminateBrowserSession,
  });
}
