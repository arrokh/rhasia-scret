import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { verifyReleaseWorkflowPolicy } from "./verify-release-workflow-policy.mjs";

const workflowPath = resolve(import.meta.dirname, "../.github/workflows/release.yml");
const workflow = readFileSync(workflowPath, "utf8");

test("release workflow gates an immutable GitHub publication on exact-source full verification", () => {
  assert.deepEqual(verifyReleaseWorkflowPolicy(workflow), { valid: true, failures: [] });
});

test("requires newly created GitHub Releases to use the exact version-based Latest title", () => {
  const oldTitle = workflow.replace('--title "v${VERSION} Latest"', '--title "rhasia-scret v${VERSION}"');
  const incorrectVersion = workflow.replace('--title "v${VERSION} Latest"', '--title "v${VERSION} Latest Release"');

  for (const modifiedWorkflow of [oldTitle, incorrectVersion]) {
    assert.ok(
      verifyReleaseWorkflowPolicy(modifiedWorkflow).failures.some((failure) =>
        failure.includes("exact version-based Latest display title"),
      ),
    );
  }
});

test("requires the pinned Bun runtime for the exact-source browser gate", () => {
  const missingBunSetup = workflow.replace(
    /      - uses: oven-sh\/setup-bun@[0-9a-f]{40}[^\n]*\n        with:\n          bun-version: 1\.3\.9\n/,
    "",
  );
  const unpinnedBunSetup = workflow.replace(
    "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
    "oven-sh/setup-bun@main",
  );
  const wrongBunVersion = workflow.replace("bun-version: 1.3.9", "bun-version: 1.3.8");

  for (const modifiedWorkflow of [missingBunSetup, unpinnedBunSetup, wrongBunVersion]) {
    assert.ok(
      verifyReleaseWorkflowPolicy(modifiedWorkflow).failures.some((failure) => failure.includes("pinned Bun runtime")),
    );
  }
});

test("installs Chromium and its system dependencies before the exact-source browser gate", () => {
  const missingBrowser = workflow.replace(
    "run: pnpm --filter @rhasia-scret/web exec playwright install chromium",
    "run: pnpm --filter @rhasia-scret/web exec playwright install firefox",
  );
  const missingSystemDependencies = workflow.replace(
    "run: pnpm --filter @rhasia-scret/web exec playwright install-deps chromium",
    "run: pnpm --filter @rhasia-scret/web exec playwright install-deps firefox",
  );

  for (const modifiedWorkflow of [missingBrowser, missingSystemDependencies]) {
    assert.ok(
      verifyReleaseWorkflowPolicy(modifiedWorkflow).failures.some((failure) =>
        failure.includes("install Chromium and system dependencies"),
      ),
    );
  }
});

test("rejects a stale release diff base derived from the original PR commit parent", () => {
  const stalePushBase = workflow.replace(
    "PUSH_BASE_SHA: ${{ github.event.before }}",
    "PUSH_BASE_SHA: ${{ github.sha }}",
  );
  const originalPrParent = workflow.replace(
    'PR_BASE_SHA="$PUSH_BASE_SHA"',
    'PR_BASE_SHA="$(gh api "repos/${GH_REPOSITORY}/pulls/${PR_NUMBER}/commits" --jq \'.[0].parents[0].sha\')"',
  );

  assert.ok(verifyReleaseWorkflowPolicy(stalePushBase).failures.some((failure) => failure.includes("pre-merge SHA")));
  assert.ok(
    verifyReleaseWorkflowPolicy(originalPrParent).failures.some((failure) =>
      failure.includes("first PR commit parent"),
    ),
  );
});

test("restricts publication recovery to a merged dedicated release PR on main", () => {
  const untrustedRef = workflow.replace(
    '[[ "$WORKFLOW_REF" == "refs/heads/main" ]]',
    '[[ "$WORKFLOW_REF" == "refs/heads/release" ]]',
  );
  const wrongSource = workflow.replace(".merge_commit_sha", ".head.sha");
  const missingMergeBase = workflow.replace(
    'PR_BASE_SHA="$(git rev-parse "${SOURCE_SHA}^1")"',
    'PR_BASE_SHA="$PUSH_BASE_SHA"',
  );
  const optionalRecoveryPr = workflow.replace(
    "        required: true\n        type: number",
    "        required: false\n        type: number",
  );

  assert.ok(verifyReleaseWorkflowPolicy(untrustedRef).failures.some((failure) => failure.includes("from main")));
  assert.ok(verifyReleaseWorkflowPolicy(wrongSource).failures.some((failure) => failure.includes("merge commit")));
  assert.ok(verifyReleaseWorkflowPolicy(missingMergeBase).failures.some((failure) => failure.includes("first parent")));
  assert.ok(verifyReleaseWorkflowPolicy(optionalRecoveryPr).failures.some((failure) => failure.includes("PR number")));
});

