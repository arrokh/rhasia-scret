import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const docsRoot = resolve(import.meta.dirname, "../docs");
const readDoc = (path) => readFileSync(resolve(docsRoot, path), "utf8");
const productStatus = readDoc("product-status.md");
const releaseProcess = readDoc("release-process.md");
const selfHosting = readDoc("self-hosting.md");
const documentationIndex = readDoc("README.md");
const roadmap = readFileSync(resolve(docsRoot, "../ROADMAP.md"), "utf8");
const readinessIndex = readDoc("release-readiness/README.md");
const releaseSkill = readFileSync(resolve(import.meta.dirname, "../.pi/skills/release-pr/SKILL.md"), "utf8");

const historicalDocuments = [
  "api-service-extraction-plan.md",
  "api-architecture-deepening.md",
  "release-version-automation-plan.md",
  "release-readiness/2026-09-21.md",
].map(readDoc);

test("product status distinguishes the moving main branch from published releases", () => {
  assert.match(productStatus, /The `main` branch can advance beyond any published release\./);
  assert.match(productStatus, /GitHub Releases/);
  assert.doesNotMatch(productStatus, /(?:release\s+)?tag at `?HEAD/i);
});

test("release process scopes readiness evidence to a candidate and immutable baseline", () => {
  assert.match(
    releaseProcess,
    /Each `docs\/release-readiness\/vX\.Y\.Z\.md` record applies only to that version, source SHA, and recorded evidence timestamp\./,
  );
  assert.match(releaseProcess, /Confirm publication through the exact-source GitHub Release and workflow provenance/);
  assert.doesNotMatch(releaseProcess, /latest candidate-specific[^\n]*release-readiness\/v\d/i);
  assert.doesNotMatch(releaseProcess, /tag at `?HEAD/i);
});

test("documents one version tag per new Docker image and a consolidated Actions overview", () => {
  assert.ok(releaseProcess.includes("Each image receives only the matching `vX.Y.Z` release tag."));
  assert.ok(releaseProcess.includes("New releases do not publish a source-SHA image tag or a floating `latest` tag"));
  assert.ok(releaseProcess.includes("one consolidated overview to the GitHub Actions run summary"));
  assert.ok(releaseProcess.includes("OCI revision label and publication artifact"));
  assert.ok(selfHosting.includes("Use the published `vX.Y.Z` release tag for current releases"));
  assert.ok(selfHosting.includes("existing historical full commit-SHA tag"));
});

test("documentation index links to a stable readiness-record index, not a specific candidate", () => {
  assert.match(documentationIndex, /\[Release readiness records\]\(release-readiness\/README\.md\)/);
  assert.doesNotMatch(documentationIndex, /release-readiness\/v\d+\.\d+\.\d+\.md/);
});

test("roadmap records release completion as a milestone and points to exact evidence", () => {
  assert.match(
    roadmap,
    /Readiness snapshots are candidate-specific; verify any release through its tagged GitHub Release and exact-SHA workflow evidence\./,
  );
  assert.doesNotMatch(roadmap, /in this review/);
});

test("readiness index explains candidate scope and publication evidence", () => {
  assert.match(
    readinessIndex,
    /Each record applies only to its stated version, reviewed baseline SHA, and evidence timestamp\./,
  );
  assert.match(readinessIndex, /Confirm publication through the exact-source GitHub Release and workflow provenance/);
});

test("release skill treats a missing candidate as the normal preparation path", () => {
  assert.match(releaseSkill, /Their absence is the normal path to prepare a candidate, not a stop condition\./);
  assert.match(releaseSkill, /the documentation index should point to readiness records generically/);
});

test("historical implementation records do not present a fixed candidate as current readiness", () => {
  const staleClaim =
    /current\s+(?:API\/Web\s+)?readiness\s+is\s+recorded\s+in\s+\[[^\]]+\]\(release-readiness\/v\d+\.\d+\.\d+\.md\)/i;
  for (const document of historicalDocuments) assert.doesNotMatch(document, staleClaim);
});
