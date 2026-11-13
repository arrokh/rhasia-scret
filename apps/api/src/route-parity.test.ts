import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import * as ts from "typescript";
import { z } from "zod";
import { createApiApp } from "@api/app";
import type { ApiRuntimeDependencies } from "@api/http/api-runtime";
import { createDisabledEmailSenders } from "@api/smtp-email-senders";
import { API_ROUTE_MANIFEST } from "@rhasia-scret/api-contract";
import type { ApiBindings } from "@api/types";

const app = createApiApp();

const bindings: ApiBindings = {
  WEB_ORIGIN: "https://web.example.test",
  PROXY_SECRET: "proxy-secret-that-is-long-enough-for-tests-123456",
  EMAIL_SENDERS: createDisabledEmailSenders(),
};

const routes: ReadonlyArray<readonly [string, string]> = [
  ["POST", "/v1/auth/magic-link/request"],
  ["POST", "/v1/auth/magic-link/redeem"],
  ["POST", "/v1/auth/pwa/session"],
  ["POST", "/v1/auth/session/refresh"],
  ["POST", "/v1/auth/session/revoke"],
  ["GET", "/v1/health"],
  ["GET", "/v1/time"],
  ["GET", "/v1/internal/retention-purge"],
  ["GET", "/v1/me"],
  ["DELETE", "/v1/me"],
  ["GET", "/v1/me/deletion/preview"],
  ["POST", "/v1/me/deletion/otp/request"],
  ["POST", "/v1/me/deletion/otp/verify"],
  ["POST", "/v1/passkey-recovery/registration/options"],
  ["POST", "/v1/passkey-recovery/registration/verify"],
  ["POST", "/v1/passkey-recovery/authentication/options"],
  ["POST", "/v1/passkey-recovery/authentication/verify"],
  ["GET", "/v1/passkey-recovery/status"],
  ["DELETE", "/v1/passkey-recovery"],
  ["GET", "/v1/personal-vault"],
  ["POST", "/v1/personal-vault/initialize"],
  ["POST", "/v1/personal-vault/name/migration"],
  ["GET", "/v1/personal-vault/destructive-reset"],
  ["POST", "/v1/personal-vault/destructive-reset"],
  ["GET", "/v1/user-crypto-profile"],
  ["POST", "/v1/user-crypto-profile/rewrap"],
  ["POST", "/v1/user-crypto-profile/migration"],
  ["PUT", "/v1/user-encryption-identity"],
  ["POST", "/v1/user-encryption-identity/migration"],
  ["GET", "/v1/user-encryption-identity/rotation"],
  ["PATCH", "/v1/user-encryption-identity/rotation"],
  ["POST", "/v1/vault-imports"],
  ["GET", "/v1/shared-vaults"],
  ["POST", "/v1/shared-vaults"],
  ["GET", "/v1/shared-vaults/vault_1"],
  ["PATCH", "/v1/shared-vaults/vault_1"],
  ["POST", "/v1/shared-vaults/vault_1/name/migration"],
  ["POST", "/v1/shared-vaults/vault_1/key-wrap/migration"],
  ["POST", "/v1/shared-vaults/vault_1/accounts/migration"],
  ["POST", "/v1/shared-vaults/vault_1/accounts"],
  ["PATCH", "/v1/shared-vaults/vault_1/accounts"],
  ["DELETE", "/v1/shared-vaults/vault_1/accounts"],
  ["PUT", "/v1/shared-vaults/vault_1/accounts"],
  ["GET", "/v1/shared-vaults/vault_1/audit-events"],
  ["POST", "/v1/shared-vaults/vault_1/audit-events"],
  ["POST", "/v1/shared-vaults/vault_1/leave"],
  ["DELETE", "/v1/shared-vaults/vault_1/lifecycle"],
  ["POST", "/v1/shared-vaults/vault_1/lifecycle"],
  ["GET", "/v1/shared-vaults/vault_1/member-permissions"],
  ["PATCH", "/v1/shared-vaults/vault_1/member-permissions"],
  ["PATCH", "/v1/shared-vaults/vault_1/members/user_1"],
  ["DELETE", "/v1/shared-vaults/vault_1/members/user_1"],
  ["GET", "/v1/shared-vaults/vault_1/participants"],
  ["GET", "/v1/shared-vaults/vault_1/rotation"],
  ["PATCH", "/v1/shared-vaults/vault_1/rotation"],
  ["POST", "/v1/shared-vaults/vault_1/share-links"],
  ["DELETE", "/v1/shared-vaults/vault_1/share-links/invitation_1"],
  ["GET", "/v1/secure-share-links"],
  ["POST", "/v1/secure-share-links"],
  ["GET", "/v1/vaults/vault_1/accounts"],
  ["POST", "/v1/vaults/vault_1/accounts/migration"],
  ["POST", "/v1/vaults/vault_1/accounts"],
  ["PATCH", "/v1/vaults/vault_1/accounts"],
  ["DELETE", "/v1/vaults/vault_1/accounts"],
  ["PUT", "/v1/vaults/vault_1/accounts"],
  ["POST", "/v1/vaults/vault_1/archive-exports"],
  ["GET", "/v1/vaults/vault_1/audit-events"],
  ["POST", "/v1/vaults/vault_1/audit-events"],
  ["GET", "/v1/sync/offline-bundle"],
  ["GET", "/v1/sync/workspace-bundle"],
];

