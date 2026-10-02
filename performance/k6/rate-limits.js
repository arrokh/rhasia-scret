import { browser } from "k6/browser";
import { check, sleep } from "k6";
import http from "k6/http";
import { Counter } from "k6/metrics";
import {
  BASE_URL,
  PROJECT_ID,
  SUMMARY_TREND_STATS,
  clearCapturedMessages,
  handleSummary,
  mailpitMessageCount,
  SYSTEM_TAGS,
  waitForCapturedActionUrl,
} from "./common.js";

const boundary = __ENV.LOADTEST_BOUNDARY;
const anonymousBoundaryAttempts = new Counter("rate_limit_anonymous_boundary_attempts");
const anonymousBoundaryAdmitted = new Counter("rate_limit_anonymous_boundary_admitted");
const anonymousBoundaryLimited = new Counter("rate_limit_anonymous_boundary_limited");
const policyBoundaryMetrics = {
  key_material_mutation: {
    attempts: new Counter("rate_limit_key_material_mutation_attempts"),
    admitted: new Counter("rate_limit_key_material_mutation_admitted"),
    limited: new Counter("rate_limit_key_material_mutation_limited"),
  },
  account_mutation: {
    attempts: new Counter("rate_limit_account_mutation_attempts"),
    admitted: new Counter("rate_limit_account_mutation_admitted"),
    limited: new Counter("rate_limit_account_mutation_limited"),
  },
  vault_mutation: {
    attempts: new Counter("rate_limit_vault_mutation_attempts"),
    admitted: new Counter("rate_limit_vault_mutation_admitted"),
    limited: new Counter("rate_limit_vault_mutation_limited"),
  },
  membership_mutation: {
    attempts: new Counter("rate_limit_membership_mutation_attempts"),
    admitted: new Counter("rate_limit_membership_mutation_admitted"),
    limited: new Counter("rate_limit_membership_mutation_limited"),
  },
};

export const options = {
  systemTags: SYSTEM_TAGS,
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: { checks: ["rate==1"] },
  scenarios: {
    isolatedRateLimitBoundary: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      options: { browser: { type: "chromium" } },
    },
  },
};

export default async function () {
  if (boundary === "email") {
    await runAnonymousBoundary(5, true);
    return;
  }
  if (boundary === "network") {
    await runAnonymousBoundary(20, false);
    return;
  }
  if (boundary === "authenticated") {
    await runAuthenticatedBoundaries();
    return;
  }
  throw new Error("Unknown rate-limit boundary selection.");
}

async function runAnonymousBoundary(limit, sameEmail) {
  const suffix = PROJECT_ID.slice(-16);
  const emailForAttempt = (attempt) =>
    sameEmail ? `email-boundary-${suffix}@loadtest.invalid` : `network-boundary-${suffix}-${attempt}@loadtest.invalid`;
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  let accepted = 0;
  let limited = 0;
  let attempts = 0;
  try {
    for (let attempt = 1; attempt <= limit + 1; attempt += 1) {
      const expectedStatus = attempt <= limit ? 200 : 429;
      attempts += 1;
      anonymousBoundaryAttempts.add(1);
      const status = await verifyPasswordlessRequest(
        page,
        emailForAttempt(attempt),
        expectedStatus,
        attempt === limit + 1,
      );
      if (status === 200) {
        accepted += 1;
        anonymousBoundaryAdmitted.add(1);
      }
      if (status === 429) {
        limited += 1;
        anonymousBoundaryLimited.add(1);
      }
    }
    check(
      { attempts, accepted, limited },
      {
        "anonymous boundary observes the exact policy counts": ({
          attempts: observedAttempts,
          accepted: observedAccepted,
          limited: observedLimited,
        }) => observedAttempts === limit + 1 && observedAccepted === limit && observedLimited === 1,
      },
    );
  } finally {
    await page.close();
  }
}

