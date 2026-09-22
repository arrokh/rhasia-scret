import { describe, expect, it } from "vitest";
import { apiFactory } from "@api/http/hono-factory";
import { getApiRequestContext } from "@api/http/api-context";
import { createApiRuntime } from "@api/http/api-runtime";
import { requestContext } from "@api/middleware/security";
import { createDisabledEmailSenders } from "@api/smtp-email-senders";
import type { ApiApplicationRuntime } from "@api/modules/server-composition/runtime";
import type { IdentityRuntime } from "@api/modules/identity";
import type { ApiBindings } from "@api/types";

const identity = {} as IdentityRuntime;
const applicationRuntime = {} as ApiApplicationRuntime;
const bindings = {
  WEB_ORIGIN: "https://rhasia-scret.nooroctavian.id",
  EMAIL_SENDERS: createDisabledEmailSenders(),
  DATABASE_CLIENT: {},
} as ApiBindings;

describe("API runtime composition", () => {
  it("returns a stable configuration error for invalid authentication configuration", async () => {
    const app = apiFactory.createApp();
    app.use("*", requestContext);
    app.use("*", createApiRuntime());
    app.get("/", () => new Response("unexpected"));

    const response = await app.request(
      "https://api.example.test/",
      { headers: { "x-request-id": "0123456789abcdef0123456789abcdef" } },
      { ...bindings, AUTH_BACKEND: "invalid-backend" },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("0123456789abcdef0123456789abcdef");
    expect(await response.json()).toEqual({ error: "authentication_misconfigured" });
  });

  it("reuses fixed identity and application composition across requests", async () => {
    const observedContexts: Array<ReturnType<typeof getApiRequestContext>> = [];
    const app = apiFactory.createApp();
    app.use("*", requestContext);
    app.use("*", createApiRuntime({ identity, applicationRuntime }));
    app.get("/", (context) => {
      observedContexts.push(getApiRequestContext(context.get("apiRequest")));
      return context.body(null, 204);
    });

    expect((await app.request("https://api.example.test/", {}, bindings)).status).toBe(204);
    expect((await app.request("https://api.example.test/", {}, bindings)).status).toBe(204);
    expect(observedContexts).toHaveLength(2);
    expect(observedContexts[0]?.identity).toBe(identity);
    expect(observedContexts[1]?.identity).toBe(identity);
    expect(observedContexts[0]?.applicationRuntime).toBe(applicationRuntime);
    expect(observedContexts[1]?.applicationRuntime).toBe(applicationRuntime);
  });
});
