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
const ciWorkflow = readFileSync(resolve(import.meta.dirname, "../.github/workflows/ci.yml"), "utf8");
const rootPackage = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"));
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

test("automated CI and release publication do not depend on candidate readiness records", () => {
  assert.match(releaseProcess, /The automated release publisher does not use candidate readiness records\./);
  assert.match(releaseProcess, /they do not gate CI, the release PR, or publication\./);
  assert.match(releaseProcess, /The post-merge release provenance records the exact triggering `main` SHA/);
  assert.doesNotMatch(ciWorkflow, /verify:release-evidence:(?:current|ready)/);
  assert.doesNotMatch(rootPackage.scripts["test:full:hosted"], /verify:release-evidence:(?:current|ready)/);
  assert.doesNotMatch(releaseProcess, /exact-source readiness gate/);
  assert.doesNotMatch(releaseProcess, /tag at `?HEAD/i);
});

test("documents one version tag per new Docker image and a consolidated Actions overview", () => {
  assert.ok(releaseProcess.includes("Each image receives only the matching `vX.Y.Z` release tag."));
  assert.ok(releaseProcess.includes("New releases do not publish a source-SHA image tag or a floating `latest` tag"));
  assert.ok(
    releaseProcess.includes("The GitHub Release body lists each image link and release-specific pull command."),
  );
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
    /Existing records remain scoped to their stated version, reviewed baseline SHA, and evidence timestamp\./,
  );
  assert.match(readinessIndex, /Confirm publication through the exact-source GitHub Release and workflow provenance/);
});

test("release skill directs candidate creation and refresh through the pnpm commands", () => {
  assert.match(releaseSkill, /pnpm release:patch/);
  assert.match(releaseSkill, /pnpm release:update/);
  assert.match(releaseSkill, /The skill does not merge or publish\./);
});

test("historical implementation records do not present a fixed candidate as current readiness", () => {
  const staleClaim =
    /current\s+(?:API\/Web\s+)?readiness\s+is\s+recorded\s+in\s+\[[^\]]+\]\(release-readiness\/v\d+\.\d+\.\d+\.md\)/i;
  for (const document of historicalDocuments) assert.doesNotMatch(document, staleClaim);
});
