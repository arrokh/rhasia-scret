import assert from "node:assert/strict";
import test from "node:test";
import { parseReleasePrArguments, releaseBranchName } from "./release-pr.mjs";
import { parseReleaseUpdateArguments, refreshReleaseChangelog } from "./release-update.mjs";
import {
  assertReleasePullRequestBodyManaged,
  releasePullRequestMetadata,
  updateReleasePullRequestBody,
} from "./release-pr-metadata.mjs";

const version = "1.4.2";
const previousMainSha = "a".repeat(40);
const currentMainSha = "b".repeat(40);

test("release creation accepts only an explicit supported bump", () => {
  assert.deepEqual(parseReleasePrArguments(["patch"]), { bump: "patch" });
  assert.deepEqual(parseReleasePrArguments(["minor"]), { bump: "minor" });
  assert.deepEqual(parseReleasePrArguments(["major"]), { bump: "major" });
  assert.throws(() => parseReleasePrArguments([]), /Usage:/);
  assert.throws(() => parseReleasePrArguments(["patch", "minor"]), /Usage:/);
});

test("release branches are version-specific", () => {
  assert.equal(releaseBranchName(version), "infra/chore/prepare-release-v1.4.2");
});

test("release update accepts no extra arguments", () => {
  assert.deepEqual(parseReleaseUpdateArguments([]), {});
  assert.throws(() => parseReleaseUpdateArguments(["patch"]), /Usage: pnpm release:update/);
});

test("release PR metadata updates baseline and commit while preserving maintainer text", () => {
  const initialBody = [
    "Maintainer-written context stays outside the managed block.",
    "",
    releasePullRequestMetadata({ version, baseSha: previousMainSha, sourceSha: previousMainSha }),
    "",
    "Additional maintainer notes also stay intact.",
  ].join("\n");
  const updated = updateReleasePullRequestBody(initialBody, {
    version,
    baseSha: currentMainSha,
    sourceSha: currentMainSha,
    appendedSubjects: ["one synthetic commit"],
  });

  assert.ok(updated.startsWith("Maintainer-written context stays outside the managed block."));
  assert.ok(updated.includes(currentMainSha));
  assert.match(updated, /Newly appended first-parent commits: 1/);
  assert.ok(updated.endsWith("Additional maintainer notes also stay intact."));
});

test("release PR metadata refuses to overwrite descriptions without valid managed markers", () => {
  assert.throws(
    () =>
      updateReleasePullRequestBody("Manually authored description", {
        version,
        baseSha: currentMainSha,
        sourceSha: currentMainSha,
      }),
    /missing its automation markers/,
  );
  assert.throws(() => assertReleasePullRequestBodyManaged(""), /missing its automation markers/);
  assert.throws(
    () =>
      updateReleasePullRequestBody("<!-- release-pr-metadata:start -->broken", {
        version,
        baseSha: currentMainSha,
        sourceSha: currentMainSha,
      }),
    /invalid automation markers/,
  );
  assert.throws(
    () =>
      updateReleasePullRequestBody(
        "<!-- release-pr-metadata:start -->one<!-- release-pr-metadata:end --><!-- release-pr-metadata:start -->two<!-- release-pr-metadata:end -->",
        { version, baseSha: currentMainSha, sourceSha: currentMainSha },
      ),
    /invalid automation markers/,
  );
});

test("release update appends new main subjects and preserves curated release notes", () => {
  const source = changelog(previousMainSha);
  const result = refreshReleaseChangelog({
    changelog: source,
    version,
    mainSha: currentMainSha,
    newSubjects: ["[web] add a new synthetic capability", "[api] fix a synthetic issue"],
  });

  assert.equal(result.previousMainSha, previousMainSha);
  assert.equal(result.mainSha, currentMainSha);
  assert.deepEqual(result.appendedSubjects, ["[web] add a new synthetic capability", "[api] fix a synthetic issue"]);
  assert.equal(result.changed, true);
  assert.match(result.changelog, /- Curated summary that replaces several commit subjects\./);
  assert.match(result.changelog, /- Keep this manually curated security note\./);
  assert.ok(result.changelog.includes("- [web] add a new synthetic capability"));
  assert.ok(result.changelog.includes("- [api] fix a synthetic issue"));
  assert.match(result.changelog, new RegExp(`first-parent history v1\\.4\\.1\\.\\.${currentMainSha}`));
  assert.match(result.changelog, new RegExp(`release-base ${currentMainSha}`));
  assert.match(result.changelog, /## \[Unreleased\][\s\S]*Keep future notes/);
});

test("release update deduplicates exact subjects in Changes but not across other sections", () => {
  const source = changelog(previousMainSha).replace(
    "- Curated summary that replaces several commit subjects.",
    "- [web] add a new synthetic capability",
  );
  const result = refreshReleaseChangelog({
    changelog: source,
    version,
    mainSha: currentMainSha,
    newSubjects: ["[web] add a new synthetic capability", "Keep this manually curated security note."],
  });

  assert.deepEqual(result.appendedSubjects, ["Keep this manually curated security note."]);
  assert.equal(result.changelog.match(/Keep this manually curated security note\./g)?.length, 2);
  assert.match(result.changelog, new RegExp(`release-base ${currentMainSha}`));
});

test("release update advances the base marker when all new commits are already curated", () => {
  const source = changelog(previousMainSha).replace(
    "- Curated summary that replaces several commit subjects.",
    "- [web] add a new synthetic capability",
  );
  const result = refreshReleaseChangelog({
    changelog: source,
    version,
    mainSha: currentMainSha,
    newSubjects: ["[web] add a new synthetic capability"],
  });

  assert.deepEqual(result.appendedSubjects, []);
  assert.equal(result.changed, true);
  assert.match(result.changelog, new RegExp(`release-base ${currentMainSha}`));
});

test("release update refuses to rewrite missing or malformed candidate sections", () => {
  assert.throws(
    () => refreshReleaseChangelog({ changelog: "# Changelog\n", version, mainSha: currentMainSha, newSubjects: [] }),
    /missing ## \[1\.4\.2\]/,
  );
  assert.throws(
    () =>
      refreshReleaseChangelog({
        changelog: changelog(previousMainSha).replace(/release-base .+/, "no marker"),
        version,
        mainSha: currentMainSha,
        newSubjects: [],
      }),
    /missing its release update marker/,
  );
  assert.throws(
    () =>
      refreshReleaseChangelog({ changelog: changelog(previousMainSha), version, mainSha: "bad-sha", newSubjects: [] }),
    /full origin\/main commit SHA/,
  );
});

test("release update rejects a commit subject that could break changelog structure", () => {
  assert.throws(
    () =>
      refreshReleaseChangelog({
        changelog: changelog(previousMainSha),
        version,
        mainSha: currentMainSha,
        newSubjects: ["unsafe\n## [1.5.0]"],
      }),
    /invalid first-parent commit subject/,
  );
});

function changelog(baseSha) {
  return `# Changelog\n\n## [${version}]\n\n<!-- Draft generated from first-parent history v1.4.1..${baseSha} (first-parent, exclusive of tag); release-base ${baseSha}. Review and curate before publication. -->\n\n### Changes\n\n- Curated summary that replaces several commit subjects.\n\n### Security\n\n- Keep this manually curated security note.\n\n## [Unreleased]\n\n### Added\n\n- Keep future notes.\n`;
}
