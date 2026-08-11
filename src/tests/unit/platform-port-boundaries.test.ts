import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { BearerTokenTransport } from "@/shared/infrastructure/bearer-token-transport";
import type { PlatformHttpRequest, PlatformHttpResponse } from "@/shared/application/platform-ports";

const sourceRoot = join(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe("platform-neutral client ports", () => {
  it("keeps browser globals out of shared application workflows", () => {
    const forbidden = /\b(?:window|navigator|indexedDB|Worker)\b|crypto\.subtle|document\.|URL\.createObjectURL|\bfetch\s*\(/;
    const findings = sourceFiles(join(sourceRoot, "modules")).filter((path) => path.includes("/application/")).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      return forbidden.test(source) ? [relative(process.cwd(), path)] : [];
    });
    expect(findings).toEqual([]);
  });

  it("exposes separate contracts for transport, crypto, encrypted storage, QR, archive, and lifecycle concerns", () => {
    const required = [
      "src/shared/application/platform-ports.ts",
      "src/shared/infrastructure/bearer-token-transport.ts",
      "src/modules/crypto/application/crypto-ports.ts",
      "src/modules/authenticator-account/application/qr-import-ports.ts",
      "src/modules/authenticator-account/application/vault-workspace-ports.ts",
      "src/modules/local-vault/application/local-vault-repository.ts",
      "src/modules/sync/application/client-storage-ports.ts",
      "src/modules/vault-archive/application/archive-ports.ts"
    ];
    for (const path of required) expect(readFileSync(join(process.cwd(), path), "utf8").length).toBeGreaterThan(0);
  });

  it("adds a bearer token only at the authenticated transport boundary", async () => {
    let captured: PlatformHttpRequest | undefined;
    const delegate = {
      request: async (request: PlatformHttpRequest): Promise<PlatformHttpResponse> => {
        captured = request;
        return { status: 200, ok: true, headers: { get: () => null }, json: async <T>() => ({}) as T, bytes: async () => new Uint8Array(), text: async () => "" };
      }
    };
    const transport = new BearerTokenTransport(delegate, { getToken: async () => "synthetic-access-token" });
    await transport.request({ url: "/api/me", method: "GET", headers: { accept: "application/json" } });
    expect(captured?.headers).toEqual({ accept: "application/json", authorization: "Bearer synthetic-access-token" });
  });
});
