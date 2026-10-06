import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createDockerHubImageSummary } from "./write-dockerhub-image-summary.mjs";

const version = "0.3.0";
const releaseTag = `v${version}`;
const sourceSha = "a".repeat(40);
const imageRecords = [
  {
    image: "docker.io/arrokh/rhasia-scret",
    purpose: "Web/PWA",
    dockerfile: "apps/web/Dockerfile",
    target: "runtime",
  },
  {
    image: "docker.io/arrokh/rhasia-scret-api",
    purpose: "API",
    dockerfile: "apps/api/Dockerfile",
    target: "runtime",
  },
  {
    image: "docker.io/arrokh/rhasia-scret-api-migrate",
    purpose: "One-off API migration",
    dockerfile: "apps/api/Dockerfile.migration",
    target: "migration",
  },
].map((record, index) => ({
  ...record,
  "release-tag": releaseTag,
  "source-commit": sourceSha,
  version,
  platform: "linux/amd64",
  digest: `sha256:${String(index + 1).repeat(64)}`,
}));

function createFixture(records = imageRecords) {
  const root = mkdtempSync(join(tmpdir(), "rhasia-dockerhub-image-summary-"));
  const provenanceDirectory = join(root, "provenance");
  mkdirSync(provenanceDirectory);
  for (const [index, record] of records.entries()) {
    const artifactDirectory = join(provenanceDirectory, `artifact-${index}`);
    mkdirSync(artifactDirectory);
    const provenance = Object.fromEntries(Object.entries(record).filter(([key]) => key !== "purpose"));
    writeFileSync(
      join(artifactDirectory, "image.txt"),
      `${Object.entries(provenance)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n")}\n`,
    );
  }
  return { root, provenanceDirectory, summaryPath: join(root, "summary.md") };
}

test("writes one consolidated Actions overview from all verified image provenance", () => {
  const fixture = createFixture();
  try {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./write-dockerhub-image-summary.mjs", import.meta.url))],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DOCKERHUB_PROVENANCE_DIR: fixture.provenanceDirectory,
          VERSION: version,
          RELEASE_TAG: releaseTag,
          SOURCE_SHA: sourceSha,
          GITHUB_STEP_SUMMARY: fixture.summaryPath,
        },
      },
    );
    assert.equal(result.status, 0, result.stderr);

    const summary = readFileSync(fixture.summaryPath, "utf8");
    assert.match(summary, /# Docker Hub images for v0\.3\.0/);
    assert.ok(summary.includes(`Source commit: \`${sourceSha}\``));
    for (const { image, purpose, digest } of imageRecords) {
      const repository = image.slice("docker.io/".length);
      assert.ok(summary.includes(`[${repository}](https://hub.docker.com/r/${repository})`));
      assert.ok(summary.includes(`| ${purpose} | \`v0.3.0\` | \`${digest}\``));
      assert.ok(summary.includes(`docker pull ${repository}:v0.3.0`));
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects missing images, duplicate images, and provenance for another source", () => {
  const missing = createFixture(imageRecords.slice(0, 2));
  const duplicate = createFixture([imageRecords[0], imageRecords[0], imageRecords[2]]);
  const mismatchedSource = createFixture([
    imageRecords[0],
    { ...imageRecords[1], "source-commit": "b".repeat(40) },
    imageRecords[2],
  ]);
  try {
    const args = (provenanceDirectory) => ({ provenanceDirectory, version, releaseTag, sourceSha });
    assert.throws(() => createDockerHubImageSummary(args(missing.provenanceDirectory)), /exactly 3/);
    assert.throws(() => createDockerHubImageSummary(args(duplicate.provenanceDirectory)), /Duplicate Docker Hub image/);
    assert.throws(
      () => createDockerHubImageSummary(args(mismatchedSource.provenanceDirectory)),
      /does not match the verified release/,
    );
  } finally {
    for (const fixture of [missing, duplicate, mismatchedSource]) {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});

test("rejects malformed digest and unexpected provenance fields", () => {
  const malformedDigest = createFixture([
    imageRecords[0],
    { ...imageRecords[1], digest: "sha256:not-a-digest" },
    imageRecords[2],
  ]);
  const unexpectedField = createFixture([
    imageRecords[0],
    { ...imageRecords[1], "unexpected-field": "synthetic" },
    imageRecords[2],
  ]);
  try {
    assert.throws(
      () =>
        createDockerHubImageSummary({
          provenanceDirectory: malformedDigest.provenanceDirectory,
          version,
          releaseTag,
          sourceSha,
        }),
      /does not match the verified release/,
    );
    assert.throws(
      () =>
        createDockerHubImageSummary({
          provenanceDirectory: unexpectedField.provenanceDirectory,
          version,
          releaseTag,
          sourceSha,
        }),
      /Unexpected or duplicate field/,
    );
  } finally {
    for (const fixture of [malformedDigest, unexpectedField]) {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }
});