const operationBoundaryFixtureSchema = z
  .object({
    note: z.string(),
    request: z
      .object({
        origin: z.string(),
        requestId: z.string(),
        contentType: z.string(),
        nonGetBody: z.string(),
        fixedTime: z.string(),
      })
      .strict(),
    routes: z
      .array(
        z
          .object({
            method: z.string(),
            path: z.string(),
            status: z.number().int(),
            headers: z.record(z.string(), z.string()),
            body: z.unknown(),
          })
          .strict(),
      )
      .length(70),
  })
  .strict();
const operationBoundaryFixture = operationBoundaryFixtureSchema.parse(
  JSON.parse(
    readFileSync(
      new URL("../../../packages/api-contract/test-fixtures/operation-boundaries.json", import.meta.url),
      "utf8",
    ),
  ),
);

describe("canonical API route parity", () => {
  it("covers every registered operation, including deletion and dynamic aliases", () => {
    expect(routes).toHaveLength(70);
    expect(new Set(routes.map(([method, path]) => `${method} ${path}`)).size).toBe(70);
    expect(routes).toEqual(API_ROUTE_MANIFEST.map(([method, path]) => [method, materialize(path)]));
    expect(operationBoundaryFixture.routes.map(({ method, path }) => [method, path])).toEqual(routes);
  });

  it("passes executable runtime-parity scenarios to compare for all 70 operations", () => {
    const scenarioFiles = [
      { path: "../scripts/runtime-parity-personal.ts", runners: ["runPersonalParityScenarios"] },
      { path: "../scripts/runtime-parity-shared.ts", runners: ["runSharedParityScenarios"] },
      {
        path: "../scripts/runtime-parity-identity.ts",
        runners: ["runE2EIdentityParityScenarios", "runPasswordlessSessionParityScenarios"],
      },
      { path: "../scripts/runtime-parity-system.ts", runners: ["runSystemParityScenarios"] },
    ];
    const runtimeSource = ts.createSourceFile(
      "runtime-parity.ts",
      readFileSync(new URL("../scripts/runtime-parity.ts", import.meta.url), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const invokedRunners = new Set<string>();
    const collectRunnerInvocations = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) invokedRunners.add(node.expression.text);
      ts.forEachChild(node, collectRunnerInvocations);
    };
    collectRunnerInvocations(runtimeSource);

    const covered = new Set<string>();
    for (const scenarioFile of scenarioFiles) {
      const sourceFile = ts.createSourceFile(
        scenarioFile.path,
        readFileSync(new URL(scenarioFile.path, import.meta.url), "utf8"),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const functionDeclarations = new Map<string, ts.FunctionDeclaration>();
      for (const statement of sourceFile.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) {
          functionDeclarations.set(statement.name.text, statement);
        }
      }
      for (const runnerName of scenarioFile.runners) {
        const runner = sourceFile.statements.find(
          (statement): statement is ts.FunctionDeclaration =>
            ts.isFunctionDeclaration(statement) &&
            statement.name?.text === runnerName &&
            ts.canHaveModifiers(statement) &&
            (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
        );
        expect(runner?.body, `${scenarioFile.path} exports ${runnerName}`).toBeDefined();
        expect(invokedRunners.has(runnerName), `runtime-parity.ts invokes ${runnerName}`).toBe(true);
        if (!runner?.body) continue;

        const compareCalls = collectRuntimeCompareCalls(runner, functionDeclarations);
        expect(compareCalls.length, `${runnerName} must call compare`).toBeGreaterThan(0);

        for (const call of compareCalls) {
          expect(call.arguments.length, `${runnerName} compare call has a scenario`).toBeGreaterThan(0);
          for (const argument of call.arguments) {
            expect(ts.isObjectLiteralExpression(argument), `${runnerName} passes a literal scenario to compare`).toBe(
              true,
            );
            if (!ts.isObjectLiteralExpression(argument)) continue;
            const method = scenarioPropertyString(argument, "method");
            const rawPath = scenarioPropertyString(argument, "path");
            expect(method, `${runnerName} scenario method`).toMatch(/^[A-Z]+$/);
            expect(rawPath, `${runnerName} scenario path`).toBeDefined();
            if (!method || !rawPath) continue;
            const path = rawPath.split("?", 1)[0]?.replace(/\$\{[^}]+\}/g, "runtime-param");
            if (!path) continue;
            const routePath = path.startsWith("/v1/") ? path.slice(3) : path;
            const matchedRoutes = API_ROUTE_MANIFEST.filter(
              ([expectedMethod, route]) => method === expectedMethod && routePattern(route).test(routePath),
            );
            expect(matchedRoutes, `${method} ${routePath} matches a manifest operation`).not.toHaveLength(0);
            for (const [expectedMethod, route] of matchedRoutes) covered.add(`${expectedMethod} ${route}`);
          }
        }
      }
    }

    expect([...covered].sort()).toEqual(API_ROUTE_MANIFEST.map(([method, route]) => `${method} ${route}`).sort());
  });

  it.each(routes)("registers %s %s only at /v1", async (method, path) => {
    const response = await app.request(`https://api.example.test${path}`, { method }, bindings);
    expect(response.status).not.toBe(404);
    const unversioned = await app.request(
      `https://api.example.test${path.replace("/v1/", "/api/")}`,
      { method },
      bindings,
    );
    expect(unversioned.status).toBe(404);
  });

  it.each(operationBoundaryFixture.routes)(
    "matches the TypeScript reference boundary for $method $path",
    async ({ method, path, status, headers: expectedHeaders, body }) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(operationBoundaryFixture.request.fixedTime));
      try {
        const response = await app.request(
          `https://api.example.test${path}`,
          {
            method,
            headers: {
              origin: operationBoundaryFixture.request.origin,
              "content-type": operationBoundaryFixture.request.contentType,
              "x-request-id": operationBoundaryFixture.request.requestId,
            },
            body: method === "GET" ? undefined : operationBoundaryFixture.request.nonGetBody,
          },
          {
            ...bindings,
            AUTH_BACKEND: "none",
            AUTH_MAGIC_LINK_SECRET: "boundary-test-magic-secret-12345678901234567890",
            AUTH_SESSION_SECRET: "boundary-test-session-secret-12345678901234567890",
            SMTP_HOST: "127.0.0.1",
            SMTP_PORT: "2525",
            SMTP_SECURE: "false",
            SMTP_REQUIRE_TLS: "true",
            SMTP_USER: "boundary-test-smtp-user",
            SMTP_PASSWORD: "boundary-test-smtp-password",
            AUTH_EMAIL_FROM: "no-reply@boundary.test",
            DATABASE_CLIENT: {} as NonNullable<ApiBindings["DATABASE_CLIENT"]>,
          },
        );
        expect(response.status, `${method} ${path}`).toBe(status);
        for (const [name, value] of Object.entries(expectedHeaders)) {
          expect(response.headers.get(name), `${method} ${path} ${name}`).toBe(value);
        }
        if (status === 204) {
          expect(body).toBe("");
          expect(await response.text()).toBe("");
          return;
        }
        expect(await response.json(), `${method} ${path} body`).toEqual(body);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(["/v1/me/deletion/oidc/start", "/v1/me/deletion/oidc/complete"])(
    "does not register removed OIDC deletion route %s",
    async (path) => {
      const response = await app.request(
        `https://api.example.test${path}`,
        { method: "POST" },
        {
          ...bindings,
          AUTH_BACKEND: "none",
          DATABASE_CLIENT: {} as NonNullable<ApiBindings["DATABASE_CLIENT"]>,
        },
      );
      expect(response.status).toBe(404);
    },
  );

  it("provides Hono HEAD behavior for public system routes", async () => {
    for (const path of ["/v1/health", "/v1/time"]) {
      const response = await app.request(`https://api.example.test${path}`, { method: "HEAD" }, bindings);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
    }
  });

  it("rejects HEAD on retention purge before running the destructive operation", async () => {
    let purgeCalls = 0;
    const runtimeDependencies: ApiRuntimeDependencies = {
      identity: {} as ApiRuntimeDependencies["identity"],
      applicationRuntime: {
        retentionPurge: () => {
          purgeCalls += 1;
          return async () => {
            throw new Error("retention purge must not run for HEAD");
          };
        },
      } as unknown as ApiRuntimeDependencies["applicationRuntime"],
    };
    const cronSecret = "c".repeat(32);
    const runtimeApp = createApiApp({ runtimeDependencies });
    const response = await runtimeApp.request(
      "https://api.example.test/v1/internal/retention-purge",
      { method: "HEAD", headers: { authorization: `Bearer ${cronSecret}` } },
      {
        ...bindings,
        DATABASE_CLIENT: {} as NonNullable<ApiBindings["DATABASE_CLIENT"]>,
        CRON_SECRET: cronSecret,
      },
    );

    expect(response.status).toBe(405);
    expect(await response.text()).toBe("");
    expect(purgeCalls).toBe(0);
  });
});

function scenarioPropertyString(object: ts.ObjectLiteralExpression, propertyName: string): string | undefined {
  const property = object.properties.find(
    (member): member is ts.PropertyAssignment =>
      ts.isPropertyAssignment(member) &&
      ((ts.isIdentifier(member.name) && member.name.text === propertyName) ||
        (ts.isStringLiteral(member.name) && member.name.text === propertyName)),
  );
  if (!property) return undefined;
  const expression = property.initializer;
  if (ts.isStringLiteralLike(expression)) return expression.text;
  if (!ts.isTemplateExpression(expression)) return undefined;
  return `${expression.head.text}${expression.templateSpans.map((span) => `runtime-param${span.literal.text}`).join("")}`;
}

function collectRuntimeCompareCalls(
  runner: ts.FunctionDeclaration,
  functions: ReadonlyMap<string, ts.FunctionDeclaration>,
): ts.CallExpression[] {
  const compareCalls: ts.CallExpression[] = [];
  const visited = new Set<string>();
  const visitFunction = (declaration: ts.FunctionDeclaration): void => {
    const name = declaration.name?.text;
    if (!name || visited.has(name) || !declaration.body) return;
    visited.add(name);
    const visitNode = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node)) return;
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (node.expression.text === "compare") compareCalls.push(node);
        const calledFunction = functions.get(node.expression.text);
        if (calledFunction) visitFunction(calledFunction);
      }
      ts.forEachChild(node, visitNode);
    };
    visitNode(declaration.body);
  };
  visitFunction(runner);
  return compareCalls;
}

function routePattern(route: string): RegExp {
  const segments = route.split("/").map((segment) => (segment.startsWith(":") ? "[^/]+" : segment));
  return new RegExp(`^${segments.join("/")}$`);
}

function materialize(path: string): string {
  return `/v1${path}`
    .replace(":vaultId", "vault_1")
    .replace(":userId", "user_1")
    .replace(":invitationId", "invitation_1");
}
