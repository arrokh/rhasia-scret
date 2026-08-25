import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const sourceRoot = join(root, "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("i18n architecture boundaries", () => {
  it("keeps next-intl in composition and presentation layers", () => {
    const imports = sourceFiles(sourceRoot)
      .filter((path) => readFileSync(path, "utf8").includes("next-intl"))
      .map((path) => relative(root, path));
    const forbidden = imports.filter((path) => !/^(?:src\/(?:app|i18n|shared\/presentation|types|tests)|src\/modules\/[^/]+\/presentation)\//.test(path));
    expect(forbidden).toEqual([]);
  });

  it("centralizes explicit formatting locales and forbids rendered lower-layer error messages", () => {
    const runtime = sourceFiles(sourceRoot).filter((path) => !path.includes("/tests/") && !path.endsWith("src/i18n/config.ts"));
    const localeLeaks = runtime.filter((path) => /["'](?:id-ID|en-US)["']|\.toLocaleString\(/.test(readFileSync(path, "utf8"))).map((path) => relative(root, path));
    expect(localeLeaks).toEqual([]);

    const presentation = runtime.filter((path) => path.includes("/presentation/") || path.includes("/app/"));
    const rawMessages = presentation.filter((path) => /set(?:Error|Message)\([^\n;]*\.message|\{\s*(?:error|reason)\.message\s*\}/.test(readFileSync(path, "utf8"))).map((path) => relative(root, path));
    expect(rawMessages).toEqual([]);
  });

  it("contains no untranslated literal JSX copy outside approved technical and brand values", () => {
    const candidates = [join(sourceRoot, "app"), join(sourceRoot, "modules"), join(sourceRoot, "shared", "presentation")]
      .flatMap(sourceFiles)
      .filter((path) => path.endsWith(".tsx") && !path.includes("/app/api/"));
    const literals = candidates.flatMap(userFacingJsxLiterals);
    expect(literals).toEqual([
      { path: "src/app/page.tsx", kind: "alt", value: "" },
      { path: "src/app/page.tsx", kind: "alt", value: "" },
      { path: "src/modules/authenticator-account/presentation/qr-import-input.tsx", kind: "placeholder", value: "otpauth://totp/…" },
      { path: "src/shared/presentation/app-ui.tsx", kind: "alt", value: "" }
    ]);
  });

  it("refreshes only the public offline shell after a locale switch", () => {
    const worker = readFileSync(join(root, "public/sw.js"), "utf8");
    const switcher = readFileSync(join(sourceRoot, "i18n/locale-switcher.tsx"), "utf8");
    expect(worker).toContain('event.data?.type !== "RHSIA_REFRESH_OFFLINE_SHELL"');
    expect(worker).toContain("cacheOfflineShell");
    expect(worker).toContain('url.pathname.startsWith("/api/")');
    expect(worker).toContain('url.pathname.startsWith("/auth/")');
    expect(switcher).toContain('refreshOfflineShellMessage = "RHSIA_REFRESH_OFFLINE_SHELL"');
    expect(worker).not.toMatch(/indexedDB|localStorage|sessionStorage|Background Sync|periodic/i);
  });
});

function userFacingJsxLiterals(path: string): Array<{ path: string; kind: string; value: string }> {
  const relativePath = relative(root, path);
  const source = readFileSync(path, "utf8");
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Array<{ path: string; kind: string; value: string }> = [];
  const userAttributes = new Set(["alt", "aria-label", "backLabel", "confirmLabel", "description", "placeholder", "title"]);

  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) {
      const value = node.text.replace(/\s+/g, " ").trim();
      if (/[A-Za-zÀ-ž]/.test(value) && !["arrokh", "rhasia-", "scret"].includes(value)) found.push({ path: relativePath, kind: "text", value });
    }
    if (ts.isJsxAttribute(node) && userAttributes.has(node.name.getText(sourceFile)) && node.initializer && ts.isStringLiteral(node.initializer)) {
      found.push({ path: relativePath, kind: node.name.getText(sourceFile), value: node.initializer.text });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return found;
}
