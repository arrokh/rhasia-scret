import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expectedImages = [
  {
    image: "docker.io/arrokh/rhasia-scret",
    purpose: "Web/PWA",
    dockerfile: "apps/web/Dockerfile",
    target: "runtime",
  },
  {
    image: "docker.io/arrokh/rhasia-scret-api",
    purpose: "API",
    dockerfile: "apps/api/Dockerfile",
    target: "runtime",
  },
  {
    image: "docker.io/arrokh/rhasia-scret-api-migrate",
    purpose: "One-off API migration",
    dockerfile: "apps/api/Dockerfile.migration",
    target: "migration",
  },
];

const provenanceFields = [
  "image",
  "release-tag",
  "source-commit",
  "version",
  "dockerfile",
  "target",
  "platform",
  "digest",
];

export function createDockerHubImageSummary({ provenanceDirectory, version, releaseTag, sourceSha }) {
  if (!provenanceDirectory) throw new Error("Docker Hub provenance directory is required.");
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version ?? "")) {
    throw new Error("Docker Hub release version must be stable SemVer.");
  }
  if (releaseTag !== `v${version}`) throw new Error("Docker Hub release tag does not match the release version.");
  if (!/^[0-9a-f]{40}$/.test(sourceSha ?? ""))
    throw new Error("Docker Hub source commit must be a full lowercase SHA.");

  const provenanceFiles = findProvenanceFiles(provenanceDirectory);
  if (provenanceFiles.length !== expectedImages.length) {
    throw new Error(`Expected provenance for exactly ${expectedImages.length} Docker Hub images.`);
  }

  const expectedByImage = new Map(expectedImages.map((entry) => [entry.image, entry]));
  const publishedByImage = new Map();
  for (const provenanceFile of provenanceFiles) {
    const record = readProvenance(provenanceFile);
    const expectedImage = expectedByImage.get(record.image);
    if (!expectedImage) throw new Error("Unexpected Docker Hub image in publication provenance.");
    if (publishedByImage.has(record.image)) throw new Error("Duplicate Docker Hub image publication provenance.");
    if (
      record["release-tag"] !== releaseTag ||
      record["source-commit"] !== sourceSha ||
      record.version !== version ||
      record.dockerfile !== expectedImage.dockerfile ||
      record.target !== expectedImage.target ||
      record.platform !== "linux/amd64" ||
      !/^sha256:[0-9a-f]{64}$/.test(record.digest)
    ) {
      throw new Error(`Docker Hub provenance does not match the verified release for ${record.image}.`);
    }
    publishedByImage.set(record.image, { ...expectedImage, digest: record.digest });
  }

  if (publishedByImage.size !== expectedImages.length) {
    throw new Error("Docker Hub publication provenance is missing an expected image.");
  }

  const rows = expectedImages.map(({ image, purpose }) => {
    const publishedImage = publishedByImage.get(image);
    const repository = image.slice("docker.io/".length);
    return `| [${repository}](https://hub.docker.com/r/${repository}) | ${purpose} | \`${releaseTag}\` | \`${publishedImage.digest}\` | \`docker pull ${repository}:${releaseTag}\` |`;
  });

  return [
    `# Docker Hub images for ${releaseTag}`,
    "",
    `Source commit: \`${sourceSha}\` · Platform: \`linux/amd64\``,
    "",
    "| Image | Purpose | Release tag | Digest | Pull command |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

export function writeDockerHubImageSummary({ provenanceDirectory, version, releaseTag, sourceSha, summaryPath }) {
  if (!summaryPath) throw new Error("GitHub Actions step summary path is required.");
  const summary = createDockerHubImageSummary({ provenanceDirectory, version, releaseTag, sourceSha });
  appendFileSync(summaryPath, summary);
}

function findProvenanceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) return findProvenanceFiles(entryPath);
    if (entry.isFile() && entry.name === "image.txt") return [entryPath];
    return [];
  });
}

function readProvenance(filePath) {
  const fields = Object.create(null);
  const lines = readFileSync(filePath, "utf8").replaceAll("\r\n", "\n").trimEnd().split("\n");
  for (const line of lines) {
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("Malformed Docker Hub image provenance record.");
    const key = line.slice(0, separator);
    if (!provenanceFields.includes(key) || Object.hasOwn(fields, key)) {
      throw new Error("Unexpected or duplicate field in Docker Hub image provenance.");
    }
    fields[key] = line.slice(separator + 1);
  }
  if (provenanceFields.some((field) => !Object.hasOwn(fields, field))) {
    throw new Error("Docker Hub image provenance record is incomplete.");
  }
  return fields;
}

function main() {
  try {
    writeDockerHubImageSummary({
      provenanceDirectory: process.env.DOCKERHUB_PROVENANCE_DIR,
      version: process.env.VERSION,
      releaseTag: process.env.RELEASE_TAG,
      sourceSha: process.env.SOURCE_SHA,
      summaryPath: process.env.GITHUB_STEP_SUMMARY,
    });
  } catch (error) {
    console.error(`Docker Hub image overview failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
