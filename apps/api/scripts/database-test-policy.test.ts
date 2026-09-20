import { describe, expect, it } from "vitest";
import { describeDatabaseTarget, requiresDatabaseIntegration } from "./database-test-policy";

describe("database test policy", () => {
  it("requires database integration in CI or when explicitly requested", () => {
    expect(requiresDatabaseIntegration({ CI: "true" })).toBe(true);
    expect(requiresDatabaseIntegration({ REQUIRE_DATABASE_INTEGRATION: "1" })).toBe(true);
    expect(requiresDatabaseIntegration({})).toBe(false);
  });

  it("describes a database target without credentials or query parameters", () => {
    expect(
      describeDatabaseTarget("postgresql://test-user:test-password@example.test:5432/example_db?sslmode=require"),
    ).toBe("postgresql://example.test:5432/example_db");
  });

  it("does not expose malformed connection strings", () => {
    expect(describeDatabaseTarget("not-a-database-url")).toBe("the configured database");
  });
});
