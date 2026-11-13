#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const repository = "arrokh/rhasia-scret";
const pullRequest = "329";
const expectedBranch = "infra/chore/piwt-20261110-200730";
const projectName = "api-rhasia-scret";
const scope = "noor-octavian-anwars-projects";
const vercelStatusContext = "Vercel – api-rhasia-scret";

try {
  await verifyCurrentHeadPreview();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown verification failure";
  process.stderr.write(`API Preview verification failed: ${message}\n`);
  process.exitCode = 1;
}

async function verifyCurrentHeadPreview() {
  const sha = run("git", ["rev-parse", "HEAD"]).trim();
  const branch = run("git", ["branch", "--show-current"]).trim();
  if (branch !== expectedBranch) throw new Error("checkout is not the authorized task branch.");
  if (run("git", ["status", "--porcelain=v1"]).trim()) throw new Error("worktree must be clean.");

  const pr = parseJson(run("gh", ["pr", "view", pullRequest, "--json", "headRefName,headRefOid,isDraft,state"]));
  if (pr.state !== "OPEN" || pr.isDraft !== false) throw new Error("PR must be open and ready for review.");
  if (pr.headRefName !== expectedBranch || pr.headRefOid !== sha)
    throw new Error("PR head does not match the clean local HEAD.");

  const commitStatus = parseJson(run("gh", ["api", `repos/${repository}/commits/${sha}/status`]));
  if (commitStatus.sha !== sha || !Array.isArray(commitStatus.statuses))
    throw new Error("GitHub commit status query did not match the current HEAD.");
  const latestVercelStatus = commitStatus.statuses
    .filter((status) => status.context === vercelStatusContext)
    .toSorted((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0];
  if (latestVercelStatus?.state !== "success" || latestVercelStatus.description !== "Deployment has completed")
    throw new Error("the exact-HEAD Vercel status is not a completed deployment.");

  const dashboard = new URL(latestVercelStatus.target_url);
  const dashboardSegments = dashboard.pathname.split("/").filter(Boolean);
  if (
    dashboard.origin !== "https://vercel.com" ||
    dashboard.username ||
    dashboard.password ||
    dashboard.search ||
    dashboard.hash ||
    dashboardSegments.length !== 3 ||
    dashboardSegments[1] !== projectName
  ) {
    throw new Error("Vercel status did not link to the existing API project.");
  }
  const deploymentSuffix = dashboardSegments[2];
  if (!/^[A-Za-z0-9]+$/.test(deploymentSuffix)) throw new Error("Vercel deployment link has an unexpected identifier.");
  const vercelDeploymentId = `dpl_${deploymentSuffix}`;

  const vercelDeployment = parseJson(
    run("npx", ["--yes", "vercel@65.15.0", "api", `/v13/deployments/${vercelDeploymentId}`, "--scope", scope, "--raw"]),
  );
  const existingProject = parseJson(
    run("npx", ["--yes", "vercel@65.15.0", "project", "inspect", projectName, "--scope", scope, "--json"]),
  );
  if (
    existingProject.name !== projectName ||
    vercelDeployment.id !== vercelDeploymentId ||
    vercelDeployment.name !== projectName ||
    vercelDeployment.projectId !== existingProject.id ||
    vercelDeployment.source !== "git"
  ) {
    throw new Error("Vercel deployment is not in the existing API project or was not built from Git.");
  }
  if (
    vercelDeployment.gitSource?.type !== "github" ||
    vercelDeployment.gitSource?.ref !== expectedBranch ||
    vercelDeployment.gitSource?.sha !== sha
  ) {
    throw new Error("Vercel Git source does not match the current branch and HEAD.");
  }

  const preview = new URL(`https://${vercelDeployment.url}/`);
  if (
    preview.protocol !== "https:" ||
    !preview.hostname.startsWith(`${projectName}-`) ||
    !preview.hostname.endsWith(".vercel.app") ||
    preview.pathname !== "/" ||
    preview.search ||
    preview.hash ||
    vercelDeployment.readyState !== "READY"
  ) {
    throw new Error("Vercel deployment is not a READY isolated API Preview.");
  }
  const inspected = parseJson(
    run("npx", ["--yes", "vercel@65.15.0", "inspect", preview.origin, "--scope", scope, "--json"]),
  );
  const deploymentInfo = inspected.deployment ?? inspected;
  if (deploymentInfo.target !== "preview" || deploymentInfo.readyState !== "READY")
    throw new Error("Vercel CLI did not confirm a READY Preview target.");

  const tokenResponse = parseJson(
    run("npx", ["--yes", "vercel@65.15.0", "project", "token", projectName, "--scope", scope, "--json"]),
  );
  if (typeof tokenResponse.token !== "string" || tokenResponse.token.length === 0)
    throw new Error("Vercel CLI did not return a development OIDC token.");

  const health = await requestJson(preview, "/v1/health", tokenResponse.token);
  if (health.status !== 200 || health.body?.status !== "ok")
    throw new Error(`GET /v1/health returned HTTP ${health.status}.`);
  const time = await requestJson(preview, "/v1/time", tokenResponse.token);
  if (time.status !== 200 || typeof time.body?.now !== "string" || Number.isNaN(Date.parse(time.body.now)))
    throw new Error(`GET /v1/time returned HTTP ${time.status} or an invalid timestamp.`);

  process.stdout.write(
    `${JSON.stringify({
      valid: true,
      branch,
      headSha: sha,
      githubStatus: {
        context: latestVercelStatus.context,
        state: latestVercelStatus.state,
        description: latestVercelStatus.description,
      },
      vercelDeploymentId,
      vercelDeploymentState: deploymentInfo.readyState,
      vercelTarget: deploymentInfo.target,
      gitSource: {
        type: vercelDeployment.gitSource.type,
        ref: vercelDeployment.gitSource.ref,
        sha: vercelDeployment.gitSource.sha,
      },
      smoke: {
        health: { status: health.status, bodyStatus: health.body.status },
        time: { status: time.status, timestampValid: true },
      },
    })}\n`,
  );
}

function run(command, arguments_) {
  try {
    return execFileSync(command, arguments_, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch {
    throw new Error(`${command} command failed.`);
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("a verification command returned invalid JSON.");
  }
}

async function requestJson(origin, path, token) {
  let response;
  try {
    response = await fetch(new URL(path, origin), {
      headers: {
        accept: "application/json",
        "x-vercel-trusted-oidc-idp-token": token,
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error(`GET ${path} could not reach the verified Preview.`);
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Report only the bounded status/path below; never echo a response body.
  }
  return { status: response.status, body };
}
