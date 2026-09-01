import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTHENTICATED_MUTATION_RATE_LIMIT_POLICIES,
  STATE_CHANGING_ROUTE_RATE_LIMIT_EXCLUSIONS
} from "@/modules/rate-limiting/presentation/authenticated-mutation-rate-limit-inventory";

const appRoot = join(process.cwd(), "src/app");
const routeMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function routeFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? routeFiles(path) : entry === "route.ts" ? [path] : [];
  });
}

function routePath(path: string): string {
  const directory = relative(appRoot, path).split(sep).slice(0, -1).join("/");
  return `/${directory}`;
}

function exportedRouteMethods(source: string): string[] {
  return routeMethods.filter((method) => {
    const directExport = new RegExp(`export\\s+(?:async\\s+function|const)\\s+${method}\\b`).test(source);
    const aliasedExport = new RegExp(`export\\s*\\{[^}]*\\b(?:[A-Za-z_$][\\w$]*\\s+as\\s+)?${method}\\b[^}]*\\}`, "s").test(source);
    return directExport || aliasedExport;
  });
}

describe("authenticated application mutation rate-limit inventory", () => {
  it("requires every state-changing route to have a policy or a narrow documented exclusion", () => {
    const discovered = routeFiles(appRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return exportedRouteMethods(source)
        .map((method) => `${method} ${routePath(path)}`)
        .filter((route) => !route.startsWith("GET ") || route in STATE_CHANGING_ROUTE_RATE_LIMIT_EXCLUSIONS);
    }).sort();
    const inventoried = [
      ...Object.keys(AUTHENTICATED_MUTATION_RATE_LIMIT_POLICIES),
      ...Object.keys(STATE_CHANGING_ROUTE_RATE_LIMIT_EXCLUSIONS)
    ].sort();
    expect(discovered).toEqual(inventoried);
  });

  it("wires every authenticated mutation route to its declared operation-class policy", () => {
    for (const [route, policy] of Object.entries(AUTHENTICATED_MUTATION_RATE_LIMIT_POLICIES)) {
      const routeName = route.slice(route.indexOf(" ") + 1);
      const source = readFileSync(join(appRoot, routeName.slice(1), "route.ts"), "utf8");
      expect(source, route).toMatch(/authenticateApplicationMutation|executeAuthenticatedApplicationRequest|rateLimitApplicationUser|\bauthenticate\(/);
      expect(source, route).toContain(`"${policy}"`);
    }
  });

  it("shares operation budgets across alternate routes for the same use case", () => {
    expect(AUTHENTICATED_MUTATION_RATE_LIMIT_POLICIES["POST /api/vaults/[vaultId]/accounts"]).toBe("account_mutation");
    expect(AUTHENTICATED_MUTATION_RATE_LIMIT_POLICIES["POST /api/shared-vaults/[vaultId]/accounts"]).toBe("account_mutation");
    expect(AUTHENTICATED_MUTATION_RATE_LIMIT_POLICIES["POST /api/secure-share-links"]).toBe("membership_mutation");
    expect(AUTHENTICATED_MUTATION_RATE_LIMIT_POLICIES["POST /api/shared-vaults/[vaultId]/share-links"]).toBe("membership_mutation");
    expect(AUTHENTICATED_MUTATION_RATE_LIMIT_POLICIES["POST /api/passkey-recovery/registration/options"]).toBe("recovery_mutation");
    expect(AUTHENTICATED_MUTATION_RATE_LIMIT_POLICIES["POST /api/passkey-recovery/registration/verify"]).toBe("recovery_mutation");
  });

  it("leaves Supabase OTP and magic-link authentication outside application-user limiting", () => {
    const authSources = routeFiles(join(appRoot, "auth")).map((path) => readFileSync(path, "utf8")).join("\n");
    expect(authSources).not.toContain("rateLimitApplicationUser");
    expect(Object.keys(AUTHENTICATED_MUTATION_RATE_LIMIT_POLICIES).some((route) => route.includes("/auth/"))).toBe(false);
  });
});
