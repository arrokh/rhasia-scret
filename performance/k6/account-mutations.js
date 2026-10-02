import http from "k6/http";
import { check } from "k6";
import {
  encodedSyntheticAccountPayload,
  handleSummary,
  jsonRequestOptions,
  normalThresholds,
  readSessionPool,
  SUMMARY_TREND_STATS,
  SYSTEM_TAGS,
} from "./common.js";

export const options = {
  systemTags: SYSTEM_TAGS,
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: {
    ...normalThresholds,
    checks: ["rate==1"],
    dropped_iterations: ["count==0"],
  },
  scenarios: {
    accountMutations: {
      executor: "constant-arrival-rate",
      rate: 1,
      timeUnit: "1s",
      duration: "2m",
      preAllocatedVUs: 10,
      maxVUs: 10,
    },
  },
};

export function setup() {
  return readSessionPool();
}

export default function (data) {
  const session = data.sessions[(__VU - 1 + __ITER) % data.sessions.length];
  const create = http.post(
    `http://localhost:4000/api/v1/vaults/${encodeURIComponent(session.vaultId)}/accounts`,
    JSON.stringify({ encryptedPayload: encodedSyntheticAccountPayload(), encryptionVersion: 1 }),
    jsonRequestOptions({ cookie: session.cookie, tags: { name: "personal-account-create" } }),
  );
  const created = check(create, {
    "account creation is admitted": (response) => response.status === 201,
    "account creation response is bounded": (response) => response.body.length <= 4_096,
  });
  if (!created) return;
  let accountId;
  try {
    const body = JSON.parse(create.body);
    accountId = body.id;
  } catch {
    check(false, { "account creation response is valid JSON": () => false });
    return;
  }
  if (typeof accountId !== "string" || accountId.length === 0 || accountId.length > 128) {
    check(false, { "account identifier is bounded": () => false });
    return;
  }
  const update = http.patch(
    `http://localhost:4000/api/v1/vaults/${encodeURIComponent(session.vaultId)}/accounts`,
    JSON.stringify({
      accountId,
      expectedRevision: 1,
      encryptedPayload: encodedSyntheticAccountPayload(),
      encryptionVersion: 1,
    }),
    jsonRequestOptions({ cookie: session.cookie, tags: { name: "personal-account-update" } }),
  );
  check(update, {
    "account update is admitted": (response) => response.status === 200,
    "account update response is bounded": (response) => response.body.length <= 4_096,
  });
}

export { handleSummary };
