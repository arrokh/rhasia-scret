import { describe, expect, it } from "vitest";
import { isProhibitedLicense } from "../../../scripts/license-policy";

describe("dependency license policy", () => {
  it("accepts a package when an SPDX OR expression offers an approved license", () => {
    expect(isProhibitedLicense("(BSD-3-Clause OR GPL-2.0)")).toBe(false);
    expect(isProhibitedLicense("MIT OR AGPL-3.0")).toBe(false);
  });

  it("rejects prohibited licenses when no approved alternative exists", () => {
    expect(isProhibitedLicense("GPL-3.0")).toBe(true);
    expect(isProhibitedLicense("AGPL-3.0 OR GPL-2.0")).toBe(true);
    expect(isProhibitedLicense("UNKNOWN")).toBe(true);
  });
});
