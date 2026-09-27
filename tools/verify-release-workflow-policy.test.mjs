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
