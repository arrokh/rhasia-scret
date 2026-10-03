export function verifyReleaseWorkflowPolicy(source) {
  const failures = [];
  const require = (condition, message) => {
    if (!condition) failures.push(message);
  };
  require(/on:\s*\n\s+push:\s*\n\s+branches:\s*\[main\]/.test(
    source,
  ), "Release publication must run only after a push to main.");
  require(/permissions:\s*\n\s+contents:\s*read/.test(
    source,
  ), "Workflow-wide token permission must default to contents: read.");
  require(/contents:\s*read/.test(
    job(source, "candidate"),
  ), "Candidate discovery must use read-only repository permission.");
  require(/pull-requests:\s*read/.test(
    job(source, "candidate"),
  ), "Candidate discovery must use read-only pull-request permission.");
  require(/contents:\s*read/.test(job(source, "verify")), "Verification must use read-only repository permission.");
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
  require(/PUSH_BASE_SHA:\s*\$\{\{\s*github\.event\.before\s*\}\}/.test(
    job(source, "candidate"),
  ), "Candidate diff base must be the main push's pre-merge SHA.");
  require(/PR_BASE_SHA="\$PUSH_BASE_SHA"/.test(
    job(source, "candidate"),
  ), "Candidate diff must use the main push's pre-merge SHA.");
  require(!/pulls\/\$\{PR_NUMBER\}\/commits/.test(
    job(source, "candidate"),
  ), "Candidate discovery must not derive its diff base from the first PR commit parent.");
  require(/\[infra\]\[chore\] Prepare release/.test(
    job(source, "candidate"),
  ), "Only the dedicated release PR title may trigger publication.");
  require(/verify-release-pr-changes\.mjs --version[\s\S]*--base/.test(
    job(source, "candidate"),
  ), "Candidate discovery must reject non-release changes across the full release PR diff.");
  require(/ref:\s*\$\{\{ github\.sha \}\}/.test(
    job(source, "verify"),
  ), "Release verification must check out the exact triggering source SHA.");
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
  require(/git tag -a/.test(job(source, "publish")), "Publication must create an annotated tag.");
  require(/git push origin "refs\/tags\/\$\{TAG\}"/.test(
    job(source, "publish"),
  ), "Publication must push only the candidate release tag.");
  require(/EXISTING_SHA.*SOURCE_SHA/.test(
    job(source, "publish"),
  ), "Existing tags must be verified against the exact tested commit.");
  require(/gh release create/.test(job(source, "publish")), "Successful publication must create a GitHub Release.");
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
