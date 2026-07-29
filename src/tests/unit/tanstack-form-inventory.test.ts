import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");
const nativeFormPattern = /<form(?:\s|>)/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith(".tsx") ? [path] : [];
  });
}

describe("TanStack Form inventory", () => {
  it("keeps every native form managed by TanStack Form", () => {
    const forms = sourceFiles(sourceRoot).flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const count = source.match(nativeFormPattern)?.length ?? 0;
      return count ? [{ path: relative(process.cwd(), path), count, source }] : [];
    });

    expect(forms.map(({ path, count }) => ({ path, count }))).toEqual([
      { path: "src/modules/authenticator-account/presentation/authenticator-account-creator.tsx", count: 2 },
      { path: "src/modules/authenticator-account/presentation/authenticator-account-manager-dialog.tsx", count: 1 },
      { path: "src/modules/authenticator-account/presentation/qr-import-input.tsx", count: 1 },
      { path: "src/modules/authenticator-account/presentation/vault-workspace-unlock.tsx", count: 1 },
      { path: "src/modules/crypto/presentation/passkey-recovery-reset.tsx", count: 1 },
      { path: "src/modules/crypto/presentation/remembered-browser-enrollment.tsx", count: 1 },
      { path: "src/modules/identity/presentation/invited-user-sign-in-form.tsx", count: 1 },
      { path: "src/modules/identity/presentation/logout-form.tsx", count: 1 },
      { path: "src/modules/local-vault/presentation/local-vault-copy-panel.tsx", count: 1 },
      { path: "src/modules/local-vault/presentation/local-vault-page.tsx", count: 4 },
      { path: "src/modules/otp-runtime/presentation/local-totp-screen.tsx", count: 1 },
      { path: "src/modules/sync/presentation/offline-vault-shell.tsx", count: 1 },
      { path: "src/modules/vault-archive/presentation/vault-archive-exporter.tsx", count: 1 },
      { path: "src/modules/vault-archive/presentation/vault-archive-importer.tsx", count: 2 },
      { path: "src/modules/vault-management/presentation/destructive-personal-vault-reset-form.tsx", count: 1 },
      { path: "src/modules/vault-management/presentation/personal-vault-setup-form.tsx", count: 1 },
      { path: "src/modules/vault-management/presentation/shared-vault-creator.tsx", count: 1 },
      { path: "src/modules/vault-management/presentation/shared-vault-manager.tsx", count: 4 }
    ]);
    for (const form of forms) {
      expect(form.source, form.path).toContain("@tanstack/react-form");
      expect(form.source, form.path).toContain("useForm(");
    }
  });

  it("does not retain legacy event-owned form submission handlers", () => {
    const legacyFiles = sourceFiles(sourceRoot).filter((path) => /FormEvent<HTMLFormElement>|React\.FormEvent<HTMLFormElement>/.test(readFileSync(path, "utf8")));
    expect(legacyFiles).toEqual([]);
  });
});