async function verifyPasswordlessRequest(page, email, expectedStatus, expectLimited) {
  clearCapturedMessages();
  let turnstileToken = "";
  let requestBody = "";
  try {
    await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
    const submit = page.locator('form:has(#email) button[type="submit"]');
    await waitForEnabled(submit);
    const tokenInput = page.locator('input[name="cf-turnstile-response"]');
    await tokenInput.waitFor({ state: "attached", timeout: 10_000 });
    turnstileToken = await tokenInput.inputValue();
    if (turnstileToken.length === 0 || turnstileToken.length > 8_192)
      throw new Error("A bounded fresh local Turnstile token was not available.");

    requestBody = JSON.stringify({ email, client: "web", returnPath: "/vaults", turnstileToken });
    const response = http.post(`${BASE_URL}/api/v1/auth/magic-link/request`, requestBody, {
      headers: { "content-type": "application/json", origin: BASE_URL },
      tags: { name: "passwordless-rate-limit-probe" },
    });
    requestBody = "";
    const body = response.json();
    check(response.status, {
      [`passwordless request status is ${expectedStatus}`]: (status) => status === expectedStatus,
    });
    if (expectLimited) {
      check(body, {
        "limited passwordless request returns rate_limited": (value) => value?.error === "rate_limited",
      });
      const retryAfter = response.headers["Retry-After"] ?? response.headers["retry-after"] ?? "";
      check(retryAfter, {
        "limited passwordless request includes bounded Retry-After": (value) =>
          /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 900,
      });
    } else {
      check(body, {
        "admitted passwordless request confirms delivery": (value) => value?.sent === true,
      });
    }
    check(mailpitMessageCount(email), {
      [expectLimited ? "limited request sends no email" : "admitted request sends one captured email"]: (count) =>
        count === (expectLimited ? 0 : 1),
    });
    return response.status;
  } finally {
    requestBody = "";
    turnstileToken = "";
    clearCapturedMessages();
  }
}

async function waitForEnabled(locator) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await locator.isEnabled()) return;
    sleep(0.25);
  }
  throw new Error("A fresh local Turnstile widget token was not produced.");
}

async function runAuthenticatedBoundaries() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    const session = await createAuthenticatedBrowserSession(page);
    runAuthenticatedBoundaryRequests(session);
  } finally {
    await page.close();
  }
}

function runAuthenticatedBoundaryRequests(session) {
  verifyPolicyBoundary("key_material_mutation", 10, session.cookie, (attempt) => {
    if (attempt <= 4)
      return {
        method: "PUT",
        url: "http://localhost:4000/api/v1/user-encryption-identity",
        admittedError: "invalid_identity",
      };
    if (attempt <= 7)
      return {
        method: "PATCH",
        url: "http://localhost:4000/api/v1/user-encryption-identity/rotation",
        admittedError: "invalid_identity_rotation",
      };
    return {
      method: "PATCH",
      url: "http://localhost:4000/api/v1/shared-vaults/invalid-vault-id/rotation",
      admittedError: "invalid_rotation",
    };
  });
  verifyPolicyBoundary("account_mutation", 120, session.cookie, (attempt) => ({
    method: "POST",
    url:
      attempt <= 60
        ? "http://localhost:4000/api/v1/vaults/invalid-vault-id/accounts"
        : "http://localhost:4000/api/v1/shared-vaults/invalid-vault-id/accounts",
    admittedError: "invalid_account",
  }));
  verifyPolicyBoundary("vault_mutation", 30, session.cookie, (attempt) => ({
    method: attempt <= 15 ? "POST" : "PATCH",
    url:
      attempt <= 15
        ? "http://localhost:4000/api/v1/shared-vaults"
        : "http://localhost:4000/api/v1/shared-vaults/invalid-vault-id",
    admittedError: attempt <= 15 ? "invalid_vault" : "invalid_vault_name",
  }));
  verifyPolicyBoundary("membership_mutation", 30, session.cookie, (attempt) => {
    if (attempt <= 10)
      return {
        method: "POST",
        url: "http://localhost:4000/api/v1/shared-vaults/invalid-vault-id/share-links",
        admittedError: "invalid_share_link",
      };
    if (attempt <= 20)
      return {
        method: "PATCH",
        url: "http://localhost:4000/api/v1/shared-vaults/invalid-vault-id/member-permissions",
        admittedError: "invalid_member_permissions",
      };
    return {
      method: "PATCH",
      url: "http://localhost:4000/api/v1/shared-vaults/invalid-vault-id/members/invalid-user-id",
      admittedError: "invalid_member_permissions",
    };
  });
}

