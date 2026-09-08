import assert from "node:assert/strict";
import test from "node:test";
import { findUnpinnedActionReferences, parseReadinessRecord } from "./verify-release-evidence.mjs";

const validRecord = `# Launch readiness — 2026-09-08

## Decision

**READY FOR HUMAN RELEASE REVIEW**

Candidate version: \`0.1.0\`
Repository baseline reviewed: \`d653304\`
Evidence captured: 2026-09-08T13:00:00+07:00
Evidence owner: repository maintainers

## Issue and PR ledger

| Scope | Status |
| --- | --- |
| #144 | Repository-complete |

## Repository evidence captured

| Check | Result |
| --- | --- |
| Full gate | Pass |

## External evidence

| Check | Status |
| --- | --- |
| Production | Not Verifiable |

## Required exit conditions

1. Record repository evidence.
`;

test("accepts a complete repository readiness record", () => {
  const result = parseReadinessRecord(validRecord, "fixture.md");
  assert.equal(result.valid, true);
  assert.equal(result.decision, "READY FOR HUMAN RELEASE REVIEW");
  assert.equal(result.candidateVersion, "0.1.0");
  assert.deepEqual(result.failures, []);
});

test("rejects a readiness record with missing metadata and sections", () => {
  const result = parseReadinessRecord("## Decision\n\n**HOLD**", "fixture.md");
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((failure) => failure.includes("Candidate version")));
  assert.ok(result.failures.some((failure) => failure.includes("Evidence owner")));
  assert.ok(result.failures.some((failure) => failure.includes("## External evidence")));
});

test("finds unpinned actions in YAML list items", () => {
  const source = `steps:\n  - uses: actions/checkout@v4\n  - uses: actions/setup-node@1234567890abcdef1234567890abcdef12345678 # pinned\n`;
  assert.deepEqual(findUnpinnedActionReferences(source), ["actions/checkout@v4"]);
});
