"use client";

import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

export async function loadServerTime(): Promise<Date> {
  const response = await browserApiClient.getJson<{ now: string }>("/api/time", { cache: "no-store" });
  return new Date(response.now);
}
