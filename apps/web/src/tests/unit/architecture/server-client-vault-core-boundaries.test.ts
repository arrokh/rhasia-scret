import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const clientVaultCorePackage = "@rhasia-scret/client-vault-core";
const sourceRoot = join(process.cwd(), "src");

const clientWorkflowModuleBarrels = new Set([
  "@/modules/authenticator-account",
  "@/modules/crypto",
  "@/modules/otp-runtime",
  "@/modules/sync",
  "@/modules/vault-archive",
  "@/modules/vault-membership"
]);

const serverSafeClientVaultCoreSymbols = new Set([
  "EffectiveSharedVaultAccountPermissions",
  "EncryptedOfflineVaultBundle",
  "SharedVaultAccountPermission",
  "SharedVaultAccountPermissionOverrides",
  "SharedVaultAccountPermissions",
  "canPerformSharedVaultAccountOperation",
  "effectiveSharedVaultAccountPermissions",
  "parseEncryptedOfflineVaultBundle"
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function sourcePath(path: string): string {
  return relative(sourceRoot, path).split(sep).join("/");
}

function isServerOwnedSource(path: string): boolean {
  const relativePath = sourcePath(path);
  return (
    relativePath.startsWith("app/api/") ||
    relativePath === "proxy.ts" ||
    /\/infrastructure\/(?:prisma-|server-)/.test(relativePath) ||
    basename(relativePath) === "server.ts"
  );
}

function hasRuntimeBindings(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (!clause) return true;
    if (clause.isTypeOnly) return false;
    if (clause.name || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))) return true;
    return clause.namedBindings?.elements.some((element) => !element.isTypeOnly) ?? false;
  }

  if (node.isTypeOnly) return false;
  if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) return true;
  return node.exportClause.elements.some((element) => !element.isTypeOnly);
}

function resolveLocalModule(importer: string, moduleName: string): string | null {
  const unresolved = moduleName.startsWith("@/")
    ? join(sourceRoot, moduleName.slice(2))
    : moduleName.startsWith(".")
      ? resolve(dirname(importer), moduleName)
      : null;
  if (!unresolved) return null;

  const candidates = extname(unresolved)
    ? [unresolved]
    : [unresolved, `${unresolved}.ts`, `${unresolved}.tsx`, join(unresolved, "index.ts"), join(unresolved, "index.tsx")];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function runtimeLocalDependencies(path: string): string[] {
  const sourceFile = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  return sourceFile.statements.flatMap((node) => {
    if (
      !(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ||
      !hasRuntimeBindings(node) ||
      node.moduleSpecifier === undefined ||
      !ts.isStringLiteral(node.moduleSpecifier)
    ) {
      return [];
    }
    const dependency = resolveLocalModule(path, node.moduleSpecifier.text);
    return dependency ? [dependency] : [];
  });
}

function apiRuntimeSources(): string[] {
  const routeDirectory = join(sourceRoot, "app/api");
  const routes = sourceFiles(routeDirectory).filter((path) => basename(path) === "route.ts");
  const visited = new Set<string>();
  const pending = [...routes];
  while (pending.length > 0) {
    const path = pending.pop();
    if (!path || visited.has(path)) continue;
    visited.add(path);
    pending.push(...runtimeLocalDependencies(path));
  }
  return [...visited];
}

function serverBoundaryFindings(path: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const findings: string[] = [];

  const recordSymbol = (symbol: string): void => {
    if (!serverSafeClientVaultCoreSymbols.has(symbol)) findings.push(`${sourcePath(path)}: ${symbol}`);
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const packageName = node.moduleSpecifier.text;
      if (clientWorkflowModuleBarrels.has(packageName) && hasRuntimeBindings(node)) {
        findings.push(`${sourcePath(path)}: runtime client barrel ${packageName}`);
      }
      if (packageName !== clientVaultCorePackage) {
        ts.forEachChild(node, visit);
        return;
      }

      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        if (!clause) findings.push(`${sourcePath(path)}: side-effect import`);
        if (clause?.name) findings.push(`${sourcePath(path)}: default import`);
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          findings.push(`${sourcePath(path)}: namespace import`);
        }
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            recordSymbol(element.propertyName?.text ?? element.name.text);
          }
        }
      } else if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) {
        findings.push(`${sourcePath(path)}: wildcard export`);
      } else {
        for (const element of node.exportClause.elements) {
          recordSymbol(element.propertyName?.text ?? element.name.text);
        }
      }
    }

    if (
      ts.isCallExpression(node) &&
      node.arguments.length > 0 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === clientVaultCorePackage &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      findings.push(`${sourcePath(path)}: dynamic package import`);
    }

    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal) &&
      node.argument.literal.text === clientVaultCorePackage
    ) {
      findings.push(`${sourcePath(path)}: inline package import`);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
}

