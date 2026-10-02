import http from "k6/http";
import { check } from "k6";
import { handleSummary, normalThresholds, readSharedFixtures, SUMMARY_TREND_STATS, SYSTEM_TAGS } from "./common.js";

export const options = {
  systemTags: SYSTEM_TAGS,
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: {
    ...normalThresholds,
    checks: ["rate==1"],
  },
  scenarios: {
    authorizedSharedVaultReads: {
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
  },
};

export function setup() {
  return readSharedFixtures();
}

export default function (fixtures) {
  const member = fixtures.members[(__VU - 1) % fixtures.members.length];
  const headers = { cookie: member.cookie, origin: "http://localhost:4000" };
  const workspace = http.get("http://localhost:4000/api/v1/sync/workspace-bundle", {
    headers,
    tags: { name: "shared-workspace-bundle" },
  });
  check(workspace, {
    "member workspace request succeeds": (response) => response.status === 200,
    "workspace contains authorized encrypted Shared Vault data": (response) =>
      hasAuthorizedSharedVault(response.body, fixtures.sharedVaultId),
  });
  const sharedVault = http.get(
    `http://localhost:4000/api/v1/shared-vaults/${encodeURIComponent(fixtures.sharedVaultId)}`,
    { headers, tags: { name: "shared-vault-content" } },
  );
  check(sharedVault, {
    "member Shared Vault request succeeds": (response) => response.status === 200,
    "member receives bounded encrypted Shared Vault content": (response) =>
      hasBoundedEncryptedVault(response.body, fixtures.sharedVaultId),
  });
}

function hasAuthorizedSharedVault(body, vaultId) {
  if (typeof body !== "string" || body.length === 0 || body.length > 256_000) return false;
  try {
    const workspace = JSON.parse(body);
    const vault = Array.isArray(workspace.sharedVaults)
      ? workspace.sharedVaults.find((entry) => entry.vaultId === vaultId)
      : undefined;
    return Boolean(vault && hasEncryptedAccountRecords(vault.accounts));
  } catch {
    return false;
  }
}

function hasBoundedEncryptedVault(body, vaultId) {
  if (typeof body !== "string" || body.length === 0 || body.length > 256_000) return false;
  try {
    const vault = JSON.parse(body);
    return vault.vaultId === vaultId && hasEncryptedAccountRecords(vault.accounts);
  } catch {
    return false;
  }
}

function hasEncryptedAccountRecords(accounts) {
  return (
    Array.isArray(accounts) &&
    accounts.length >= 1 &&
    accounts.length <= 100 &&
    accounts.every(
      (account) =>
        account &&
        typeof account.id === "string" &&
        account.encryptionVersion === 1 &&
        Number.isInteger(account.revision) &&
        account.revision >= 1 &&
        typeof account.encryptedPayload === "string" &&
        account.encryptedPayload.length <= 16_384,
    )
  );
}

export { handleSummary };
