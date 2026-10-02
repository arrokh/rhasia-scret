import { runCompose } from "./docker.mjs";
import { cleanHostEnvironment, safeComposeEnvironment } from "./environment.mjs";
import { DATABASE_NAME, ROOT } from "./settings.mjs";
import { parseProcessUsage } from "./diagnostics.mjs";
import { MAX_CAPACITY_SESSION_POOL_SIZE } from "./settings.mjs";
import { validateProject } from "./validation.mjs";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function resultDirectory(project) {
  const directory = path.join(ROOT, "test-results", "load", validateProject(project));
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  return directory;
}

export function readSanitizedSummary(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const summary = JSON.parse(readFileSync(filePath, "utf8"));
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
    return summary;
  } catch {
    return null;
  }
}

export function machineSummary() {
  return {
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    logicalCpuCount: os.cpus().length,
    memoryBytes: os.totalmem(),
  };
}

export function stackHostSummary(project, state) {
  try {
    const result = spawnSync("docker", ["info", "--format", "{{.OSType}}|{{.Architecture}}|{{.NCPU}}|{{.MemTotal}}"], {
      encoding: "utf8",
      env: safeComposeEnvironment(project, state),
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0) return null;
    const [platform, architecture, cpuCount, memoryBytes] = (result.stdout ?? "").trim().split("|");
    const cpus = Number(cpuCount);
    const memory = Number(memoryBytes);
    if (
      !/^[a-z0-9._-]{1,32}$/.test(platform ?? "") ||
      !/^[A-Za-z0-9._-]{1,32}$/.test(architecture ?? "") ||
      !Number.isSafeInteger(cpus) ||
      cpus < 1 ||
      cpus > 1024 ||
      !Number.isSafeInteger(memory) ||
      memory < 1
    )
      return null;
    return { platform, architecture, logicalCpuCount: cpus, memoryBytes: memory };
  } catch {
    return null;
  }
}

export function captureResourceSnapshots(record, project, state) {
  const capturedAt = new Date().toISOString();
  if (record.dockerSnapshots.length < 1_000)
    record.dockerSnapshots.push({ capturedAt, containers: dockerStats(project, state) });
  if (record.postgresSnapshots.length < 1_000)
    record.postgresSnapshots.push({ capturedAt, activity: postgresSnapshot(project, state) });
}

export function captureK6ProcessSnapshot(record, processId) {
  captureProcessSnapshot(record.k6ProcessSnapshots, processId);
}

export function captureSshTunnelProcessSnapshot(record, processId) {
  captureProcessSnapshot(record.sshTunnelProcessSnapshots, processId);
}

function captureProcessSnapshot(snapshots, processId) {
  if (!Number.isSafeInteger(processId) || processId < 1 || snapshots.length >= 1_000) return;
  try {
    const result = spawnSync("ps", ["-o", "%cpu=,rss=", "-p", String(processId)], {
      encoding: "utf8",
      env: cleanHostEnvironment(),
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0) return;
    const usage = parseProcessUsage(result.stdout ?? "");
    if (!usage) return;
    snapshots.push({ capturedAt: new Date().toISOString(), ...usage });
  } catch {
    return;
  }
}

function dockerStats(project, state) {
  try {
    const ids = runCompose(project, state, ["ps", "-q"], { capture: true }).split(/\r?\n/).filter(Boolean);
    if (ids.length === 0) return [];
    const result = spawnSync(
      "docker",
      ["stats", "--no-stream", "--format", "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}", ...ids],
      {
        encoding: "utf8",
        env: safeComposeEnvironment(project, state),
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    if (result.status !== 0) return [];
    return (result.stdout ?? "")
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const [name, cpuPercent, memoryUsage, memoryPercent] = line.split("|");
        if (!name?.startsWith(`${project}-`) || !/^\d+(?:\.\d+)?%$/.test(cpuPercent ?? "")) return null;
        const service = name.slice(project.length + 1).replace(/-\d+$/, "");
        if (!/^[a-z-]+$/.test(service) || !/^\d+(?:\.\d+)?%$/.test(memoryPercent ?? "")) return null;
        if (!/^\d+(?:\.\d+)?\s*[A-Za-z]+\s*\/\s*\d+(?:\.\d+)?\s*[A-Za-z]+$/.test(memoryUsage ?? "")) return null;
        return { service, cpuPercent, memoryUsage, memoryPercent };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function postgresSnapshot(project, state) {
  try {
    const query =
      "SELECT coalesce(state, 'unknown') || ':' || count(*) FROM pg_stat_activity WHERE datname = current_database() GROUP BY state ORDER BY state";
    const output = runCompose(
      project,
      state,
      [
        "exec",
        "--no-TTY",
        "db",
        "psql",
        "--no-psqlrc",
        "--tuples-only",
        "--no-align",
        "-U",
        "loadtest",
        "-d",
        DATABASE_NAME,
        "-c",
        query,
      ],
      { capture: true },
    );
    return output.split(/\r?\n/).filter((line) => /^(?:active|idle|idle in transaction|unknown):\d+$/.test(line));
  } catch {
    return [];
  }
}

export function aggregateRateLimitMetrics(project, state) {
  try {
    const logs = runCompose(project, state, ["logs", "--no-color", "--since", "15m", "api"], { capture: true });
    const totals = {};
    for (const line of logs.split(/\r?\n/)) {
      const start = line.indexOf("{");
      if (start < 0 || !line.includes('"event":"application_rate_limit_metrics"')) continue;
      try {
        const event = JSON.parse(line.slice(start));
        if (event.event !== "application_rate_limit_metrics" || !event.counts || typeof event.counts !== "object")
          continue;
        for (const [key, count] of Object.entries(event.counts)) {
          if (!/^[a-z_]+:(?:allowed|limited|unavailable)$/.test(key) || !Number.isSafeInteger(count) || count < 0)
            continue;
          totals[key] = Math.min((totals[key] ?? 0) + count, 2_147_483_647);
        }
      } catch {
        continue;
      }
    }
    return totals;
  } catch {
    return {};
  }
}

export function scenarioProfile(configured, options = {}) {
  if (configured.scenario === "capacity") {
    const sessionPoolSize = Math.min(configured.maxVus, MAX_CAPACITY_SESSION_POOL_SIZE);
    return {
      maxVus: configured.maxVus,
      duration: configured.duration,
      browserVus: 0,
      sessionPoolSize,
      sessionsSharedAcrossVus: configured.maxVus > sessionPoolSize,
    };
  }
  if (configured.scenario === "returning-personal") return { ...defaultProfile(), browserVus: 1 };
  if (configured.scenario === "shared-vault") return { ...defaultProfile(), browserPreparationMembers: 10 };
  if (configured.scenario === "account-mutations")
    return {
      iterationsPerSecond: 1,
      duration: "2m",
      maxVus: 10,
      distinctUsers: 10,
      mutationRequestsPerIteration: 2,
    };
  if (configured.scenario === "shared-account-mutations")
    return { iterationsPerSecond: 1, duration: "2m", maxVus: 1, distinctUsersAndSharedVaults: 10 };
  if (configured.scenario === "rate-limits") {
    const expectedLimit = options.boundary === "email" ? 5 : options.boundary === "network" ? 20 : null;
    return {
      boundary: options.boundary,
      expectedLimit,
      vus: 1,
      authenticatedPolicies: options.boundary === "authenticated" ? [10, 120, 30, 30] : [],
    };
  }
  return { vus: 1, iterations: 1 };
}

export function defaultProfile() {
  return {
    rampBetweenStages: "10s",
    stages: [
      { targetVus: 1, hold: "2m" },
      { targetVus: 5, hold: "2m" },
      { targetVus: 10, hold: "2m" },
    ],
  };
}

function markdownCell(value) {
  return String(value ?? "—")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("`", "\\`")
    .replaceAll(/\r?\n/g, " ")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function metricValue(summary, name, key) {
  const metric = summary?.metrics?.[name];
  const value = metric?.values?.[key] ?? metric?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatMetric(value, digits = 2) {
  if (value === null) return "not available";
  return Number(value.toFixed(digits)).toString();
}

function formatPercent(value) {
  return value === null ? "not available" : `${formatMetric(value * 100)}%`;
}

function percentageNumber(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?%$/.test(value)) return null;
  const parsed = Number(value.slice(0, -1));
  return Number.isFinite(parsed) ? parsed : null;
}

function containerResourcePeaks(record) {
  const peaks = new Map();
  for (const snapshot of Array.isArray(record.dockerSnapshots) ? record.dockerSnapshots : []) {
    for (const container of Array.isArray(snapshot?.containers) ? snapshot.containers : []) {
      if (typeof container?.service !== "string" || !/^[a-z-]{1,32}$/.test(container.service)) continue;
      const cpu = percentageNumber(container.cpuPercent);
      const memoryPercent = percentageNumber(container.memoryPercent);
      if (cpu === null || memoryPercent === null) continue;
      const memoryUsage =
        typeof container.memoryUsage === "string" &&
        /^\d+(?:\.\d+)?\s*[A-Za-z]+\s*\/\s*\d+(?:\.\d+)?\s*[A-Za-z]+$/.test(container.memoryUsage)
          ? container.memoryUsage
          : "not available";
      const existing = peaks.get(container.service) ?? {
        cpu,
        memoryPercent,
        memoryUsage,
        samples: 0,
      };
      existing.samples += 1;
      if (cpu > existing.cpu) existing.cpu = cpu;
      if (memoryPercent > existing.memoryPercent) {
        existing.memoryPercent = memoryPercent;
        existing.memoryUsage = memoryUsage;
      }
      peaks.set(container.service, existing);
    }
  }
  return peaks;
}

function processPeaks(snapshots) {
  let cpuPercent = null;
  let residentMemoryBytes = null;
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    if (typeof snapshot?.cpuPercent === "number" && Number.isFinite(snapshot.cpuPercent))
      cpuPercent = Math.max(cpuPercent ?? 0, snapshot.cpuPercent);
    if (typeof snapshot?.residentMemoryBytes === "number" && Number.isSafeInteger(snapshot.residentMemoryBytes))
      residentMemoryBytes = Math.max(residentMemoryBytes ?? 0, snapshot.residentMemoryBytes);
  }
  return { cpuPercent, residentMemoryBytes };
}

function formatLocalTimestamp(value) {
  if (typeof value !== "string") return "not recorded";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "not recorded";
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const options = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
    ...(timeZone ? { timeZone } : {}),
  };
  const formatted = new Intl.DateTimeFormat("en-US", options).format(date);
  return timeZone ? `${formatted} (${timeZone})` : `${formatted} (local time)`;
}

function formatProfileValue(key, value) {
  if (key !== "stages" || !Array.isArray(value)) return markdownCell(value);
  const stages = value
    .filter(
      (stage) =>
        stage &&
        Number.isSafeInteger(stage.targetVus) &&
        stage.targetVus > 0 &&
        typeof stage.hold === "string" &&
        /^\d+(?:s|m)$/.test(stage.hold),
    )
    .map((stage) => `${stage.targetVus} VU${stage.targetVus === 1 ? "" : "s"} for ${stage.hold}`);
  return stages.length > 0 ? stages.join(" → ") : "not recorded";
}

export function renderMarkdownSummary(record, summary) {
  const metrics = [
    ["Requests", metricValue(summary, "http_reqs", "count")],
    ["HTTP requests/s (RPS)", metricValue(summary, "http_reqs", "rate")],
    ["HTTP failure rate", metricValue(summary, "http_req_failed", "rate")],
    ["HTTP failures", metricValue(summary, "http_req_failed", "passes")],
    ["Checks passed", metricValue(summary, "checks", "passes")],
    ["Checks failed", metricValue(summary, "checks", "fails")],
    ["p95 latency (ms)", metricValue(summary, "http_req_duration", "p(95)")],
    ["p99 latency (ms)", metricValue(summary, "http_req_duration", "p(99)")],
  ];
  const checksPassed = metricValue(summary, "checks", "passes");
  const checksFailed = metricValue(summary, "checks", "fails");
  const browserChecksRecorded = checksPassed !== null && checksFailed !== null;
  const status =
    record.k6ExitCode !== 0 || record.stopReason !== "completed" || (checksFailed !== null && checksFailed > 0)
      ? "failed"
      : record.scenario === "browser-smoke" && !browserChecksRecorded
        ? "incomplete"
        : "passed";
  const profile = record.profile ?? {};
  const profileFields = [
    "maxVus",
    "vus",
    "duration",
    "rampBetweenStages",
    "stages",
    "browserVus",
    "sessionPoolSize",
    "sessionsSharedAcrossVus",
    "iterationsPerSecond",
    "distinctUsers",
    "distinctUsersAndSharedVaults",
    "mutationRequestsPerIteration",
    "expectedLimit",
    "browserPreparationMembers",
  ];
  const profileLabels = { maxVus: "Maximum VUs", vus: "VUs", stages: "VU stages" };
  const profileRows = profileFields
    .filter((key) => Object.hasOwn(profile, key))
    .map((key) => `| ${markdownCell(profileLabels[key] ?? key)} | ${formatProfileValue(key, profile[key])} |`);
  const resourceLimits = record.serviceResourceLimits ?? {};
  const resourceRows = [...containerResourcePeaks(record).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([service, peak]) => {
      const cpuLimit = resourceLimits[service]?.cpus ?? "not recorded";
      const memoryLimit = resourceLimits[service]?.memory ?? "not recorded";
      return `| ${markdownCell(service)} | ${formatMetric(peak.cpu)}% | ${markdownCell(peak.memoryUsage)} (${formatMetric(peak.memoryPercent)}%) | ${markdownCell(cpuLimit)} CPU / ${markdownCell(memoryLimit)} | ${peak.samples} |`;
    });
  const migration = record.migrationDockerPeak;
  if (migration && typeof migration === "object") {
    const cpu = percentageNumber(migration.cpuPercent);
    const memory =
      typeof migration.memoryUsage === "string" &&
      /^\d+(?:\.\d+)?\s*[A-Za-z]+\s*\/\s*\d+(?:\.\d+)?\s*[A-Za-z]+$/.test(migration.memoryUsage)
        ? migration.memoryUsage
        : "not available";
    if (cpu !== null || memory !== "not available")
      resourceRows.push(
        `| one-shot migration | ${cpu === null ? "not available" : `${formatMetric(cpu)}%`} | ${markdownCell(memory)} | 1 CPU / ${markdownCell(resourceLimits.migrate?.memory ?? "not recorded")} | ${Number.isSafeInteger(migration.sampleCount) ? migration.sampleCount : "not recorded"} |`,
      );
  }
  const processRows = [
    ["k6", processPeaks(record.k6ProcessSnapshots)],
    ["SSH tunnel", processPeaks(record.sshTunnelProcessSnapshots)],
  ]
    .filter(([, peak]) => peak.cpuPercent !== null || peak.residentMemoryBytes !== null)
    .map(([name, peak]) => {
      const residentMemory =
        peak.residentMemoryBytes === null
          ? "not available"
          : `${formatMetric(peak.residentMemoryBytes / 1_048_576)} MiB`;
      const cpu = peak.cpuPercent === null ? "not available" : `${formatMetric(peak.cpuPercent)}%`;
      return `| ${name} | ${cpu} | ${residentMemory} |`;
    });
  const availableMetrics = metrics.filter(([, value]) => value !== null);
  const hasHttpRequestMetrics = metricValue(summary, "http_reqs", "count") !== null;
  const browserCheckDisclosure = browserChecksRecorded
    ? "browser checks are shown above."
    : "browser check results were not retained by this run.";
  const rateLimitRows = Object.entries(record.applicationRateLimits ?? {})
    .filter(
      ([key, count]) =>
        /^[a-z_]+:(?:allowed|limited|unavailable)$/.test(key) && Number.isSafeInteger(count) && count >= 0,
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `| ${markdownCell(key)} | ${count} |`);
  const lines = [
    `# Load-test summary: ${markdownCell(record.scenario)}`,
    "",
    `- **Result:** ${status}`,
    `- **Project:** ${markdownCell(record.project)}`,
    `- **Resource profile:** ${markdownCell(record.resourceProfile)}`,
    `- **Target:** ${markdownCell(record.target)}`,
    `- **Runner placement:** ${markdownCell(record.runnerPlacement)}`,
    `- **Docker context:** ${markdownCell(record.dockerContext)}`,
    `- **Started (local):** ${markdownCell(formatLocalTimestamp(record.scenarioStartedAt))}`,
    `- **Ended (local):** ${markdownCell(formatLocalTimestamp(record.endedAt))}`,
    `- **Stop reason:** ${markdownCell(record.stopReason)}`,
    `- **k6 exit code:** ${markdownCell(record.k6ExitCode)}`,
    `- **k6 version:** ${markdownCell(record.versions?.k6)}`,
    "",
    "## Workload profile",
    "",
    "| Setting | Value |",
    "| --- | --- |",
    ...(profileRows.length > 0 ? profileRows : ["| workload | details not recorded |"]),
    "",
    "## k6 results",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    ...(availableMetrics.length > 0
      ? availableMetrics.map(
          ([name, value]) =>
            `| ${name} | ${name === "HTTP failure rate" ? formatPercent(value) : formatMetric(value)} |`,
        )
      : [
          record.scenario === "browser-smoke"
            ? "| Browser check metrics | not retained in this run |"
            : "| k6 metrics | not available |",
        ]),
    ...(record.scenario === "browser-smoke" && !hasHttpRequestMetrics
      ? ["", `HTTP RPS and latency metrics are not produced by this browser-only smoke test; ${browserCheckDisclosure}`]
      : []),
    ...(record.scenario === "rate-limits"
      ? [
          "",
          "Expected HTTP 429 boundary responses count as HTTP failures; scenario checks verify the configured policy.",
        ]
      : []),
    "",
    "## Peak container resources",
    "",
    "| Service | CPU peak | Memory peak | Configured limit | Samples |",
    "| --- | ---: | ---: | --- | ---: |",
    ...(resourceRows.length > 0
      ? resourceRows
      : ["| no samples | not available | not available | not available | 0 |"]),
    "",
    "## Load-generator process peaks",
    "",
    "| Process | CPU peak | Resident memory peak |",
    "| --- | ---: | ---: |",
    ...(processRows.length > 0 ? processRows : ["| no samples | not available | not available |"]),
  ];
  if (record.failurePhase || record.failurePhaseDetail) {
    lines.push("", "## Failure diagnostics", "", `- **Phase:** ${markdownCell(record.failurePhase)}`);
    if (record.failurePhaseDetail) lines.push(`- **Detail:** ${markdownCell(record.failurePhaseDetail)}`);
  }
  if (rateLimitRows.length > 0)
    lines.push("", "## Application rate-limit counters", "", "| Counter | Count |", "| --- | ---: |", ...rateLimitRows);
  lines.push(
    "",
    "This is a sanitized run summary; see the paired `.report.json` for bounded execution and resource telemetry.",
    "",
  );
  return lines.join("\n");
}
