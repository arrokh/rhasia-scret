import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Encrypted Vault Archive boundaries", () => {
  it("keeps decrypted archive state outside TanStack Query and persistent browser storage", () => {
    const sources = [
      read("src/modules/vault-archive/presentation/vault-archive-exporter.tsx"),
      read("src/modules/vault-archive/presentation/vault-archive-importer.tsx"),
      read("src/modules/vault-archive/infrastructure/browser-vault-archive-export-workflow.ts"),
      read("src/modules/vault-archive/infrastructure/browser-vault-archive-workflow.ts"),
      read("src/modules/vault-archive/infrastructure/browser-vault-import-client.ts")
    ].join("\n");
    expect(sources).not.toMatch(/@tanstack\/react-query|useMutation|useQuery|queryClient/i);
    expect(sources).not.toMatch(/localStorage|sessionStorage|indexedDB|console\./i);
  });

  it("keeps server archive code ciphertext-only and free of client crypto or OTP runtime", () => {
    const sources = [
      read("src/app/api/vault-imports/route.ts"),
      read("src/app/api/vaults/[vaultId]/archive-exports/route.ts"),
      read("src/modules/vault-archive/infrastructure/prisma-encrypted-vault-import-repository.ts")
    ].join("\n");
    expect(sources).not.toMatch(/modules\/crypto|otp-runtime|decryptPayload|openEncryptedVaultExport|parseTotpUri/);
    expect(sources).not.toMatch(/vaultName\s*:|issuer\s*:|accountName\s*:|secret\s*:/);
  });

  it("keeps the interactive test harness unavailable in production", () => {
    for (const path of ["src/app/ui-preview/archive-backup/page.tsx", "src/app/ui-preview/archive-import/page.tsx"]) {
      const previewPage = read(path);
      expect(previewPage).toContain('process.env.NODE_ENV === "production"');
      expect(previewPage).toContain("notFound()");
    }
  });

  it("clears archive keys, decrypted account secrets, and temporary Vault material", () => {
    const exporter = read("src/modules/vault-archive/presentation/vault-archive-exporter.tsx");
    const exportWorkflow = read("src/modules/vault-archive/infrastructure/browser-vault-archive-export-workflow.ts");
    const importer = read("src/modules/vault-archive/presentation/vault-archive-importer.tsx");
    const workflow = read("src/modules/vault-archive/infrastructure/browser-vault-archive-workflow.ts");
    expect(exporter).toContain("clearPreparedVaultArchive(preparedRef.current)");
    expect(exportWorkflow).toContain("prepared.archive.fill(0)");
    expect(exportWorkflow).toContain("prepared.key.fill(0)");
    expect(importer).toContain("value.archive.size > MAX_ENCRYPTED_VAULT_ARCHIVE_BYTES");
    expect(importer).toContain("archiveKey?.fill(0)");
    expect(importer).toContain("newVaultMaterial?.vaultKey.fill(0)");
    expect(importer).toContain("clearOpenedVaultArchive(openedRef.current)");
    expect(workflow).toContain("account.secret.fill(0)");
    expect(workflow).toContain("payload.fill(0)");
  });
});
