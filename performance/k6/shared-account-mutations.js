import http from "k6/http";
import { check } from "k6";
import {
  encodedSyntheticAccountPayload,
  handleSummary,
  normalThresholds,
  readSharedMutationFixtures,
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
    permittedSharedAccountMutation: {
      executor: "constant-arrival-rate",
      rate: 1,
      timeUnit: "1s",
      duration: "2m",
      preAllocatedVUs: 1,
      maxVUs: 1,
    },
  },
};

export function setup() {
  return readSharedMutationFixtures();
}

export default function (fixtures) {
  const subject = fixtures.subjects[__ITER % fixtures.subjects.length];
  const response = http.post(
    `http://localhost:4000/api/v1/shared-vaults/${encodeURIComponent(subject.sharedVaultId)}/accounts`,
    JSON.stringify({
      encryptedPayload: encodedSyntheticAccountPayload(),
      encryptionVersion: 1,
      expectedKeyVersion: 1,
    }),
    {
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:4000",
        cookie: subject.cookie,
      },
      tags: { name: "shared-account-create" },
    },
  );
  check(response, {
    "permitted Shared Vault account mutation succeeds": (value) => value.status === 201,
    "Shared Vault mutation response is bounded": (value) => value.body.length <= 4_096,
  });
}

export { handleSummary };
