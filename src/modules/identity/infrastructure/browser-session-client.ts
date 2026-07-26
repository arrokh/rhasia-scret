"use client";

import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

export async function terminateBrowserSession(): Promise<string> {
  const response = await browserApiClient.post("/auth/logout");
  if (!response.ok) throw new Error("Session termination failed.");
  return response.url || "/";
}
