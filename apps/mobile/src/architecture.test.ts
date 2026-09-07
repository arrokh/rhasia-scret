import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const sourceRoot = join(__dirname);
const nativeCryptoRoot = join(__dirname, "..", "modules", "native-argon2id");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

function nativeSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return nativeSourceFiles(path);
    return /\.(?:c|cpp|h|kt|m|mm|swift|ts)$/.test(entry.name) ? [path] : [];
  });
}

describe("native security boundaries", () => {
  const files = sourceFiles(sourceRoot).map((path) => ({ path, source: readFileSync(path, "utf8") }));

  it("does not alias native imports into the web application", () => {
    const tsconfig = readFileSync(join(__dirname, "..", "tsconfig.json"), "utf8");
    expect(tsconfig).not.toContain("../web/src");
  });

  it("keeps direct network access and secure storage inside native infrastructure", () => {
    for (const file of files) {
      if (!file.path.includes("/infrastructure/")) {
        expect(file.source).not.toMatch(/\bfetch\s*\(/);
        expect(file.source).not.toContain("expo-secure-store");
      }
    }
  });

  it("does not introduce query caches, browser persistence, or sensitive logging", () => {
    for (const file of files) {
      expect(file.source).not.toMatch(/@tanstack\/react-query|AsyncStorage|indexedDB|localStorage|sessionStorage|console\.(?:log|debug|info|warn|error)/);
    }
  });

  it("keeps browser-only APIs out of native application workflows", () => {
    for (const file of files.filter(({ path }) => path.includes("/application/"))) {
      expect(file.source).not.toMatch(/\bwindow\b|\bdocument\b|\bnavigator\b|ServiceWorker|WebAuthn|from ["']react-native["']/);
    }
  });

  it("retains native cryptography licenses and excludes sensitive diagnostic logging", () => {
    expect(existsSync(join(nativeCryptoRoot, "LICENSE.wrapper-MIT"))).toBe(true);
    expect(existsSync(join(nativeCryptoRoot, "c-argon2", "LICENSE"))).toBe(true);
    const nativeSources = nativeSourceFiles(nativeCryptoRoot);
    for (const path of nativeSources) {
      expect(readFileSync(path, "utf8")).not.toMatch(/console\.(?:log|debug|info|warn|error)|\bNSLog\s*\(|android\.util\.Log|\bprintf\s*\(/);
    }
  });
});
