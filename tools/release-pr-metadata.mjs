const startMarker = "<!-- release-pr-metadata:start -->";
const endMarker = "<!-- release-pr-metadata:end -->";

export function releasePullRequestMetadata({ version, baseSha, sourceSha, appendedSubjects = [] }) {
  const updateNote =
    appendedSubjects.length > 0
      ? `- Newly appended first-parent commits: ${appendedSubjects.length}`
      : "- No new first-parent commit subjects were needed for this update.";
  return [
    startMarker,
    `## Release candidate v${version}`,
    "",
    `- Current main baseline: \`${baseSha}\``,
    `- Candidate branch commit: \`${sourceSha}\``,
    updateNote,
    "- Review and curate the generated changelog before merging.",
    "- Merging this PR runs exact-source release checks and may publish the repository tag, GitHub Release, and versioned Docker images.",
    "- This PR does not deploy API/Web services or authorize operational database migrations.",
    "",
    "### Local checks",
    "",
    "- `pnpm run test:release-process`",
    "- `pnpm run verify:ci-policy`",
    "- `pnpm run verify:version-alignment`",
    "- `pnpm run format:check`",
    "- `pnpm run test:full`",
    endMarker,
  ].join("\n");
}

export function assertReleasePullRequestBodyManaged(body) {
  managedBlockBounds(body);
}

export function updateReleasePullRequestBody(body, metadata) {
  const { startIndex, afterEnd } = managedBlockBounds(body);
  const replacement = releasePullRequestMetadata(metadata);
  return `${body.slice(0, startIndex)}${replacement}${body.slice(afterEnd)}`;
}

function managedBlockBounds(body) {
  const startIndexes = markerIndexes(body, startMarker);
  const endIndexes = markerIndexes(body, endMarker);
  if (startIndexes.length === 0 && endIndexes.length === 0) {
    throw new Error("Release PR description is missing its automation markers; refusing to replace maintainer text.");
  }
  if (startIndexes.length !== 1 || endIndexes.length !== 1 || endIndexes[0] < startIndexes[0]) {
    throw new Error("Release PR description has invalid automation markers; refusing to overwrite its content.");
  }
  return { startIndex: startIndexes[0], afterEnd: endIndexes[0] + endMarker.length };
}

function markerIndexes(source, marker) {
  const indexes = [];
  let offset = source.indexOf(marker);
  while (offset >= 0) {
    indexes.push(offset);
    offset = source.indexOf(marker, offset + marker.length);
  }
  return indexes;
}
