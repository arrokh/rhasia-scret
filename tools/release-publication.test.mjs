import assert from "node:assert/strict";
import test from "node:test";
import { existingTagAction, extractReleaseNotes, validateReleaseVersion } from "./release-publication.mjs";

const sourceSha = "a".repeat(40);
const expectedReleaseNotes = [
  "### Changes",
  "",
  "- Reviewed release item.",
  "",
  "---",
  `Source commit: ${sourceSha}`,
  "",
  "### Docker Hub images",
  "",
  "- Web/PWA: [arrokh/rhasia-scret](https://hub.docker.com/r/arrokh/rhasia-scret) — `docker pull arrokh/rhasia-scret:v0.2.0`",
  "- API: [arrokh/rhasia-scret-api](https://hub.docker.com/r/arrokh/rhasia-scret-api) — `docker pull arrokh/rhasia-scret-api:v0.2.0`",
  "- One-off API migration: [arrokh/rhasia-scret-api-migrate](https://hub.docker.com/r/arrokh/rhasia-scret-api-migrate) — `docker pull arrokh/rhasia-scret-api-migrate:v0.2.0`",
  "",
].join("\n");

test("requires v0.1.0 as the first stable repository release", () => {
  assert.deepEqual(validateReleaseVersion("0.1.0", []), { tag: "v0.1.0", latestTag: null });
  assert.throws(() => validateReleaseVersion("0.1.1", []), /inaugural repository release must be v0.1.0/);
});

test("requires every subsequent product version to advance beyond the latest semantic tag", () => {
  assert.deepEqual(validateReleaseVersion("0.2.0", ["v0.1.0", "v0.1.1"]), {
    tag: "v0.2.0",
    latestTag: "v0.1.1",
  });
  assert.throws(
    () => validateReleaseVersion("0.1.1", ["v0.1.1", "v0.1.0"]),
    /exact-source retry verification is required/,
  );
  assert.throws(() => validateReleaseVersion("0.2.0-rc.1", ["v0.1.0"]), /stable X\.Y\.Z/);
  assert.throws(() => validateReleaseVersion("0.2.0", ["v0.1.0", "v-not-a-version"]), /malformed release tags/);
});

test("allows publication retries only for the latest annotated tag at the exact same source SHA", () => {
  assert.deepEqual(
    validateReleaseVersion("0.1.0", ["v0.1.0"], {
      sourceSha,
      existingTargetSha: sourceSha,
      annotated: true,
    }),
    { tag: "v0.1.0", latestTag: "v0.1.0" },
  );
  assert.throws(
    () =>
      validateReleaseVersion("0.1.0", ["v0.1.0"], {
        sourceSha,
        existingTargetSha: "b".repeat(40),
        annotated: true,
      }),
    /not tested source commit/,
  );
  assert.throws(
    () =>
      validateReleaseVersion("0.1.0", ["v0.1.0"], {
        sourceSha,
        existingTargetSha: sourceSha,
        annotated: false,
      }),
    /lightweight tag/,
  );
});

test("extracts the reviewed changelog section, commit, and v0.2.0 Docker Hub tags", () => {
  const changelog = `# Changelog

## [Unreleased]

### Added

- New future item.

## [0.2.0]

<!-- Draft metadata that must not be published. -->

### Changes

- Reviewed release item.

## [0.1.0]

### Changes

- Earlier release item.
`;
  assert.equal(extractReleaseNotes(changelog, "0.2.0", sourceSha), expectedReleaseNotes);
});

test("removes an unterminated HTML comment before adding release metadata", () => {
  const changelog = `## [0.2.0]\n\n### Changes\n\n- Reviewed release item.\n\n<!-- Draft text must not be published.`;
  assert.equal(extractReleaseNotes(changelog, "0.2.0", sourceSha), expectedReleaseNotes);
});

test("fails closed for missing or empty changelog sections and abbreviated source SHAs", () => {
  assert.throws(() => extractReleaseNotes("# Changelog\n", "0.1.0", sourceSha), /missing the reviewed/);
  assert.throws(
    () => extractReleaseNotes("## [0.1.0]\n\n<!-- only a draft comment -->\n", "0.1.0", sourceSha),
    /reviewed release notes/,
  );
  assert.throws(
    () => extractReleaseNotes("## [0.1.0]\n\n### Changes\n\n- Item\n", "0.1.0", "abc1234"),
    /full 40-character/,
  );
});

test("release tag creation is retry-safe only when the tag is annotated at the same SHA", () => {
  assert.equal(
    existingTagAction({ tag: "v0.1.0", sourceSha, existingTargetSha: undefined, annotated: false }),
    "create",
  );
  assert.equal(existingTagAction({ tag: "v0.1.0", sourceSha, existingTargetSha: sourceSha, annotated: true }), "reuse");
  assert.throws(
    () => existingTagAction({ tag: "v0.1.0", sourceSha, existingTargetSha: "b".repeat(40), annotated: true }),
    /not tested source commit/,
  );
  assert.throws(
    () => existingTagAction({ tag: "v0.1.0", sourceSha, existingTargetSha: sourceSha, annotated: false }),
    /lightweight tag/,
  );
});
