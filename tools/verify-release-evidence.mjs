import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidSemVer } from "./release-version.mjs";
import { verifyReleaseWorkflowPolicy } from "./verify-release-workflow-policy.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const validDecisions = ["HOLD", "READY FOR HUMAN RELEASE REVIEW"];

const requiredFiles = [
  ".github/workflows/ci.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/dependency-review.yml",
  ".github/workflows/release-evidence.yml",
  ".github/workflows/release.yml",
  ".github/workflows/secret-scan.yml",
  ".github/dependabot.yml",
  "SECURITY.md",
  "docs/adr/0004-honest-but-curious-server-threat-model.md",
  "docs/release-process.md",
  "docs/security/dependency-audit-exceptions.md",
  "package.json",
  "pnpm-lock.yaml",
];

export function currentReadinessRecord(version) {
  if (!isValidSemVer(version)) throw new Error(`Invalid SemVer release version: ${String(version)}.`);
  return `docs/release-readiness/v${version}.md`;
}

export function parseReadinessRecord(source, recordPath) {
  const failures = [];
  const sections = [
    "## Decision",
    "## Issue and PR ledger",
    "## Repository evidence captured",
    "## External evidence",
    "## Required exit conditions",
  ];
  for (const heading of sections) {
    if (!source.includes(heading)) failures.push(`${recordPath} is missing the ${heading} section.`);
  }

  const decisionSection = section(source, "## Decision");
  const decision = decisionSection.match(/\*\*(HOLD|READY FOR HUMAN RELEASE REVIEW)\b/i)?.[1]?.toUpperCase();
  if (!decision || !validDecisions.includes(decision)) {
    failures.push(`${recordPath} must declare HOLD or READY FOR HUMAN RELEASE REVIEW in its Decision section.`);
  }

  const candidateVersion = source.match(/^Candidate version:\s*`([^`]+)`\s*$/m)?.[1];
  if (!candidateVersion || !isValidSemVer(candidateVersion)) {
    failures.push(`${recordPath} must contain a valid Candidate version.`);
  }
  if (!/^Repository baseline reviewed:\s*`[0-9a-f]{7,40}`(?:\s+.*)?$/m.test(source)) {
    failures.push(`${recordPath} must contain a reviewed repository commit.`);
  }
  if (!/^Evidence captured:\s*.+$/m.test(source)) {
    failures.push(`${recordPath} must contain an Evidence captured timestamp.`);
  }
  if (!/^Evidence owner:\s*.+$/m.test(source)) {
    failures.push(`${recordPath} must contain an Evidence owner.`);
  }
  if (!/\bNot Verifiable\b/.test(source) && decision === "HOLD") {
    failures.push(
      `${recordPath} must identify unavailable external evidence as Not Verifiable when the decision is HOLD.`,
    );
  }

  return { valid: failures.length === 0, failures, decision, candidateVersion };
}

export function verifyCandidateReadiness({ source, recordPath, expectedVersion, requireReady = false }) {
  const result = parseReadinessRecord(source, recordPath);
  const failures = [...result.failures];
  if (result.candidateVersion && result.candidateVersion !== expectedVersion) {
    failures.push(
      `${recordPath} Candidate version ${result.candidateVersion} does not match root version ${expectedVersion}.`,
    );
  }
  if (requireReady && result.decision !== "READY FOR HUMAN RELEASE REVIEW") {
    failures.push(`${recordPath} must say READY FOR HUMAN RELEASE REVIEW before publication.`);
  }
  return { ...result, valid: failures.length === 0, failures };
}

export async function verifyRepositoryPolicy(root = repositoryRoot) {
  const failures = [];
  const contents = new Map();
  for (const relativePath of requiredFiles) {
    const path = resolve(root, relativePath);
    if (!existsSync(path)) {
      failures.push(`${relativePath} is missing.`);
      continue;
    }
    contents.set(relativePath, await readFile(path, "utf8"));
  }

  const secretScan = contents.get(".github/workflows/secret-scan.yml") ?? "";
  if (!/fetch-depth:\s*0/.test(secretScan))
    failures.push("The secret-scan workflow must check out full history with fetch-depth: 0.");
  if (!/gitleaks\/gitleaks-action@[0-9a-f]{40}/.test(secretScan))
    failures.push("The secret scanner must use an immutable action commit.");
  if (!/schedule:\s*\n\s+- cron:/.test(secretScan))
    failures.push("The secret-scan workflow must include scheduled coverage.");

  const releaseWorkflow = contents.get(".github/workflows/release.yml") ?? "";
  const releaseWorkflowPolicy = verifyReleaseWorkflowPolicy(releaseWorkflow);
  failures.push(...releaseWorkflowPolicy.failures.map((failure) => `Release workflow policy: ${failure}`));

  const releaseEvidence = contents.get(".github/workflows/release-evidence.yml") ?? "";
  for (const command of [
    "pnpm install --frozen-lockfile",
    "pnpm run verify:release-evidence",
    "pnpm run verify:version-alignment",
    "pnpm run test:full",
  ]) {
    if (!releaseEvidence.includes(command)) failures.push(`The release-evidence workflow must run ${command}.`);
  }
  if (!/readiness_record/.test(releaseEvidence)) {
    failures.push("The manual release-evidence workflow must require an explicit candidate readiness record.");
  }

  const packageJson = contents.get("package.json") ?? "";
  for (const script of [
    '"verify:release-evidence"',
    '"verify:release-evidence:ready"',
    '"test:release-evidence"',
    '"verify:version-alignment"',
  ]) {
    if (!packageJson.includes(script)) failures.push(`package.json must expose ${script.slice(1, -1)}.`);
  }

  const dependencyExceptions = contents.get("docs/security/dependency-audit-exceptions.md") ?? "";
  if (!/\|\s*Owner\s*\|\s*Review by\s*\|/.test(dependencyExceptions))
    failures.push("Dependency exceptions must include an owner and review date.");

  for (const [relativePath, source] of contents) {
    if (!relativePath.startsWith(".github/workflows/")) continue;
    for (const reference of findUnpinnedActionReferences(source)) {
      failures.push(`${relativePath} uses ${reference} without an immutable commit pin.`);
    }
  }

  return { valid: failures.length === 0, failures };
}

export function findUnpinnedActionReferences(source) {
  return [...source.matchAll(/^\s*(?:-\s*)?uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)]
    .map((match) => match[1])
    .filter((reference) => !/@[0-9a-f]{40}$/.test(reference));
}

function section(source, heading) {
  const start = source.indexOf(heading);
  if (start < 0) return "";
  const remainder = source.slice(start + heading.length);
  const nextHeading = remainder.search(/^##\s+/m);
  return nextHeading < 0 ? remainder : remainder.slice(0, nextHeading);
}

function parseArguments(argumentsList) {
  const options = { record: undefined, useCurrent: false, requireReady: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--record") {
      const value = argumentsList[index + 1];
      if (!value) throw new Error("--record requires a path.");
      options.record = value;
      index += 1;
    } else if (argument === "--current") {
      options.useCurrent = true;
    } else if (argument === "--require-ready") {
      options.requireReady = true;
    } else if (argument === "--help") {
      console.log("Usage: node tools/verify-release-evidence.mjs (--record path | --current) [--require-ready]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.useCurrent === Boolean(options.record)) {
    throw new Error("Choose exactly one readiness record with --record path or --current.");
  }
  return options;
}

function validateRecordPath(recordPath) {
  if (typeof recordPath !== "string" || recordPath.length === 0)
    throw new Error("A candidate readiness record is required.");
  if (recordPath.includes("\\")) throw new Error("Candidate readiness record paths must use forward slashes.");
  const absolutePath = resolve(repositoryRoot, recordPath);
  const relativePath = relative(repositoryRoot, absolutePath);
  const readinessDirectory = `docs${sep}release-readiness${sep}`;
  if (!relativePath.startsWith(readinessDirectory) || relativePath.split(sep).includes("..")) {
    throw new Error("Candidate readiness record must be inside docs/release-readiness/.");
  }
  return { absolutePath, relativePath: relativePath.split(sep).join("/") };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const packageJson = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
  const expectedVersion = packageJson.version;
  if (!isValidSemVer(expectedVersion)) throw new Error("Root package.json must define a valid SemVer release version.");
  const chosenRecord = options.useCurrent ? currentReadinessRecord(expectedVersion) : options.record;
  const { absolutePath, relativePath } = validateRecordPath(chosenRecord);
  const recordSource = existsSync(absolutePath) ? await readFile(absolutePath, "utf8") : "";
  const record = verifyCandidateReadiness({
    source: recordSource,
    recordPath: relativePath,
    expectedVersion,
    requireReady: options.requireReady,
  });
  const policy = await verifyRepositoryPolicy();
  const failures = [...record.failures, ...policy.failures];
  const result = {
    valid: failures.length === 0,
    record: relativePath,
    decision: record.decision,
    candidateVersion: record.candidateVersion,
    expectedVersion,
    repositoryPolicy: policy.valid,
    failures,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
