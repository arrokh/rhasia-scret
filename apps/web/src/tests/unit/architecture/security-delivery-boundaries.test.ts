import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("browser-delivery security boundaries", () => {
  it("keeps production source maps disabled and static headers restrictive", () => {
    const config = read("next.config.ts");
    expect(config).toContain("poweredByHeader: false");
    expect(config).toContain("productionBrowserSourceMaps: false");
    expect(config).toContain("Content-Security-Policy");
    expect(config).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(config).toContain("script-src-elem 'self'");
    expect(config).toContain("frame-ancestors 'none'");
    expect(config).toContain("Cache-Control");
  });

  it("keeps generated test artifacts outside the lint boundary", () => {
    const config = read("eslint.config.mjs");
    expect(config).toContain('"test-results/**"');
    expect(config).toContain('"artifacts/**"');
  });

  it("pins CI actions and runs dependency and client-artifact checks", () => {
    const workflow = read("../../.github/workflows/ci.yml");
    expect(workflow).not.toMatch(/uses:\s+[^\s]+@v\d/);
    expect(workflow).toContain("pnpm audit --prod --audit-level=high");
    expect(workflow).toContain("pnpm run verify:dependency-licenses");
    expect(workflow).toContain("verify:build-output");
    expect(workflow).toContain("permissions:\n  contents: read");
  });

  it("runs quality and browser CI only after a push reaches main", () => {
    const workflow = read("../../.github/workflows/ci.yml");
    expect(workflow).toContain("on:\n  push:\n    branches: [main]");
    expect(workflow).not.toContain("pull_request:");
    expect(workflow).not.toContain("workflow_dispatch:");
    expect(workflow).toContain("name: Quality and database test suite");
    expect(workflow).toContain("name: Browser smoke test");
  });

  it("does not expose the browser smoke fixture in production", () => {
    const smokePage = read("src/app/smoke/page.tsx");
    expect(smokePage).toContain('process.env.NODE_ENV === "production"');
    expect(smokePage).toContain("notFound()");
  });

  it("keeps the service worker out of sensitive and source-map cache paths", () => {
    const worker = read("public/sw.js");
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain('url.pathname.startsWith("/auth/")');
    expect(worker).toContain('!pathname.endsWith(".map")');
    expect(worker).toContain('response.headers.get("content-type")?.startsWith("text/html")');
    expect(worker).toContain('response.type === "basic"');
  });

  it("keeps build-output and incident controls committed", () => {
    expect(read("scripts/verify-build-output.ts")).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(read("scripts/verify-dependency-licenses.ts")).toContain("Prohibited dependency licenses");
    expect(read("../../docs/security/incident-response.md")).toContain("Stolen session");
    expect(read("../../docs/security/deployment-hardening-checklist.md")).toContain("Not Verifiable");
    expect(read("../../docs/security/dependency-audit-exceptions.md")).toContain("GHSA-w3rx-r6r6-pgpr");
    expect(read("../../pnpm-workspace.yaml")).toContain("ignoreGhsas");
  });
});