describe("server access to client-vault-core", () => {
  it("allows only encrypted bundle parsing and permission policy symbols in server-owned code", () => {
    const serverSources = sourceFiles(sourceRoot).filter(isServerOwnedSource);
    const paths = serverSources.map(sourcePath);

    expect(paths).toEqual(
      expect.arrayContaining([
        "modules/authenticator-account/infrastructure/prisma-shared-account-repository.ts",
        "modules/sync/infrastructure/prisma-offline-sync-bundle-reader.ts",
        "modules/vault-archive/infrastructure/prisma-encrypted-vault-import-repository.ts",
        "modules/vault-membership/infrastructure/prisma-shared-vault-access-repository.ts",
        "modules/vault-membership/infrastructure/prisma-shared-vault-account-permission-repository.ts",
        "modules/vault-membership/infrastructure/prisma-vault-participant-repository.ts"
      ])
    );

    const findings = serverSources.flatMap((path) =>
      serverBoundaryFindings(path, readFileSync(path, "utf8"))
    );
    expect(findings).toEqual([]);
  });

  it("keeps every API runtime dependency graph out of client workflow barrels", () => {
    const runtimeSources = apiRuntimeSources();
    const paths = runtimeSources.map(sourcePath);

    expect(paths.filter((path) => path.startsWith("app/api/") && path.endsWith("/route.ts"))).toHaveLength(34);
    expect(paths).toEqual(
      expect.arrayContaining([
        "modules/retention/application/run-retention-purge.ts",
        "modules/sync/infrastructure/prisma-offline-sync-bundle-reader.ts",
        "modules/vault-archive/infrastructure/prisma-encrypted-vault-import-repository.ts"
      ])
    );

    const findings = runtimeSources.flatMap((path) =>
      serverBoundaryFindings(path, readFileSync(path, "utf8"))
    );
    expect(findings).toEqual([]);
  });

  it("fails closed for client workflows and non-explicit package imports", () => {
    const fixturePath = join(sourceRoot, "app/api/fixture/route.ts");
    const source = [
      `import { generateTotp } from "${clientVaultCorePackage}";`,
      `import * as clientVaultCore from "${clientVaultCorePackage}";`,
      `const workflow = import("${clientVaultCorePackage}");`
    ].join("\n");

    expect(serverBoundaryFindings(fixturePath, source)).toEqual([
      "app/api/fixture/route.ts: generateTotp",
      "app/api/fixture/route.ts: namespace import",
      "app/api/fixture/route.ts: dynamic package import"
    ]);

    const barrelSource = [
      'import type { OfflineSyncBundleReader } from "@/modules/sync";',
      'import { openAndValidateEncryptedVaultArchive } from "@/modules/vault-archive";'
    ].join("\n");
    expect(serverBoundaryFindings(fixturePath, barrelSource)).toEqual([
      "app/api/fixture/route.ts: runtime client barrel @/modules/vault-archive"
    ]);
  });
});
