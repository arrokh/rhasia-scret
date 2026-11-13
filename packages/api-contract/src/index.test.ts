/// <reference types="node" />

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import {
  API_ROUTE_MANIFEST,
  API_VERSION_PREFIX,
  apiErrorSchema,
  apiPath,
  browserApiPath,
  healthResponseSchema,
  isVersionedApiPath,
  timeResponseSchema,
} from "./index";

const routeMethodSchema = z.enum(["GET", "POST", "PATCH", "PUT", "DELETE"]);
const routeGoldenSchema = z.array(z.object({ method: routeMethodSchema, route: z.string() }).strict());
const openApiInventorySchema = z
  .object({
    openapi: z.literal("3.1.0"),
    servers: z.array(z.object({ url: z.string() }).passthrough()).min(1),
    paths: z.record(z.string(), z.record(z.string(), z.unknown())),
    "x-rhasia-operation-order": z.array(z.object({ method: routeMethodSchema, path: z.string() }).strict()),
  })
  .passthrough();
const httpExampleSchema = z.object({
  method: z.string(),
  path: z.string(),
  status: z.number().int(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown(),
});
const httpGoldenSchema = z
  .object({
    note: z.string(),
    health: httpExampleSchema,
    time: httpExampleSchema,
    sessionRevoke: httpExampleSchema,
    invalidProxy: httpExampleSchema.extend({ mustNotEchoHeaders: z.array(z.string()) }),
    headHealth: httpExampleSchema,
  })
  .strict();

const routeGolden = routeGoldenSchema.parse(
  JSON.parse(readFileSync(new URL("../test-fixtures/route-manifest.json", import.meta.url), "utf8")),
);
const openApi = openApiInventorySchema.parse(parse(readFileSync(new URL("../openapi.yaml", import.meta.url), "utf8")));
const httpGolden = httpGoldenSchema.parse(
  JSON.parse(readFileSync(new URL("../test-fixtures/http-golden.json", import.meta.url), "utf8")),
);

const methodNames = new Set(routeMethodSchema.options.map((method) => method.toLowerCase()));
const openApiComponents = z
  .object({
    schemas: z.record(z.string(), z.unknown()),
    responses: z.record(z.string(), z.unknown()),
    parameters: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()
  .parse(openApi["components"]);

function openApiOperation(path: string, method: string): Record<string, unknown> {
  const pathItem = z.record(z.string(), z.unknown()).parse(openApi.paths[path]);
  return z.record(z.string(), z.unknown()).parse(pathItem[method]);
}

function resolveOpenApiResponse(rawResponse: unknown, label: string): Record<string, unknown> {
  const response = z.record(z.string(), z.unknown()).parse(rawResponse);
  if (typeof response.$ref !== "string") return response;

  const prefix = "#/components/responses/";
  expect(response.$ref.startsWith(prefix), label).toBe(true);
  const name = response.$ref.slice(prefix.length);
  expect(name, label).not.toContain("/");
  return z.record(z.string(), z.unknown()).parse(openApiComponents.responses[name]);
}

function assertOpenApiResponseSchema(rawSchema: unknown, label: string, seen = new Set<string>()): void {
  const schema = z.record(z.string(), z.unknown()).parse(rawSchema);
  expect(Object.keys(schema), label).not.toHaveLength(0);

  if (typeof schema.$ref === "string") {
    const prefix = "#/components/schemas/";
    expect(schema.$ref.startsWith(prefix), label).toBe(true);
    const name = schema.$ref.slice(prefix.length);
    expect(name, label).not.toContain("/");
    expect(openApiComponents.schemas[name], label).toBeDefined();
    if (seen.has(name)) return;
    seen.add(name);
    assertOpenApiResponseSchema(openApiComponents.schemas[name], label, seen);
    return;
  }

  for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
    const branches = schema[keyword];
    if (!Array.isArray(branches)) continue;
    expect(branches, label).not.toHaveLength(0);
    for (const branch of branches) assertOpenApiResponseSchema(branch, label, seen);
    return;
  }

  if (schema.type === "object" || schema.properties !== undefined) {
    const properties = z.record(z.string(), z.unknown()).safeParse(schema.properties);
    expect(properties.success && Object.keys(properties.data).length > 0, label).toBe(true);
    if (properties.success) {
      for (const [name, property] of Object.entries(properties.data)) {
        assertOpenApiResponseSchema(property, `${label}.${name}`, seen);
      }
    }
    return;
  }

  if (schema.type === "array") {
    expect(schema.items, label).toBeDefined();
    assertOpenApiResponseSchema(schema.items, `${label}[]`, seen);
    return;
  }

  expect(schema.type !== undefined || schema.enum !== undefined || schema.const !== undefined, label).toBe(true);
}

function assertStrictRequestSchema(rawSchema: unknown, label: string, seen = new Set<string>()): void {
  const schema = z.record(z.string(), z.unknown()).parse(rawSchema);
  if (typeof schema.$ref === "string") {
    const prefix = "#/components/schemas/";
    expect(schema.$ref.startsWith(prefix), label).toBe(true);
    const name = schema.$ref.slice(prefix.length);
    expect(name, label).not.toContain("/");
    expect(openApiComponents.schemas[name], label).toBeDefined();
    if (seen.has(name)) return;
    seen.add(name);
    assertStrictRequestSchema(openApiComponents.schemas[name], label, seen);
    return;
  }

  for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
    const branches = schema[keyword];
    if (!Array.isArray(branches)) continue;
    expect(branches, label).not.toHaveLength(0);
    for (const branch of branches) assertStrictRequestSchema(branch, label, seen);
    return;
  }

  expect(schema.type === "object" || schema.properties !== undefined, label).toBe(true);
  expect(schema.additionalProperties, label).toBe(false);
}

const manifestOperations = (routes: ReadonlyArray<readonly [string, string]>) =>
  routes.map(([method, path]) => `${method} ${path}`);
const goldenOperations = routeGolden.map(({ method, route }) => `${method} ${route}`);
const openApiOperations = Object.entries(openApi.paths).flatMap(([path, pathItem]) =>
  Object.keys(pathItem)
    .filter((method) => methodNames.has(method))
    .map((method) => `${method.toUpperCase()} ${path.replace(/\{([A-Za-z0-9_]+)\}/g, ":$1")}`),
);

describe("API contract", () => {
  it("keeps the OpenAPI operation inventory, generated TypeScript manifest, and frozen golden inventory aligned", () => {
    expect(API_ROUTE_MANIFEST).toHaveLength(70);
    expect(new Set(manifestOperations(API_ROUTE_MANIFEST)).size).toBe(70);
    expect(manifestOperations(API_ROUTE_MANIFEST)).toEqual(goldenOperations);
    expect(openApi["x-rhasia-operation-order"].map(({ method, path }) => `${method} ${path}`)).toEqual(
      goldenOperations,
    );
    expect(new Set(openApiOperations)).toEqual(new Set(goldenOperations));
    expect(openApiOperations).toHaveLength(70);
  });

  it("declares the explicit HEAD route inventory consumed by the Go generator", () => {
    const headPaths = Object.entries(openApi.paths).flatMap(([path, rawPathItem]) => {
      const pathItem = z.record(z.string(), z.unknown()).parse(rawPathItem);
      if (!pathItem.get) return [];
      const operation = z.record(z.string(), z.unknown()).parse(pathItem.get);
      return operation["x-rhasia-head"] === true ||
        operation["x-rhasia-head-behavior"] === "reject-with-405-without-purge"
        ? [path]
        : [];
    });
    expect(new Set(headPaths)).toEqual(
      new Set([
        "/health",
        "/time",
        "/internal/retention-purge",
        "/me",
        "/me/deletion/preview",
        "/passkey-recovery/status",
        "/personal-vault",
        "/personal-vault/destructive-reset",
        "/user-crypto-profile",
        "/user-encryption-identity/rotation",
        "/shared-vaults",
        "/shared-vaults/{vaultId}",
        "/shared-vaults/{vaultId}/audit-events",
        "/shared-vaults/{vaultId}/member-permissions",
        "/shared-vaults/{vaultId}/participants",
        "/shared-vaults/{vaultId}/rotation",
        "/secure-share-links",
        "/vaults/{vaultId}/accounts",
        "/vaults/{vaultId}/audit-events",
        "/sync/offline-bundle",
        "/sync/workspace-bundle",
      ]),
    );
    expect(headPaths).toHaveLength(21);
  });

  it("documents JSON origin failures, actual cookie behavior, and OTP body limits", () => {
    const deleteUnauthenticated = openApiOperation("/me", "delete");
    const deleteResponses = z.record(z.string(), z.unknown()).parse(deleteUnauthenticated.responses);
    const deleteUnauthorized = z.record(z.string(), z.unknown()).parse(deleteResponses["401"]);
    expect(z.record(z.string(), z.unknown()).parse(deleteUnauthorized.headers)).not.toHaveProperty("Set-Cookie");

    for (const [path, method] of [
      ["/me", "delete"],
      ["/me/deletion/otp/request", "post"],
      ["/me/deletion/otp/verify", "post"],
    ]) {
      const operation = openApiOperation(path, method);
      const responses = z.record(z.string(), z.unknown()).parse(operation.responses);
      const forbidden = z.record(z.string(), z.unknown()).parse(responses["403"]);
      expect(forbidden["x-rhasia-empty-body-outcomes"], `${method.toUpperCase()} ${path}`).toBeUndefined();
    }
    expect(openApiOperation("/me/deletion/otp/verify", "post")["x-rhasia-body-limit-bytes"]).toBe(262144);
  });

  it("models passwordless auth wire schemas and concrete response status sets", () => {
    const contract = z
      .object({
        paths: z.record(z.string(), z.record(z.string(), z.unknown())),
        components: z.object({
          schemas: z.record(z.string(), z.unknown()),
          responses: z.record(z.string(), z.unknown()),
        }),
      })
      .passthrough()
      .parse(openApi);
    const cases = [
      {
        path: "/auth/magic-link/request",
        method: "post",
        operationId: "postAuthMagiclinkRequest",
        request: "MagicLinkRequest",
        statuses: ["200", "400", "403", "429", "503"],
      },
      {
        path: "/auth/magic-link/redeem",
        method: "post",
        operationId: "postAuthMagiclinkRedeem",
        request: "MagicLinkRedeemRequest",
        statuses: ["200", "400", "403"],
      },
      {
        path: "/auth/pwa/session",
        method: "post",
        operationId: "postAuthPwaSession",
        request: "PwaSessionRequest",
        statuses: ["200", "202", "400", "401", "403"],
      },
      {
        path: "/auth/session/refresh",
        method: "post",
        operationId: "postAuthSessionRefresh",
        request: "RefreshSessionRequest",
        statuses: ["200", "400", "401", "403"],
      },
      {
        path: "/auth/session/revoke",
        method: "post",
        operationId: "postAuthSessionRevoke",
        statuses: ["204", "400", "403"],
      },
      { path: "/me", method: "get", operationId: "getMe", statuses: ["200", "401", "403", "503"] },
      {
        path: "/me",
        method: "delete",
        operationId: "deleteMe",
        request: "AccountDeletionRequest",
        statuses: ["200", "400", "401", "403", "409", "429", "503"],
      },
      {
        path: "/me/deletion/preview",
        method: "get",
        operationId: "getMeDeletionPreview",
        statuses: ["200", "401", "403", "503"],
      },
      {
        path: "/me/deletion/otp/request",
        method: "post",
        operationId: "postMeDeletionOtpRequest",
        statuses: ["204", "401", "403", "409", "429", "503"],
      },
      {
        path: "/me/deletion/otp/verify",
        method: "post",
        operationId: "postMeDeletionOtpVerify",
        request: "AccountDeletionOtpVerifyRequest",
        statuses: ["204", "400", "401", "403", "429", "503"],
      },
      {
        path: "/passkey-recovery/registration/options",
        method: "post",
        operationId: "postPasskeyrecoveryRegistrationOptions",
        statuses: ["200", "401", "403", "429", "503"],
      },
      {
        path: "/passkey-recovery/registration/verify",
        method: "post",
        operationId: "postPasskeyrecoveryRegistrationVerify",
        request: "PasskeyRegistrationVerifyRequest",
        statuses: ["204", "400", "401", "403", "429", "503"],
      },
      {
        path: "/passkey-recovery/authentication/options",
        method: "post",
        operationId: "postPasskeyrecoveryAuthenticationOptions",
        statuses: ["200", "401", "403", "404", "429", "503"],
      },
      {
        path: "/passkey-recovery/authentication/verify",
        method: "post",
        operationId: "postPasskeyrecoveryAuthenticationVerify",
        request: "PasskeyAuthenticationVerifyRequest",
        statuses: ["200", "400", "401", "403", "429", "503"],
      },
      {
        path: "/passkey-recovery/status",
        method: "get",
        operationId: "getPasskeyrecoveryStatus",
        statuses: ["200", "401", "403", "500"],
      },
      {
        path: "/passkey-recovery",
        method: "delete",
        operationId: "deletePasskeyrecovery",
        statuses: ["204", "401", "403", "429", "500", "503"],
      },
      {
        path: "/user-crypto-profile",
        method: "get",
        operationId: "getUsercryptoprofile",
        statuses: ["200", "401", "403", "404", "500"],
      },
      {
        path: "/user-crypto-profile/rewrap",
        method: "post",
        operationId: "postUsercryptoprofileRewrap",
        request: "UserCryptoProfileRewrapRequest",
        statuses: ["204", "400", "401", "403", "429", "500", "503"],
      },
      {
        path: "/user-crypto-profile/migration",
        method: "post",
        operationId: "postUsercryptoprofileMigration",
        request: "UserCryptoProfileMigrationRequest",
        statuses: ["204", "400", "401", "403", "409", "429", "500", "503"],
      },
      {
        path: "/user-encryption-identity",
        method: "put",
        operationId: "putUserencryptionidentity",
        request: "UserEncryptionIdentityRegistrationRequest",
        statuses: ["204", "400", "401", "403", "409", "429", "500", "503"],
      },
      {
        path: "/user-encryption-identity/migration",
        method: "post",
        operationId: "postUserencryptionidentityMigration",
        request: "UserEncryptionPrivateKeyMigrationRequest",
        statuses: ["204", "400", "401", "403", "409", "429", "500", "503"],
      },
      {
        path: "/user-encryption-identity/rotation",
        method: "get",
        operationId: "getUserencryptionidentityRotation",
        statuses: ["200", "401", "403", "409", "500"],
      },
      {
        path: "/user-encryption-identity/rotation",
        method: "patch",
        operationId: "patchUserencryptionidentityRotation",
        request: "UserEncryptionIdentityRotationRequest",
        statuses: ["204", "400", "401", "403", "409", "429", "500", "503"],
      },
    ];

    for (const expected of cases) {
      const pathItem = contract.paths[expected.path];
      expect(pathItem, expected.path).toBeDefined();
      const operation = z
        .object({
          operationId: z.string(),
          responses: z.record(z.string(), z.unknown()),
          requestBody: z.unknown().optional(),
        })
        .passthrough()
        .parse(pathItem?.[expected.method]);
      expect(operation.operationId).toBe(expected.operationId);
      expect(operation["x-rhasia-contract-status"]).toBeUndefined();
      const expectedStatuses = new Set(expected.statuses);
      expectedStatuses.add("403");
      expectedStatuses.add("500");
      if (expected.path !== "/health" && expected.path !== "/time") expectedStatuses.add("503");
      if (expected.path.includes("{")) expectedStatuses.add("400");
      if (expected.operationId === "getInternalRetentionpurge") expectedStatuses.add("405");
      expect(Object.keys(operation.responses)).toEqual(
        [...expectedStatuses].sort((left, right) => Number(left) - Number(right)),
      );

      if (expected.request) {
        const body = z
          .object({
            required: z.literal(true),
            content: z.record(z.string(), z.unknown()),
          })
          .passthrough()
          .parse(operation.requestBody);
        const jsonContent = z
          .object({ schema: z.object({ $ref: z.string() }).passthrough() })
          .passthrough()
          .parse(body.content["application/json"]);
        expect(jsonContent.schema.$ref).toBe(`#/components/schemas/${expected.request}`);
      } else {
        expect(operation.requestBody).toBeUndefined();
      }
    }

    const schemas = contract.components.schemas;
    expect(schemas.MagicLinkRequest).toMatchObject({
      oneOf: expect.any(Array),
      discriminator: { propertyName: "client" },
    });
    expect(schemas.PwaSessionRequest).toMatchObject({ oneOf: expect.any(Array) });
    expect(schemas.MagicLinkRedeemRequest).toMatchObject({ additionalProperties: false });
    expect(schemas.UserCryptoProfileResponse).toMatchObject({
      additionalProperties: false,
      required: ["vaultUnlockSalt", "wrappedUserRootKey", "encryptedPersonalVaultKey", "encryptionVersion"],
    });
    expect(schemas.UserCryptoProfileRewrapRequest).toMatchObject({ additionalProperties: false });
    expect(schemas.UserCryptoProfileMigrationRequest).toMatchObject({ additionalProperties: false, minProperties: 1 });
    expect(schemas.UserEncryptionPublicKey).toMatchObject({
      additionalProperties: false,
      required: ["kty", "crv", "x", "y"],
    });
    expect(schemas.UserEncryptionIdentityRegistrationRequest).toMatchObject({ additionalProperties: false });
    expect(schemas.UserEncryptionPrivateKeyMigrationRequest).toMatchObject({
      additionalProperties: false,
      "x-rhasia-operation-id-matches": "replacementCiphertextDigest",
    });
    expect(schemas.UserEncryptionIdentityRotationRequest).toMatchObject({
      additionalProperties: false,
      "x-rhasia-unique-membership-field": "vaultId",
      "x-rhasia-body-limit-bytes": 16 * 1024 * 1024,
    });
    expect(schemas.UserEncryptionIdentityRotationSnapshotResponse).toMatchObject({
      additionalProperties: false,
      "x-rhasia-response-body-limit-bytes": 16 * 1024 * 1024,
    });
    expect(schemas.AccountPayloadMigrationRequest).toMatchObject({
      additionalProperties: false,
      properties: { accountId: { type: "string", minLength: 1, maxLength: 128, pattern: "^\\S+$" } },
    });
    expect(contract.components.responses.InvalidRequest).toBeDefined();
  });

  it("keeps the version segment canonical and browser-only proxy prefix separate", () => {
    expect(API_VERSION_PREFIX).toBe("/v1");
    expect(apiPath("health")).toBe("/v1/health");
    expect(apiPath("/v1/time")).toBe("/v1/time");
    expect(browserApiPath("/time")).toBe("/api/v1/time");
    expect(isVersionedApiPath("/v1/health")).toBe(true);
    expect(isVersionedApiPath("/health")).toBe(false);
  });

  it("validates the synthetic golden HTTP examples and preserved no-store/empty-body behavior", () => {
    expect(healthResponseSchema.parse(httpGolden.health.body)).toEqual({ status: "ok" });
    expect(timeResponseSchema.parse(httpGolden.time.body)).toEqual({ now: "2026-11-10T00:00:00.000Z" });
    expect(apiErrorSchema.parse(httpGolden.invalidProxy.body).error).toBe("forbidden");
    expect(httpGolden.health).toMatchObject({
      method: "GET",
      path: "/health",
      status: 200,
      headers: { "cache-control": "no-store" },
    });
    expect(httpGolden.time.headers?.["cache-control"]).toBe("no-store");
    expect(httpGolden.sessionRevoke).toMatchObject({ method: "POST", status: 204, body: "" });
    expect(httpGolden.headHealth).toMatchObject({ method: "HEAD", status: 200, body: "" });
    expect(httpGolden.invalidProxy.mustNotEchoHeaders).toContain("x-rhasia-proxy-secret");
  });

  it("validates public success and generic error envelopes", () => {
    expect(healthResponseSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
    expect(timeResponseSchema.parse({ now: "2026-09-16T00:00:00.000Z" })).toEqual({
      now: "2026-09-16T00:00:00.000Z",
    });
    expect(apiErrorSchema.parse({ error: "not_found", requestId: "safe-id" }).error).toBe("not_found");
  });

  it("requires endpoint-level contracts instead of route-inventory placeholders", () => {
    const operations = Object.entries(openApi.paths).flatMap(([path, pathItem]) =>
      Object.entries(pathItem)
        .filter(([method]) => methodNames.has(method))
        .map(([method, raw]) => ({ path, method, raw })),
    );
    expect(operations).toHaveLength(70);

    for (const { path, method, raw } of operations) {
      const operation = z
        .object({
          operationId: z.string().min(1),
          summary: z.string().min(1),
          tags: z.array(z.string()).min(1),
          responses: z.record(z.string(), z.unknown()),
        })
        .passthrough()
        .parse(raw);
      expect(operation["x-rhasia-contract-status"], `${method.toUpperCase()} ${path}`).toBeUndefined();
      expect(Object.keys(operation.responses), `${method.toUpperCase()} ${path}`).not.toContain("default");
      expect(
        operation["x-rhasia-auth"] ?? operation["x-rhasia-auth-assurance"] ?? operation["x-rhasia-cron-auth"],
        `${method.toUpperCase()} ${path}`,
      ).toBeDefined();
      expect(operation.responses["403"], `${method.toUpperCase()} ${path}`).toBeDefined();
      expect(operation.responses["500"], `${method.toUpperCase()} ${path}`).toBeDefined();
      if (path !== "/health" && path !== "/time")
        expect(operation.responses["503"], `${method.toUpperCase()} ${path}`).toBeDefined();
      if (path.includes("{")) expect(operation.responses["400"], `${method.toUpperCase()} ${path}`).toBeDefined();

      for (const [status, rawResponse] of Object.entries(operation.responses)) {
        const label = `${method.toUpperCase()} ${path} ${status}`;
        expect(status, label).toMatch(/^[1-5][0-9]{2}$/u);
        const response = resolveOpenApiResponse(rawResponse, label);
        expect(response.description, label).toEqual(expect.any(String));
        expect((response.description as string).length, label).toBeGreaterThan(0);
        const headers = z.record(z.string(), z.unknown()).parse(response.headers);
        expect(headers["Cache-Control"], label).toBeDefined();
        expect(headers["X-Request-Id"], label).toBeDefined();
        if (status === "403")
          expect(z.array(z.string()).parse(response["x-rhasia-error-codes"]), label).toContain("forbidden");
        if (status === "400" && path.includes("{"))
          expect(z.array(z.string()).parse(response["x-rhasia-error-codes"]), label).toContain("invalid_request");
        if (status === "500")
          expect(z.array(z.string()).parse(response["x-rhasia-error-codes"]), label).toContain("internal_error");
        if (status === "503")
          expect(z.array(z.string()).parse(response["x-rhasia-error-codes"]), label).toEqual(
            expect.arrayContaining(["api_misconfigured", "authentication_misconfigured"]),
          );
        if (status === "204" || status === "304") {
          expect(response.content, label).toBeUndefined();
          continue;
        }
        const content = z.record(z.string(), z.unknown()).parse(response.content);
        const jsonContent = z.object({ schema: z.unknown() }).passthrough().parse(content["application/json"]);
        assertOpenApiResponseSchema(jsonContent.schema, label);
      }

      if (operation.requestBody !== undefined) {
        const requestBody = z
          .object({ required: z.literal(true), content: z.record(z.string(), z.unknown()) })
          .passthrough()
          .parse(operation.requestBody);
        const jsonContent = z
          .object({ schema: z.unknown() })
          .passthrough()
          .parse(requestBody.content["application/json"]);
        assertStrictRequestSchema(jsonContent.schema, `${method.toUpperCase()} ${path} request`);
        expect(operation["x-rhasia-json-strict"], `${method.toUpperCase()} ${path}`).toBe(true);
        expect(operation["x-rhasia-body-limit-bytes"], `${method.toUpperCase()} ${path}`).toEqual(expect.any(Number));
      }

      if (path.includes("{")) {
        const pathItem = z.record(z.string(), z.unknown()).parse(openApi.paths[path]);
        const pathParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
        const operationParameters = Array.isArray(operation.parameters) ? operation.parameters : [];
        const names = [...pathParameters, ...operationParameters].flatMap((parameter) => {
          const parsed = z.object({ name: z.string(), in: z.string() }).passthrough().safeParse(parameter);
          return parsed.success && parsed.data.in === "path" ? [parsed.data.name] : [];
        });
        for (const [, parameter] of path.matchAll(/\{([A-Za-z0-9_]+)\}/gu)) {
          expect(names, `${method.toUpperCase()} ${path}`).toContain(parameter);
          const definition = [...pathParameters, ...operationParameters]
            .flatMap((rawParameter) => {
              const parsed = z
                .object({ name: z.string(), in: z.string(), schema: z.record(z.string(), z.unknown()) })
                .passthrough()
                .safeParse(rawParameter);
              return parsed.success && parsed.data.in === "path" ? [parsed.data] : [];
            })
            .find(({ name }) => name === parameter);
          expect(definition, `${method.toUpperCase()} ${path} ${parameter}`).toBeDefined();
          expect(definition?.schema, `${method.toUpperCase()} ${path} ${parameter}`).toMatchObject({
            type: "string",
            minLength: 1,
            maxLength: 128,
          });
          expect(definition?.schema.pattern, `${method.toUpperCase()} ${path} ${parameter}`).toEqual(
            expect.any(String),
          );
        }
      }

      if (operation.operationId === "postMeDeletionOtpVerify") {
        const limited = resolveOpenApiResponse(operation.responses["429"], `${method} ${path} 429`);
        expect(limited["x-rhasia-error-codes"]).toEqual(
          expect.arrayContaining(["deletion_otp_locked", "rate_limited"]),
        );
        expect(z.record(z.string(), z.unknown()).parse(limited.headers)["Retry-After"]).toBeDefined();
      }
      if (operation.operationId === "postPersonalvaultDestructivereset") {
        const failed = resolveOpenApiResponse(operation.responses["500"], `${method} ${path} 500`);
        expect(operation.responses["500"]).toEqual({ $ref: "#/components/responses/DestructiveResetFailed" });
        expect(failed["x-rhasia-error-codes"]).toEqual(["destructive_reset_failed", "internal_error"]);
        const sharedInternalError = z.record(z.string(), z.unknown()).parse(openApiComponents.responses.InternalError);
        expect(sharedInternalError["x-rhasia-error-codes"]).toEqual(["internal_error"]);
        expect(sharedInternalError.description).not.toContain("reset");
      }
      if (operation.operationId === "deleteSharedvaultsVaultIdAccounts") {
        const conflict = resolveOpenApiResponse(operation.responses["409"], `${method} ${path} 409`);
        expect(conflict["x-rhasia-error-codes"]).toContain("stale_revision");
        expect(conflict["x-rhasia-error-codes"]).not.toContain("stale_key_version");
      }
      if (operation.operationId === "putSharedvaultsVaultIdAccounts")
        expect(operation.responses["409"], `${method} ${path}`).toBeUndefined();
      if (operation.operationId === "getInternalRetentionpurge") {
        expect(operation["x-rhasia-head-behavior"]).toBe("reject-with-405-without-purge");
        const head = resolveOpenApiResponse(operation.responses["405"], `${method} ${path} 405`);
        expect(head["x-rhasia-error-codes"]).toContain("method_not_allowed");
      }
    }
  });
});
