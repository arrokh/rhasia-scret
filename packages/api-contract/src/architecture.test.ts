/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const clientSources = ["index.ts", "paths.ts", "generated-routes.ts"]
  .map((name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8"))
  .join("\n");
const openApiText = readFileSync(new URL("../openapi.yaml", import.meta.url), "utf8");
const fixtures = ["route-manifest.json", "http-golden.json"]
  .map((name) => readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url), "utf8"))
  .join("\n");

describe("API contract architecture", () => {
  it("keeps client-safe contract artifacts free of application and platform imports", () => {
    expect(clientSources).not.toMatch(/from ["'](?:next|react|@prisma\/|pg|nodemailer|node:)/);
    expect(clientSources).not.toMatch(/(?:DATABASE_URL|DIRECT_URL|PROXY_SECRET|SMTP_PASSWORD)\s*=/);
  });

  it("keeps OpenAPI and golden fixtures free of credentials and customer content", () => {
    expect(openApiText).not.toMatch(/(?:DATABASE_URL|DIRECT_URL|AUTH_SESSION_SECRET|SMTP_PASSWORD)\s*:\s*[^\s]+/);
    expect(fixtures).not.toMatch(/(?:DATABASE_URL|DIRECT_URL|AUTH_SESSION_SECRET|SMTP_PASSWORD)\s*[:=]\s*[^\s]+/);
    expect(fixtures).toContain("Synthetic wire examples only");
  });
});
