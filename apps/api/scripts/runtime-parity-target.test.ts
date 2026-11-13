import { describe, expect, it } from "vitest";
import { readAndValidateDatabaseURLs } from "./runtime-parity-target";

const runID = "0123456789abcdef";
const containerID = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const base = "postgresql://rhasia_test:rhasia_test_password@127.0.0.1:54321/rhasia_scret_test";
const go = `postgresql://rhasia_test:rhasia_test_password@127.0.0.1:54321/rhasia_scret_parity_go_${runID}`;
const ts = `postgresql://rhasia_test:rhasia_test_password@127.0.0.1:54321/rhasia_scret_parity_ts_${runID}`;

function environment(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    RHSIA_DISPOSABLE_RUN_ID: runID,
    RHSIA_TESTCONTAINER_ID: containerID,
    RHSIA_DISPOSABLE_DATA_CLASSIFICATION: "synthetic",
    DATABASE_URL: `${base}?schema=public`,
    DIRECT_URL: `${base}?schema=public`,
    RHSIA_API_PARITY_GO_DATABASE_URL: `${go}?schema=public`,
    RHSIA_API_PARITY_TS_DATABASE_URL: `${ts}?schema=public`,
    ...overrides,
  };
}

describe("runtime parity disposable target validation", () => {
  it("accepts only matching clone URLs with the harmless public schema option", () => {
    const target = readAndValidateDatabaseURLs(environment());

    expect(target.containerID).toBe(containerID);
    expect(target.baseURL.href).toBe(`${base}?schema=public`);
    expect(target.go).toBe(`${go}?schema=public`);
    expect(target.ts).toBe(`${ts}?schema=public`);
  });

  it.each([
    ["host", "host=198.51.100.10"],
    ["port", "port=5432"],
    ["user", "user=other"],
    ["password", "password=other"],
    ["dbname", "dbname=other"],
    ["hostaddr", "hostaddr=127.0.0.1"],
    ["sslmode", "sslmode=disable"],
    ["unknown", "application_name=redirect"],
    ["non-public schema", "schema=private"],
    ["duplicate schema", "schema=public&schema=public"],
  ])("rejects a connection query override in the Go clone URL (%s)", (_name, query) => {
    expect(() =>
      readAndValidateDatabaseURLs(environment({ RHSIA_API_PARITY_GO_DATABASE_URL: `${go}?${query}` })),
    ).toThrow("Runtime parity database URLs do not match the run-owned Testcontainer clones.");
  });

  it.each([
    ["host", "host=198.51.100.10"],
    ["port", "port=5432"],
    ["user", "user=other"],
    ["password", "password=other"],
    ["dbname", "dbname=other"],
    ["hostaddr", "hostaddr=127.0.0.1"],
    ["sslmode", "sslmode=disable"],
    ["duplicate schema", "schema=public&schema=public"],
  ])("rejects a connection query override in the base URL (%s)", (_name, query) => {
    const target = `${base}?${query}`;
    expect(() => readAndValidateDatabaseURLs(environment({ DATABASE_URL: target, DIRECT_URL: target }))).toThrow(
      "Runtime parity database URLs do not match the run-owned Testcontainer clones.",
    );
  });

  it("rejects unexpected credentials, protocols, and fragments", () => {
    expect(() =>
      readAndValidateDatabaseURLs(
        environment({
          RHSIA_API_PARITY_GO_DATABASE_URL: `${go.replace("rhasia_test_password", "other")}?schema=public`,
        }),
      ),
    ).toThrow("Runtime parity database URLs do not match the run-owned Testcontainer clones.");
    expect(() =>
      readAndValidateDatabaseURLs(
        environment({
          DATABASE_URL: `${base.replace("postgresql:", "https:")}?schema=public`,
          DIRECT_URL: `${base.replace("postgresql:", "https:")}?schema=public`,
        }),
      ),
    ).toThrow("Runtime parity database URLs do not match the run-owned Testcontainer clones.");
    expect(() => readAndValidateDatabaseURLs(environment({ RHSIA_API_PARITY_TS_DATABASE_URL: `${ts}#other` }))).toThrow(
      "Runtime parity database URLs do not match the run-owned Testcontainer clones.",
    );
  });
});