async function createAuthenticatedBrowserSession(page) {
  const suffix = PROJECT_ID.slice(-16);
  const email = `authenticated-boundary-${suffix}@loadtest.invalid`;
  clearCapturedMessages();
  try {
    await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
    const emailField = page.locator("#email");
    await emailField.waitFor({ state: "visible", timeout: 15_000 });
    await emailField.fill("");
    await emailField.type(email);
    if ((await emailField.inputValue()) !== email) throw new Error("The synthetic boundary email was not retained.");
    const submit = page.locator('form:has(#email) button[type="submit"]');
    await waitForEnabled(submit);
    await emailField.focus();
    await submit.focus();
    if ((await emailField.getAttribute("aria-invalid")) !== "false")
      throw new Error("The synthetic boundary email failed client-side validation.");
    await submit.click();
    await page.locator('form:has(#email) [role="status"]').waitFor({ state: "visible", timeout: 30_000 });
    const actionUrl = waitForCapturedActionUrl(email);
    await page.goto(actionUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#vault-name").waitFor({ state: "visible", timeout: 30_000 });
    const cookies = await page.context().cookies(BASE_URL);
    const cookie = cookies
      .filter(({ name }) =>
        ["rhsia-passwordless-access", "rhsia-passwordless-refresh", "rhsia-passwordless-assertion"].includes(name),
      )
      .map(({ name, value }) => `${name}=${value}`)
      .join("; ");
    check(cookie, { "real passwordless boundary session has cookies": (value) => value.length > 0 });
    return { cookie };
  } finally {
    clearCapturedMessages();
  }
}

function verifyPolicyBoundary(operation, limit, cookie, routeForAttempt) {
  let admitted = 0;
  let limited = 0;
  let retryAfter = "";
  const routes = Array.from({ length: limit + 1 }, (_, index) => routeForAttempt(index + 1));
  const counters = policyBoundaryMetrics[operation];
  for (let offset = 0; offset < routes.length; offset += 10) {
    const batchRoutes = routes.slice(offset, offset + 10);
    const batch = batchRoutes.map((route) => ({
      method: route.method,
      url: route.url,
      body: "{}",
      params: {
        headers: {
          "content-type": "application/json",
          origin: BASE_URL,
          cookie,
        },
        tags: { name: "authenticated-boundary-probe" },
      },
    }));
    const responses = http.batch(batch);
    for (const [index, response] of responses.entries()) {
      counters.attempts.add(1);
      let errorCode = "";
      try {
        errorCode = response.json().error ?? "";
      } catch {
        errorCode = "";
      }
      if (response.status === 400 && errorCode === batchRoutes[index]?.admittedError) {
        admitted += 1;
        counters.admitted.add(1);
      }
      if (response.status === 429 && errorCode === "rate_limited") {
        limited += 1;
        counters.limited.add(1);
        retryAfter = response.headers["Retry-After"] ?? response.headers["retry-after"] ?? "";
      }
      check(
        { status: response.status, error: errorCode, expectedError: batchRoutes[index]?.admittedError },
        {
          [`${operation} probes distinguish validation from rate limiting`]: ({ status, error, expectedError }) =>
            (status === 400 && error === expectedError) || (status === 429 && error === "rate_limited"),
        },
      );
    }
  }
  check(admitted, { [`${operation} admitted count matches policy`]: (count) => count === limit });
  check(limited, { [`${operation} has exactly one limited attempt`]: (count) => count === 1 });
  check(retryAfter, {
    [`${operation} rejection includes bounded Retry-After`]: (value) =>
      /^\d+$/.test(value) && Number(value) > 0 && Number(value) <= 900,
  });
}

export { handleSummary };
