import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { affectedChecks, detectAffectedChecks } from "./detect-ci-changes.mjs";

const all = { core: true, web: true, mobile: true };
const none = { core: false, web: false, mobile: false };

test("selects only the affected application and combines mixed pushes", () => {
  assert.deepEqual(affectedChecks(["apps/web/src/app/page.tsx"]), { ...none, web: true });
  assert.deepEqual(affectedChecks(["apps/mobile/src/localization.ts"]), { ...none, mobile: true });
  assert.deepEqual(affectedChecks(["apps/mobile/App.tsx", "apps/web/messages/en.json"]), {
    ...none,
    web: true,
    mobile: true,
  });
});

test("runs shared packages and both consumers for shared inputs or unknown workspaces", () => {
  for (const path of [
    "packages/client-vault-core/src/index.ts",
    "packages/new-client-capability/index.ts",
    "apps/new-app/package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "package.json",
    ".mise.toml",
    ".npmrc",
    "eslint.config.mjs",
    "patches/expo.patch",
    ".github/workflows/ci.yml",
    "tools/detect-ci-changes.mjs",
    "AGENTS.md",
    "CONTEXT.md",
    "docs/adr/new-contract.md",
    "docs/security/incident-response.md",
  ]) {
    assert.deepEqual(affectedChecks([path]), all, path);
  }
});

test("documentation-only changes need repository checks but no application jobs", () => {
  assert.deepEqual(affectedChecks(["README.md", "docs/product-roadmap-review.md"]), none);
  assert.deepEqual(affectedChecks([]), none);
});

test("missing or invalid comparison commits conservatively select every check", () => {
  for (const before of [undefined, "0".repeat(40), "invalid", "--help"]) {
    assert.deepEqual(detectAffectedChecks({ before, after: "a".repeat(40) }), all);
  }
});

test("wires package selection to every consuming job without cancelling a different commit", () => {
  const workflow = readFileSync(resolve(import.meta.dirname, "../.github/workflows/ci.yml"), "utf8");
  const job = (name) => {
    const body = workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z-]+:|$(?![\\s\\S]))`, "m"))?.[1];
    assert.ok(body, `missing job: ${name}`);
    return body;
  };
  const changes = job("changes");
  assert.ok(changes.includes("timeout-minutes: 8"));
  assert.ok(workflow.includes("pull_request:\n    branches: [main]"));
  assert.ok(changes.includes("group: ci-changes-${{ github.workflow }}-${{ github.ref_name }}"));
  assert.match(changes, /cancel-in-progress: true/);
  assert.ok(workflow.includes("branches: [main]"));
  for (const [name, scope, timeout, concurrencyGroup] of [
    ["core", "core", 8, "ci-core-${{ github.workflow }}-${{ github.ref_name }}"],
    ["quality", "web", 8, "ci-web-quality-${{ github.workflow }}-${{ github.ref_name }}"],
    ["mobile", "mobile", 8, "ci-mobile-${{ github.workflow }}-${{ github.ref_name }}"],
    [
      "browser",
      "web",
      8,
      "ci-web-browser-${{ github.workflow }}-${{ github.ref_name }}-${{ matrix.suite }}-${{ matrix.browser }}",
    ],
    ["browser-production", "web", 8, "ci-web-production-${{ github.workflow }}-${{ github.ref_name }}"],
  ]) {
    const body = job(name);
    assert.match(body, /^    needs: changes$/m);
    assert.ok(body.includes(`    if: needs.changes.outputs.${scope} == 'true'`));
    assert.ok(body.includes(`    timeout-minutes: ${timeout}`));
    assert.ok(body.includes(`      group: ${concurrencyGroup}`));
    assert.match(body, /cancel-in-progress: true/);
  }
  const repository = job("repository");
  assert.doesNotMatch(repository, /^    (?:if|needs):/m);
  assert.ok(repository.includes("timeout-minutes: 8"));
  assert.ok(repository.includes("group: ci-repository-${{ github.workflow }}-${{ github.ref_name }}"));
  assert.match(repository, /cancel-in-progress: true/);
  assert.match(job("changes"), /fetch-depth: 0/);
  assert.ok(
    job("changes").includes(
      "CI_BASE_SHA: ${{ github.event_name == 'pull_request' && github.event.pull_request.base.sha || github.event.before }}",
    ),
  );
  for (const scope of ["core", "web", "mobile"]) {
    assert.ok(job("changes").includes(scope + ": ${{ steps.detect.outputs." + scope + " }}"));
  }
  assert.doesNotMatch(workflow, /^concurrency:/m);
});

test("detects a complete multi-commit push, moves, deletions, and unavailable history", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "rhsia-ci-changes-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init");
  git("config", "user.name", "CI test");
  git("config", "user.email", "ci@example.invalid");
  const save = (path, text) => {
    mkdirSync(resolve(cwd, path, ".."), { recursive: true });
    writeFileSync(join(cwd, path), text);
  };
  const commit = () => {
    git("add", "--all");
    git("-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
    return git("rev-parse", "HEAD");
  };
  save("README.md", "initial\n");
  const before = commit();
  save("apps/web/space and\nnewline.ts", "web\n");
  const web = commit();
  save("apps/mobile/new.ts", "mobile\n");
  const mixed = commit();
  assert.deepEqual(detectAffectedChecks({ cwd, before, after: web }), { ...none, web: true });
  assert.deepEqual(detectAffectedChecks({ cwd, before, after: mixed }), { ...none, web: true, mobile: true });
  renameSync(join(cwd, "apps/web/space and\nnewline.ts"), join(cwd, "apps/mobile/moved.ts"));
  const moved = commit();
  assert.deepEqual(detectAffectedChecks({ cwd, before: mixed, after: moved }), { ...none, web: true, mobile: true });
  rmSync(join(cwd, "apps/mobile/moved.ts"));
  const deleted = commit();
  assert.deepEqual(detectAffectedChecks({ cwd, before: moved, after: deleted }), { ...none, mobile: true });
  assert.deepEqual(detectAffectedChecks({ cwd, before: "a".repeat(40), after: deleted }), all);

  const output = join(cwd, "output");
  execFileSync(process.execPath, [resolve(import.meta.dirname, "detect-ci-changes.mjs")], {
    cwd,
    env: { ...process.env, CI_BASE_SHA: moved, GITHUB_SHA: deleted, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: "" },
  });
  assert.equal(readFileSync(output, "utf8"), "core=false\nweb=false\nmobile=true\n");
});
