"use client";

import type { ServerTimePort } from "../application/time-ports";
import { browserApiClient } from "@/shared/infrastructure/browser-api-client";

export class BrowserServerTimePort implements ServerTimePort {
  now(): Promise<Date> {
    return loadServerTime();
  }
}

export const browserServerTimePort = new BrowserServerTimePort();

export async function loadServerTime(): Promise<Date> {
  const response = await browserApiClient.getJson<{ now: string }>("/api/time", { cache: "no-store" });
  return new Date(response.now);
}
