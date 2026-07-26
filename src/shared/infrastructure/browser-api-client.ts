"use client";

import { assertBrowserMutationAllowed } from "./browser-write-policy";

export class BrowserApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "BrowserApiError";
  }
}

export class BrowserApiClient {
  request(url: string, init?: RequestInit): Promise<Response> {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") assertBrowserMutationAllowed();
    return fetch(url, init);
  }

  async getJson<T>(url: string, init?: RequestInit): Promise<T> {
    return this.readJson(await this.request(url, { ...init, method: "GET" }));
  }

  post(url: string, body?: unknown, init?: RequestInit): Promise<Response> {
    return this.request(url, this.jsonInit("POST", body, init));
  }

  async postJson<T>(url: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.readJson(await this.post(url, body, init));
  }

  async postEmpty(url: string, body?: unknown, init?: RequestInit): Promise<void> {
    await this.requireSuccess(await this.post(url, body, init));
  }

  async patchJson<T>(url: string, body: unknown, init?: RequestInit): Promise<T> {
    return this.readJson(await this.request(url, this.jsonInit("PATCH", body, init)));
  }

  async patchEmpty(url: string, body: unknown, init?: RequestInit): Promise<void> {
    await this.requireSuccess(await this.request(url, this.jsonInit("PATCH", body, init)));
  }

  async putEmpty(url: string, body: unknown, init?: RequestInit): Promise<void> {
    await this.requireSuccess(await this.request(url, this.jsonInit("PUT", body, init)));
  }

  async deleteEmpty(url: string, init?: RequestInit): Promise<void> {
    await this.requireSuccess(await this.request(url, { ...init, method: "DELETE" }));
  }

  async deleteJsonEmpty(url: string, body: unknown, init?: RequestInit): Promise<void> {
    await this.requireSuccess(await this.request(url, this.jsonInit("DELETE", body, init)));
  }

  private jsonInit(method: "POST" | "PATCH" | "PUT" | "DELETE", body: unknown, init?: RequestInit): RequestInit {
    if (body === undefined) return { ...init, method };
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json");
    return { ...init, method, headers: Object.fromEntries(headers.entries()), body: JSON.stringify(body) };
  }

  private async readJson<T>(response: Response): Promise<T> {
    await this.requireSuccess(response);
    return response.json() as Promise<T>;
  }

  private async requireSuccess(response: Response): Promise<void> {
    if (response.ok) return;
    let code: string | undefined;
    try {
      const body = await response.json() as unknown;
      if (body && typeof body === "object" && typeof (body as Record<string, unknown>).error === "string") {
        code = (body as Record<string, string>).error;
      }
    } catch {
      // Some endpoints intentionally return an empty error response.
    }
    throw new BrowserApiError("Request failed.", response.status, code);
  }
}

export const browserApiClient = new BrowserApiClient();
