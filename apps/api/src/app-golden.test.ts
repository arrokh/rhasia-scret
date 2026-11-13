import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createApiApp } from "@api/app";
import { createDisabledEmailSenders } from "@api/smtp-email-senders";
import type { ApiBindings } from "@api/types";

const httpExampleSchema = z.object({
  method: z.string(),
  path: z.string(),
  status: z.number().int(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown(),
  mustNotEchoHeaders: z.array(z.string()).optional(),
});
const httpGoldenSchema = z
  .object({
    note: z.string(),
    health: httpExampleSchema,
    time: httpExampleSchema,
    sessionRevoke: httpExampleSchema,
    invalidProxy: httpExampleSchema,
    headHealth: httpExampleSchema,
  })
  .strict();

const httpGolden = httpGoldenSchema.parse(
  JSON.parse(
    readFileSync(new URL("../../../packages/api-contract/test-fixtures/http-golden.json", import.meta.url), "utf8"),
  ),
);
const proxySecret = "synthetic-proxy-secret-for-http-goldens";
const bindings: ApiBindings = {
  WEB_ORIGIN: "https://web.example.test",
  PROXY_SECRET: proxySecret,
  AUTH_BACKEND: "none",
  DATABASE_CLIENT: {} as NonNullable<ApiBindings["DATABASE_CLIENT"]>,
  EMAIL_SENDERS: createDisabledEmailSenders(),
};
const app = createApiApp();

describe("shared API HTTP golden fixtures", () => {
  it("matches the actual Hono runtime for health, time, revoke, proxy rejection, and HEAD", async () => {
    const expectedTime = z.object({ now: z.string() }).parse(httpGolden.time.body);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(expectedTime.now));

    try {
      await assertHttpExample(httpGolden.health);
      await assertHttpExample(httpGolden.time);
      await assertHttpExample(httpGolden.sessionRevoke, { "x-rhasia-proxy-secret": proxySecret });
      await assertHttpExample(httpGolden.invalidProxy, { "x-rhasia-proxy-secret": "synthetic-invalid-marker" });
      await assertHttpExample(httpGolden.headHealth);
    } finally {
      vi.useRealTimers();
    }
  });
});

async function assertHttpExample(
  example: z.infer<typeof httpExampleSchema>,
  additionalHeaders: Record<string, string> = {},
): Promise<void> {
  const headers = new Headers(additionalHeaders);
  const requestId = example.headers?.["x-request-id"];
  if (requestId) headers.set("x-request-id", requestId);

  const response = await app.request(
    `https://api.example.test/v1${example.path}`,
    { method: example.method, headers },
    bindings,
  );
  expect(response.status, `${example.method} ${example.path}`).toBe(example.status);
  for (const [name, value] of Object.entries(example.headers ?? {})) {
    expect(response.headers.get(name), `${example.method} ${example.path} ${name}`).toBe(value);
  }
  for (const name of example.mustNotEchoHeaders ?? []) {
    expect(response.headers.get(name), `${example.method} ${example.path} must not echo ${name}`).toBeNull();
  }

  if (example.method === "HEAD" || example.status === 204) {
    expect(example.body).toBe("");
    expect(await response.text()).toBe("");
    return;
  }
  expect(await response.json(), `${example.method} ${example.path} body`).toEqual(example.body);
}
