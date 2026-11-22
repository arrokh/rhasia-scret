import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");
const coverageIndexPath = resolve(repositoryRoot, "docs/security-review-coverage.md");
const routeAuthorizationMapPath = resolve(repositoryRoot, "docs/security-review-route-authorization-map.json");
const recommendationReviewMapPath = resolve(repositoryRoot, "docs/security-review-recommendation-review-map.json");
const openApiPath = resolve(repositoryRoot, "packages/api-contract/openapi.yaml");
const coverageIndex = readFileSync(coverageIndexPath, "utf8");

type AuthorizationOperation = Readonly<{ method: string; path: string; family: string }>;
type AuthorizationFamily = Readonly<{
  actor: string;
  decision: string;
  sources: readonly string[];
  tests: readonly string[];
}>;
type ExcludedOperation = Readonly<{ method: string; path: string; reason: string }>;
type RouteAuthorizationMap = Readonly<{
  schemaVersion: number;
  canonicalOperationCount: number;
  inScopeOperationCount: number;
  excludedOperations: readonly ExcludedOperation[];
  families: Readonly<Record<string, AuthorizationFamily>>;
  operations: readonly AuthorizationOperation[];
}>;
type RecommendationReviewEntry = Readonly<{
  recommendation: string;
  reviewRecords: readonly string[];
  status: string;
  outcome: string;
  limitations: string;
}>;
type RecommendationReviewMap = Readonly<{
  schemaVersion: number;
  recommendations: readonly RecommendationReviewEntry[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string" && item.length > 0);
}

function isOperation(value: unknown): value is AuthorizationOperation {
  return (
    isRecord(value) && isNonEmptyString(value.method) && isNonEmptyString(value.path) && isNonEmptyString(value.family)
  );
}

function isExcludedOperation(value: unknown): value is ExcludedOperation {
  return (
    isRecord(value) && isNonEmptyString(value.method) && isNonEmptyString(value.path) && isNonEmptyString(value.reason)
  );
}

function isAuthorizationFamily(value: unknown): value is AuthorizationFamily {
  return (
    isRecord(value) &&
    isNonEmptyString(value.actor) &&
    isNonEmptyString(value.decision) &&
    isStringArray(value.sources) &&
    isStringArray(value.tests)
  );
}

function isRecommendationReviewEntry(value: unknown): value is RecommendationReviewEntry {
  return (
    isRecord(value) &&
    isNonEmptyString(value.recommendation) &&
    isStringArray(value.reviewRecords) &&
    isNonEmptyString(value.status) &&
    isNonEmptyString(value.outcome) &&
    isNonEmptyString(value.limitations)
  );
}

function parseRecommendationReviewMap(value: unknown): RecommendationReviewMap {
  if (
    !isRecord(value) ||
    typeof value.schemaVersion !== "number" ||
    !Array.isArray(value.recommendations) ||
    !value.recommendations.every((entry: unknown) => isRecommendationReviewEntry(entry))
  )
    throw new Error("Invalid recommendation review evidence map.");

  return { schemaVersion: value.schemaVersion, recommendations: value.recommendations };
}

function parseRouteAuthorizationMap(value: unknown): RouteAuthorizationMap {
  if (
    !isRecord(value) ||
    typeof value.schemaVersion !== "number" ||
    typeof value.canonicalOperationCount !== "number" ||
    typeof value.inScopeOperationCount !== "number" ||
    !Array.isArray(value.operations) ||
    !value.operations.every((operation: unknown) => isOperation(operation)) ||
    !Array.isArray(value.excludedOperations) ||
    !value.excludedOperations.every((operation: unknown) => isExcludedOperation(operation)) ||
    !isRecord(value.families)
  )
    throw new Error("Invalid security review route authorization map.");

  const families: Record<string, AuthorizationFamily> = {};
  for (const [name, family] of Object.entries(value.families)) {
    if (!isAuthorizationFamily(family)) throw new Error(`Invalid authorization family: ${name}`);
    families[name] = family;
  }

  return {
    schemaVersion: value.schemaVersion,
    canonicalOperationCount: value.canonicalOperationCount,
    inScopeOperationCount: value.inScopeOperationCount,
    excludedOperations: value.excludedOperations,
    families,
    operations: value.operations,
  };
}

function operationKey(operation: Readonly<{ method: string; path: string }>): string {
  return `${operation.method} ${operation.path}`;
}

function tableRowsAfter(heading: string): string[] {
  const [, afterHeading] = coverageIndex.split(`${heading}\n`);
  if (afterHeading === undefined) throw new Error(`Missing section: ${heading}`);

  const section = afterHeading.split("\n## ", 1)[0];
  return section
    .split(/\r?\n/)
    .filter((line) => line.startsWith("|"))
    .slice(2);
}

function tableCells(row: string): [string, string, string] {
  const cells = row.split("|").slice(1, -1);
  const [first, second, third] = cells;
  if (first === undefined || second === undefined || third === undefined || cells.length !== 3) {
    throw new Error(`Expected three table cells: ${row}`);
  }
  return [first, second, third];
}

describe("security review coverage index", () => {
  it("maps each Vault operation family to a source and a final resource decision", () => {
    const rows = tableRowsAfter("## Vault and identity operation crosswalk");

    expect(rows).toHaveLength(15);
    for (const row of rows) {
      const [operations, sources, decision] = tableCells(row);
      expect(operations).toContain("/v1/");
      expect(sources).toMatch(/\]\(\.\.\//);
      expect(decision.trim()).not.toBe("");
    }
  });

  it("links every recommendation to its outcome, regression and review disposition", () => {
    const rows = tableRowsAfter("## Recommendation-to-regression index");
    const reviewMapContents: unknown = JSON.parse(readFileSync(recommendationReviewMapPath, "utf8"));
    const reviewMap = parseRecommendationReviewMap(reviewMapContents);

    expect(rows).toHaveLength(19);
    expect(reviewMap.schemaVersion).toBe(1);
    expect(reviewMap.recommendations).toHaveLength(rows.length);
    for (const [index, row] of rows.entries()) {
      const [recommendation, sources, regression] = tableCells(row);
      const review = reviewMap.recommendations[index];
      if (review === undefined) throw new Error(`Missing review disposition for row ${index + 1}.`);
      expect(recommendation.trim()).not.toBe("");
      expect(sources).toMatch(/\]\(\.\.\//);
      expect(regression).toMatch(/\]\(\.\.\//);
      expect(review.recommendation).toBe(recommendation.trim());
      expect(review.status.trim()).not.toBe("");
      expect(review.outcome.trim()).not.toBe("");
      expect(review.limitations.trim()).not.toBe("");
      if (review.reviewRecords.length === 0) {
        expect(review.status).toMatch(/no retained independent review/i);
      }
      for (const record of review.reviewRecords) {
        expect(record).toMatch(/^(?:CUX-FINAL-REVIEW-\d+|INDEPENDENT-REVIEW-\d+(?:-[A-Z0-9]+(?:-[A-Z0-9]+)*)?)\.txt$/i);
      }
    }
  });

  it("keeps every relative source and regression link resolvable", () => {
    const relativeLinks = [...coverageIndex.matchAll(/\]\(([^)]+)\)/g)]
      .map(([, target]) => target?.split("#", 1)[0])
      .filter((target): target is string => target !== undefined && !/^(?:https?:|mailto:|#)/.test(target));

    expect(relativeLinks.length).toBeGreaterThan(50);
    for (const target of relativeLinks) {
      expect(
        existsSync(resolve(dirname(coverageIndexPath), decodeURIComponent(target))),
        `unresolved coverage-index link: ${target}`,
      ).toBe(true);
    }
  });

  it("maps every non-excluded canonical API operation to an actor and final resource decision", () => {
    const mapContents: unknown = JSON.parse(readFileSync(routeAuthorizationMapPath, "utf8"));
    const routeMap = parseRouteAuthorizationMap(mapContents);
    const openApi = readFileSync(openApiPath, "utf8");
    const canonicalOperations = [...openApi.matchAll(/- \"method\": \"([A-Z]+)\"\r?\n\s+\"path\": \"([^\"]+)\"/g)].map(
      (match) => {
        const method = match[1];
        const path = match[2];
        if (method === undefined || path === undefined) throw new Error("Invalid canonical API operation entry.");
        return `${method} /v1${path}`;
      },
    );
    const excludedOperations = routeMap.excludedOperations.map(operationKey);
    const mappedOperations = routeMap.operations.map(operationKey);
    const explicitlyExcluded = new Set(excludedOperations);
    const mapped = new Set(mappedOperations);
    const expectedInScope = canonicalOperations.filter((operation) => !explicitlyExcluded.has(operation));

    expect(routeMap.schemaVersion).toBe(1);
    expect(routeMap.canonicalOperationCount).toBe(canonicalOperations.length);
    expect(routeMap.inScopeOperationCount).toBe(expectedInScope.length);
    expect(routeMap.excludedOperations).toHaveLength(8);
    expect(routeMap.operations).toHaveLength(62);
    expect(explicitlyExcluded.size).toBe(excludedOperations.length);
    expect(mapped.size).toBe(mappedOperations.length);
    expect([...mapped].sort()).toEqual(expectedInScope.sort());
    expect(new Set([...mapped, ...explicitlyExcluded]).size).toBe(canonicalOperations.length);

    const usedFamilies = new Set(routeMap.operations.map((operation) => operation.family));
    expect(usedFamilies.size).toBe(Object.keys(routeMap.families).length);
    for (const operation of routeMap.operations) {
      const family = routeMap.families[operation.family];
      expect(family, `missing decision family for ${operationKey(operation)}`).toBeDefined();
    }
    for (const [name, family] of Object.entries(routeMap.families)) {
      expect(family.actor.trim(), `${name} actor`).not.toBe("");
      expect(family.decision.trim(), `${name} final decision`).not.toBe("");
      expect(family.sources.length, `${name} source files`).toBeGreaterThan(0);
      expect(family.tests.length, `${name} regression tests`).toBeGreaterThan(0);
      for (const source of [...family.sources, ...family.tests]) {
        expect(existsSync(resolve(repositoryRoot, source)), `${name}: unresolved file ${source}`).toBe(true);
      }
    }
  });
});
