export function verifyReleaseWorkflowPolicy(source) {
  const failures = [];
  const require = (condition, message) => {
    if (!condition) failures.push(message);
  };
  require(/on:\s*\n\s+push:\s*\n\s+branches:\s*\[main\]/.test(
    source,
  ), "Automatic release publication must run only after a push to main.");
  require(/workflow_dispatch:\s*\n\s+inputs:\s*\n\s+recovery_pr:\s*\n\s+description:[^\n]*\n\s+required:\s*true\n\s+type:\s*number/.test(
    source,
  ), "Manual recovery must require one release PR number.");
  require(/permissions:\s*\n\s+contents:\s*read/.test(
    source,
  ), "Workflow-wide token permission must default to contents: read.");
  require(/contents:\s*read/.test(
    job(source, "candidate"),
  ), "Candidate discovery must use read-only repository permission.");
  require(/pull-requests:\s*read/.test(
    job(source, "candidate"),
  ), "Candidate discovery must use read-only pull-request permission.");
  const verifyJob = job(source, "verify");
  require(/contents:\s*read/.test(verifyJob), "Verification must use read-only repository permission.");
  require(/oven-sh\/setup-bun@[0-9a-f]{40}/.test(verifyJob) &&
    /bun-version:\s*1\.3\.9/.test(
      verifyJob,
    ), "Exact-source full verification must install the pinned Bun runtime required by browser tests.");
  const chromiumSystemDependencies = verifyJob.indexOf(
    "pnpm --filter @rhasia-scret/web exec playwright install-deps chromium",
  );
  const chromiumBrowser = verifyJob.indexOf("pnpm --filter @rhasia-scret/web exec playwright install chromium");
  const fullRepositoryGate = verifyJob.indexOf("pnpm run test:full:container");
  require(chromiumSystemDependencies >= 0 &&
    chromiumBrowser > chromiumSystemDependencies &&
    fullRepositoryGate >
      chromiumBrowser, "Exact-source full verification must install Chromium and system dependencies before the browser gate.");
  require(!/contents:\s*write/.test(
    `${job(source, "candidate")}\n${job(source, "verify")}`,
  ), "Only publication may write repository contents.");
  const publishJob = job(source, "publish");
  const writePermissions = [...source.matchAll(/^[ \t]+([a-z-]+):[ \t]*write[ \t]*$/gm)];
  require(writePermissions.length === 1 &&
    writePermissions[0][1] === "contents" &&
    publishJob.includes(
      writePermissions[0][0],
    ), "Only the publish job may request write permission, and only for contents.");
  require(!/^[ \t]*permissions:[ \t]*(?:write-all|read-all)[ \t]*$/m.test(
    source,
  ), "Jobs must not use broad write-all or read-all permissions.");
  require(!/pull-requests:\s*write|administration:\s*write|actions:\s*write/.test(
    source,
  ), "Release workflow requests an unnecessary write permission.");
  require(/pulls\/\$\{PR_NUMBER\}\/files/.test(
    job(source, "candidate"),
  ), "Candidate discovery must inspect the merged release PR file list.");
  const candidateJob = job(source, "candidate");
  require(/PUSH_BASE_SHA:\s*\$\{\{\s*github\.event\.before\s*\}\}/.test(
    candidateJob,
  ), "Candidate diff base must be the main push's pre-merge SHA.");
  require(/PR_BASE_SHA="\$PUSH_BASE_SHA"/.test(
    candidateJob,
  ), "Push candidate diff must use the main push's pre-merge SHA.");
  require(candidateJob.includes('[[ "$WORKFLOW_REF" == "refs/heads/main" ]]'), "Recovery dispatch must run from main.");
  require(candidateJob.includes(
    '[[ "$RECOVERY_PR" =~ ^[1-9][0-9]*$ ]]',
  ), "Recovery dispatch must require a valid PR number.");
  require(candidateJob.includes(".base.ref") &&
    candidateJob.includes(".merged_at"), "Recovery must require a merged PR targeting main.");
  require(candidateJob.includes(".merge_commit_sha"), "Recovery must use the selected merged PR's exact merge commit.");
  require(candidateJob.includes(
    '[[ "$PR_TITLE" == "$EXPECTED_TITLE" ]]',
  ), "Recovery PR must have the exact dedicated release title.");
  require(candidateJob.includes(
    'git merge-base --is-ancestor "$SOURCE_SHA" "$WORKFLOW_SHA"',
  ), "Recovery source must be on current main history.");
  require(candidateJob.includes(
    'PR_BASE_SHA="$(git rev-parse "${SOURCE_SHA}^1")"',
  ), "Recovery diff base must be the candidate merge commit's first parent.");
  require(/source_sha:\s*\$\{\{\s*steps\.candidate\.outputs\.source_sha\s*\}\}/.test(
    candidateJob,
  ), "Candidate discovery must pass its exact source SHA downstream.");
  require(!/pulls\/\$\{PR_NUMBER\}\/commits/.test(
    job(source, "candidate"),
  ), "Candidate discovery must not derive its diff base from the first PR commit parent.");
  require(/\[infra\]\[chore\] Prepare release/.test(
    job(source, "candidate"),
  ), "Only the dedicated release PR title may trigger publication.");
  require(/verify-release-pr-changes\.mjs --version[\s\S]*--base/.test(
    job(source, "candidate"),
  ), "Candidate discovery must reject non-release changes across the full release PR diff.");
  require(/ref:\s*\$\{\{ needs\.candidate\.outputs\.source_sha \}\}/.test(
    job(source, "verify"),
  ), "Release verification must check out the exact candidate source SHA.");
  require(/ref:\s*\$\{\{ needs\.verify\.outputs\.source_sha \}\}/.test(
    job(source, "publish"),
  ), "Publication must check out the exact verified candidate source SHA.");
  require(/fetch-depth:\s*0/.test(job(source, "verify")), "Release verification must fetch full history and tags.");
  require(/pnpm run test:full:container/.test(
    job(source, "verify"),
  ), "Publication must wait for the complete isolated repository gate.");
  require(/verify:release-evidence:ready/.test(
    job(source, "verify"),
  ), "Publication must require the version-specific ready evidence record.");
  require(/release-publication\.mjs --sha/.test(
    job(source, "verify"),
  ), "The exact source and changelog must be validated before testing.");
  require(/needs:\s*\[candidate, verify\]/.test(
    job(source, "publish"),
  ), "Publication must depend on candidate discovery and successful verification.");
  require(/needs\.verify\.result == 'success'/.test(
    job(source, "publish"),
  ), "Publication must be gated on successful verification.");
  require(/repository-release-publish-\$\{\{ needs\.candidate\.outputs\.tag \}\}/.test(
    job(source, "publish"),
  ), "Publication retries must be serialized by release tag.");
  const tagIdentity = publishJob.indexOf('git config user.name "github-actions[bot]"');
  const tagEmail = publishJob.indexOf('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
  const annotatedTag = publishJob.indexOf('git tag -a "$TAG"');
  require(tagIdentity >= 0 &&
    tagEmail > tagIdentity &&
    annotatedTag > tagEmail, "Publication must configure a tagger identity before creating the annotated tag.");
  require(/git tag -a/.test(publishJob), "Publication must create an annotated tag.");
  require(/git push origin "refs\/tags\/\$\{TAG\}"/.test(
    job(source, "publish"),
  ), "Publication must push only the candidate release tag.");
  require(/EXISTING_SHA.*SOURCE_SHA/.test(
    job(source, "publish"),
  ), "Existing tags must be verified against the exact tested commit.");
  require(/gh release create/.test(job(source, "publish")), "Successful publication must create a GitHub Release.");
  require(/gh release create "\$TAG" \\\n\s+--title "v\$\{VERSION\} Latest"/.test(
    publishJob,
  ), "New GitHub Releases must use the exact version-based Latest display title.");
  require(/Source commit: \$\{SOURCE_SHA\}/.test(
    job(source, "publish"),
  ), "Existing GitHub Releases must be verified against the source SHA.");
  require(/repository-release-publication-/.test(job(source, "publish")) &&
    /github-release-url\.txt/.test(
      job(source, "publish"),
    ), "Publication provenance must include the release reference.");
  require(/actions\/upload-artifact@[0-9a-f]{40}/.test(
    job(source, "publish"),
  ), "Publication provenance must be retained as a workflow artifact.");
  require(!/\b(?:vercel\s+deploy|prisma\s+migrate|pnpm\s+run\s+prisma:migrate)\b/i.test(
    source,
  ), "Repository publication must not deploy services or run migrations.");
  return { valid: failures.length === 0, failures };
}

function job(source, id) {
  const match = source.match(new RegExp(`^  ${id}:\\n([\\s\\S]*?)(?=^  [a-z-]+:|$(?![\\s\\S]))`, "m"));
  return match?.[1] ?? "";
}
