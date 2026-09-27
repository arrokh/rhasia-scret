import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { bumpSemVer, compareSemVer, isValidSemVer } from "./release-version.mjs";
import { verifyVersionAlignment, versionedPackageFiles } from "./verify-version-alignment.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("validates every direct workspace package manifest and the Expo app version", () => {
  const result = verifyVersionAlignment(repositoryRoot);
  assert.equal(result.valid, true, result.failures.join("\n"));
  assert.ok(result.versions.some(([path]) => path === "apps/api/package.json"));
  assert.ok(result.versions.some(([path]) => path === "apps/mobile/package.json"));
  assert.ok(result.versions.some(([path]) => path === "apps/web/package.json"));
  assert.ok(result.versions.some(([path]) => path === "packages/api-client/package.json"));
  assert.ok(result.versions.some(([path]) => path === "packages/api-contract/package.json"));
  assert.ok(result.versions.some(([path]) => path === "packages/client-vault-core/package.json"));
  assert.ok(!result.versions.some(([path]) => path.includes("native-argon2id")));
});

test("fails for a mismatch in every package manifest and the Expo app config", () => {
  const paths = [...versionedPackageFiles(repositoryRoot), "apps/mobile/app.config.ts"];
  for (const path of paths) {
    const root = fixtureRoot();
    try {
      const filePath = join(root, path);
      if (path.endsWith("app.config.ts")) {
        writeFileSync(filePath, 'export default { version: "1.2.4" };\n');
      } else {
        const packageJson = JSON.parse(readFileSync(filePath, "utf8"));
        packageJson.version = "1.2.4";
        writeFileSync(filePath, JSON.stringify(packageJson, null, 2));
      }
      const result = verifyVersionAlignment(root);
      assert.equal(result.valid, false, `${path} mismatch should fail`);
      assert.ok(
        result.failures.some((failure) => failure.includes(path)),
        `${path} should be named in the failure`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("rejects malformed or missing package versions", () => {
  const root = fixtureRoot();
  try {
    const rootManifestPath = join(root, "package.json");
    const rootManifest = JSON.parse(readFileSync(rootManifestPath, "utf8"));
    rootManifest.version = "01.2.3";
    writeFileSync(rootManifestPath, JSON.stringify(rootManifest, null, 2));
    let result = verifyVersionAlignment(root);
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((failure) => failure.includes("package.json")));

    rootManifest.version = "1.2.3";
    writeFileSync(rootManifestPath, JSON.stringify(rootManifest, null, 2));
    const apiManifestPath = join(root, "apps/api/package.json");
    const apiManifest = JSON.parse(readFileSync(apiManifestPath, "utf8"));
    delete apiManifest.version;
    writeFileSync(apiManifestPath, JSON.stringify(apiManifest, null, 2));
    result = verifyVersionAlignment(root);
    assert.equal(result.valid, false);
    assert.ok(result.failures.some((failure) => failure.includes("apps/api/package.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("validates SemVer strictly and compares or increments versions semantically", () => {
  for (const version of ["1.2.3", "0.1.0", "1.2.3-rc.1", "1.2.3+build.4", "1.2.3-rc.1+build.4"]) {
    assert.equal(isValidSemVer(version), true, version);
  }
  for (const version of ["v1.2.3", "01.2.3", "1.02.3", "1.2", "1.2.3-01", "1.2.3-"]) {
    assert.equal(isValidSemVer(version), false, version);
  }
  assert.equal(compareSemVer("1.2.3-rc.2", "1.2.3-rc.10"), -1);
  assert.equal(compareSemVer("1.2.3-rc.10", "1.2.3"), -1);
  assert.equal(bumpSemVer("0.1.0", "patch"), "0.1.1");
  assert.equal(bumpSemVer("0.1.0", "minor"), "0.2.0");
  assert.equal(bumpSemVer("0.1.0", "major"), "1.0.0");
  assert.throws(() => bumpSemVer("1.2.3", "build"), /Release bump must be/);
});

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "rhasia-version-alignment-"));
  for (const relativePath of versionedPackageFiles(repositoryRoot)) {
    const filePath = join(root, relativePath);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({ name: relativePath, version: "1.2.3" }, null, 2));
  }
  mkdirSync(join(root, "apps/mobile/modules/native-argon2id"), { recursive: true });
  writeFileSync(join(root, "apps/mobile/modules/native-argon2id/package.json"), JSON.stringify({ version: "9.9.9" }));
  writeFileSync(join(root, "apps/mobile/app.config.ts"), 'export default { version: "1.2.3" };\n');
  return root;
}
