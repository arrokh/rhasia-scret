import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe("platform-neutral client ports", () => {
  it("keeps browser globals out of shared application workflows", () => {
    const forbidden =
      /\b(?:window|navigator|indexedDB|Worker)\b|crypto\.subtle|document\.|URL\.createObjectURL|\bfetch\s*\(/;
    const findings = sourceFiles(join(sourceRoot, "modules"))
      .filter((path) => path.includes("/application/"))
      .flatMap((path) => {
        const source = readFileSync(path, "utf8");
        return forbidden.test(source) ? [relative(process.cwd(), path)] : [];
      });
    expect(findings).toEqual([]);
  });

  it("keeps context-bound key-wrap and Secure Share Link orchestration platform-neutral", () => {
    const coreCrypto = read(
      "../../packages/client-vault-core/src/modules/crypto/application/client-crypto-protocol.ts",
    );
    const browserEnvelope = read("src/modules/crypto/infrastructure/browser-crypto-envelope.ts");
    const browserIdentity = read("src/modules/crypto/infrastructure/browser-user-encryption-identity.ts");
    const browserRotation = read("src/modules/crypto/infrastructure/browser-user-encryption-key-rotation.ts");
    const browserVaultRotation = read("src/modules/crypto/infrastructure/browser-vault-key-rotation.ts");
    const browserShare = read("src/modules/vault-membership/infrastructure/browser-shared-vault-invitation.ts");

    expect(coreCrypto).toContain("deriveHkdfSha256");
    expect(coreCrypto).toContain("serializeKeyWrapEnvelope");
    for (const source of [browserEnvelope, browserIdentity, browserRotation, browserVaultRotation]) {
      expect(source).not.toMatch(/crypto\.subtle|deriveSharedKey|function wrapKey|function unwrapKey/);
    }
    expect(browserShare).toContain("createSecureShareLink(");
  });

  it("exposes separate contracts for transport, crypto, encrypted storage, QR, archive, and lifecycle concerns", () => {
    const required = [
      "../../packages/client-vault-core/src/shared/application/platform-ports.ts",
      "../../packages/client-vault-core/src/modules/crypto/application/crypto-ports.ts",
      "../../packages/client-vault-core/src/modules/authenticator-account/application/qr-import-ports.ts",
      "../../packages/client-vault-core/src/modules/authenticator-account/application/vault-workspace-ports.ts",
      "src/modules/local-vault/application/local-vault-repository.ts",
      "../../packages/client-vault-core/src/modules/sync/application/client-storage-ports.ts",
      "../../packages/client-vault-core/src/modules/vault-archive/application/archive-ports.ts",
    ];
    for (const path of required) expect(readFileSync(join(process.cwd(), path), "utf8").length).toBeGreaterThan(0);
  });
});
