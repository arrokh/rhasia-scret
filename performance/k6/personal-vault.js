import http from "k6/http";
import { browser } from "k6/browser";
import { check } from "k6";
import { openPersonalVaultForSession } from "./browser-support.js";
import {
  handleSummary as sanitizedSummary,
  normalThresholds,
  readSessionPool,
  SUMMARY_TREND_STATS,
  SYSTEM_TAGS,
} from "./common.js";

const configuredVus = Number(__ENV.LOADTEST_MAX_VUS || "10");
const capacityMode = __ENV.LOADTEST_SCENARIO === "capacity";
const maximumPreparedSessions = 20;

const scenarios = {
  returningPersonalVault: capacityMode
    ? {
        executor: "constant-vus",
        vus: configuredVus,
        duration: __ENV.LOADTEST_DURATION,
        gracefulStop: "10s",
      }
    : {
        executor: "ramping-vus",
        startVUs: 1,
        stages: [
          { duration: "2m", target: 1 },
          { duration: "10s", target: 5 },
          { duration: "2m", target: 5 },
          { duration: "10s", target: 10 },
          { duration: "2m", target: 10 },
        ],
        gracefulRampDown: "10s",
      },
};

if (!capacityMode && __ENV.LOADTEST_SCENARIO === "returning-personal")
  scenarios.returningUserBrowserSmoke = {
    executor: "shared-iterations",
    exec: "returningUserBrowserSmoke",
    startTime: "4m20s",
    vus: 1,
    iterations: 1,
    options: { browser: { type: "chromium" } },
  };

export const options = {
  systemTags: SYSTEM_TAGS,
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: {
    ...normalThresholds,
    checks: ["rate==1"],
  },
  scenarios,
};

export function setup() {
  const pool = readSessionPool();
  const requiredSessions = Math.min(configuredVus, maximumPreparedSessions);
  if (pool.sessions.length < requiredSessions)
    throw new Error("The returning-user session pool is smaller than the bounded session requirement.");
  return pool;
}

export default function (data) {
  const session = data.sessions[(__VU - 1) % data.sessions.length];
  const headers = {
    cookie: session.cookie,
    origin: "http://localhost:4000",
  };
  const workspace = http.get("http://localhost:4000/api/v1/sync/workspace-bundle", {
    headers,
    tags: { name: "workspace-bundle" },
  });
  check(workspace, {
    "workspace request succeeds": (response) => response.status === 200,
    "workspace response is bounded JSON": (response) => isBoundedObject(response.body, 256_000),
  });

  const accounts = http.get(`http://localhost:4000/api/v1/vaults/${encodeURIComponent(session.vaultId)}/accounts`, {
    headers,
    tags: { name: "personal-account-list" },
  });
  check(accounts, {
    "account request succeeds": (response) => response.status === 200,
    "account response has bounded encrypted records": (response) => hasBoundedAccounts(response.body),
  });
}

export async function returningUserBrowserSmoke(data) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await openPersonalVaultForSession(page, data.browserSession, "http://localhost:4000");
    const otp = page.locator('output[aria-label="OTP saat ini"]');
    await otp.waitFor({ state: "visible" });
    const rendered = await otp.textContent();
    check(rendered, {
      "returning Personal Vault unlocks in browser": (value) => typeof value === "string",
      "client-generated OTP has bounded display shape": (value) => /^\s*\d{3}\s+\d{3}\s*$/.test(value ?? ""),
    });
  } finally {
    await page.close();
  }
}

function isBoundedObject(body, maximumBytes) {
  if (typeof body !== "string" || body.length === 0 || body.length > maximumBytes) return false;
  try {
    const value = JSON.parse(body);
    return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length <= 20;
  } catch {
    return false;
  }
}

function hasBoundedAccounts(body) {
  if (typeof body !== "string" || body.length === 0 || body.length > 256_000) return false;
  try {
    const accounts = JSON.parse(body);
    return (
      Array.isArray(accounts) &&
      accounts.length >= 1 &&
      accounts.length <= 100 &&
      accounts.every(
        (account) =>
          account !== null &&
          typeof account === "object" &&
          typeof account.id === "string" &&
          Number.isInteger(account.revision) &&
          account.revision >= 1 &&
          account.encryptionVersion === 1 &&
          typeof account.encryptedPayload === "string" &&
          account.encryptedPayload.length <= 16_384,
      )
    );
  } catch {
    return false;
  }
}

export { sanitizedSummary as handleSummary };
