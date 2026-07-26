import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sourceRoot = join(root, "src");

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.(ts|tsx|js)$/.test(entry.name) ? [path] : [];
  });
}

describe("offline PWA architecture boundaries", () => {
  it("inventories browser write paths behind the common no-replay transport guard", () => {
    const mutationCallers = files(join(sourceRoot, "modules"))
      .filter((path) => /browserApiClient\.(?:post|patch|put|delete)/.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path))
      .sort();
    expect(mutationCallers).toEqual([
      "src/modules/authenticator-account/infrastructure/browser-authenticator-account-client.ts",
      "src/modules/crypto/infrastructure/browser-passkey-recovery-client.ts",
      "src/modules/identity/infrastructure/browser-passkey-recovery-status-client.ts",
      "src/modules/identity/infrastructure/browser-session-client.ts",
      "src/modules/vault-management/infrastructure/browser-vault-management-client.ts",
      "src/modules/vault-membership/infrastructure/browser-secure-share-link-workflow.ts",
      "src/modules/vault-membership/infrastructure/browser-shared-vault-invitation.ts",
      "src/modules/vault-membership/infrastructure/browser-vault-participant-client.ts"
    ]);
    const client = readFileSync(join(sourceRoot, "shared/infrastructure/browser-api-client.ts"), "utf8");
    expect(client).toContain("assertBrowserMutationAllowed()");
  });

  it("keeps Local Vault Snapshots outside Query persistence and forbids replay primitives", () => {
    const source = files(sourceRoot).filter((path) => !path.includes("/tests/")).map((path) => readFileSync(path, "utf8")).join("\n");
    const queryProvider = readFileSync(join(sourceRoot, "shared/presentation/query-provider.tsx"), "utf8");
    expect(queryProvider).toMatch(/mutations:\s*\{\s*retry:\s*0/);
    expect(queryProvider).not.toMatch(/persist|localStorage|sessionStorage|indexedDB/i);
    expect(source).not.toMatch(/BackgroundSync|SyncManager|periodicSync|mutationQueue|replayMutation/);
  });

  it("allows the service worker to cache only the public shell and static assets", () => {
    const worker = readFileSync(join(root, "public/sw.js"), "utf8");
    expect(worker).toContain('const OFFLINE_SHELL = "/offline"');
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain('url.pathname.startsWith("/auth/")');
    expect(worker).toContain('request.method !== "GET"');
    expect(worker).toContain('/_next/static/');
    expect(worker).not.toMatch(/indexedDB|localStorage|sessionStorage|Background Sync|periodic/i);
  });
});