test("requires a GitHub Actions tagger identity before tag creation", () => {
  const missingTagIdentity = workflow.replace(
    '          git config user.name "github-actions[bot]"\n          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"\n',
    "",
  );

  assert.ok(
    verifyReleaseWorkflowPolicy(missingTagIdentity).failures.some((failure) =>
      failure.includes("tagger identity before creating the annotated tag"),
    ),
  );
});

test("rejects a mutable/lightweight tag and broadened permissions", () => {
  const mutableTagWorkflow = workflow.replace('git tag -a "$TAG"', 'git tag -f "$TAG"');
  const permissionEscalation = workflow.replace(
    "contents: read\n      pull-requests: read",
    "contents: write\n      pull-requests: write",
  );
  const verificationWrite = workflow.replace(
    "    permissions:\n      contents: read\n    outputs:",
    "    permissions:\n      contents: write\n    outputs:",
  );
  const candidateOtherWrite = workflow.replace(
    "      contents: read\n      pull-requests: read",
    "      contents: read\n      issues: write\n      pull-requests: read",
  );
  const broadPermissions = workflow.replace("permissions:\n  contents: read", "permissions: write-all");
  assert.ok(
    verifyReleaseWorkflowPolicy(mutableTagWorkflow).failures.some((failure) => failure.includes("annotated tag")),
  );
  assert.ok(
    verifyReleaseWorkflowPolicy(permissionEscalation).failures.some((failure) =>
      failure.includes("read-only pull-request"),
    ),
  );
  assert.ok(
    verifyReleaseWorkflowPolicy(permissionEscalation).failures.some((failure) =>
      failure.includes("unnecessary write permission"),
    ),
  );
  assert.ok(
    verifyReleaseWorkflowPolicy(verificationWrite).failures.some((failure) =>
      failure.includes("Only publication may write"),
    ),
  );
  assert.ok(
    verifyReleaseWorkflowPolicy(candidateOtherWrite).failures.some((failure) =>
      failure.includes("Only the publish job may request write permission"),
    ),
  );
  assert.ok(
    verifyReleaseWorkflowPolicy(broadPermissions).failures.some((failure) =>
      failure.includes("broad write-all or read-all"),
    ),
  );
});

test("rejects publishing without full isolated tests or when deployment/migration commands are added", () => {
  const missingFullGate = workflow.replace("pnpm run test:full:container", "pnpm run test:web");
  const deploymentCommand = workflow.replace(
    'echo "Verified existing annotated tag',
    'pnpm run prisma:migrate:deploy\n            echo "Verified existing annotated tag',
  );
  assert.ok(
    verifyReleaseWorkflowPolicy(missingFullGate).failures.some((failure) =>
      failure.includes("complete isolated repository gate"),
    ),
  );
  assert.ok(
    verifyReleaseWorkflowPolicy(deploymentCommand).failures.some((failure) =>
      failure.includes("must not deploy services or run migrations"),
    ),
  );
});

test("gates Docker Hub publishing on a verified repository release and preserves release/SHA tags", () => {
  const missingReleaseDependency = workflow.replace(
    "needs: [candidate, verify, publish]",
    "needs: [candidate, verify]",
  );
  const missingDockerHubToken = workflow.replace(
    "          DOCKERHUB_TOKEN: ${{ secrets.DOCKERHUB_TOKEN }}\n",
    "          DOCKERHUB_TOKEN: ''\n",
  );
  const missingSourceTag = workflow.replace(
    '            --tag "${IMAGE}:sha-${SOURCE_SHA}" \\\n',
    '            --tag "${IMAGE}:latest" \\\n',
  );

  assert.ok(
    verifyReleaseWorkflowPolicy(missingReleaseDependency).failures.some((failure) =>
      failure.includes("only after exact-source verification"),
    ),
  );
  assert.ok(
    verifyReleaseWorkflowPolicy(missingDockerHubToken).failures.some((failure) =>
      failure.includes("repository secrets and password-stdin"),
    ),
  );
  assert.ok(
    verifyReleaseWorkflowPolicy(missingSourceTag).failures.some((failure) =>
      failure.includes("release version and exact source SHA tags"),
    ),
  );
});
