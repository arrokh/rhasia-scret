import { chromium } from "playwright";
import {
  clearCapturedMessages,
  createBrowserUser,
  createSecureInvitation,
  createSharedVault,
  redeemSharedVaultInvitation,
  validateBrowserTarget,
} from "./load-test-browser-support.mjs";

const baseUrl = process.env.LOADTEST_TARGET;
const mailpitOrigin = process.env.LOADTEST_MAILPIT_ORIGIN;
const projectId = process.env.LOADTEST_PROJECT_ID;
const scenario = process.env.LOADTEST_SCENARIO;
const suffix = projectId?.slice(-16);
const memberCount = 10;
const sharedVaultName = "Load Test Shared Vault";
const sharedAccountName = "loadtest-shared-account";
const mutationSubjectCount = 10;
let failurePhase = "input_validation";

async function main() {
  validateBrowserTarget(baseUrl, mailpitOrigin, projectId);
  if (!["shared-vault", "shared-account-mutations"].includes(scenario))
    throw new Error("shared-fixture-scenario-invalid");
  failurePhase = "shared_web_health_check";
  const readiness = await fetch(`${baseUrl}/api/v1/health`, {
    headers: { origin: baseUrl },
    signal: AbortSignal.timeout(3_000),
  });
  if (!readiness.ok) throw new Error("run-web-unhealthy");
  failurePhase = "shared_browser_launch";
  const browser = await chromium.launch({ headless: true });
  let owner;
  let invitation = "";
  let output;
  let completed = false;
  try {
    failurePhase = "shared_mailpit_initial_clear";
    await clearCapturedMessages(mailpitOrigin);
    if (scenario === "shared-account-mutations") {
      const subjects = [];
      for (let index = 1; index <= mutationSubjectCount; index += 1) {
        failurePhase = "shared_mutation_owner_session_preparation";
        owner = await createBrowserUser(browser, {
          baseUrl,
          mailpitOrigin,
          email: `shared-mutation-owner-${suffix}-${index}@loadtest.invalid`,
          vaultName: `Load Test Mutation Personal ${index}`,
          accountName: `loadtest-mutation-personal-${index}`,
          onFailurePhase: (phase) => {
            failurePhase = phase;
          },
        });
        let subjectCreated = false;
        try {
          failurePhase = "shared_mutation_vault_creation";
          const sharedVaultId = await createSharedVault(owner.page, {
            vaultName: `Load Test Mutation Shared ${index}`,
            accountName: `loadtest-mutation-shared-${index}`,
            ownerPassphrase: owner.passphrase,
            onFailurePhase: (phase) => {
              failurePhase = phase;
            },
          });
          subjects.push({ cookie: owner.cookie, vaultId: owner.vaultId, sharedVaultId });
          subjectCreated = true;
        } finally {
          if (subjectCreated) failurePhase = "shared_mutation_context_close";
          await owner.context.close();
          owner = undefined;
        }
      }
      failurePhase = "shared_mailpit_final_clear";
      await clearCapturedMessages(mailpitOrigin);
      output = { subjects };
    } else {
      failurePhase = "shared_owner_session_preparation";
      owner = await createBrowserUser(browser, {
        baseUrl,
        mailpitOrigin,
        email: `shared-owner-${suffix}@loadtest.invalid`,
        vaultName: "Load Test Owner Personal Vault",
        accountName: "loadtest-owner-account",
        onFailurePhase: (phase) => {
          failurePhase = phase;
        },
      });
      failurePhase = "shared_owner_vault_creation";
      const sharedVaultId = await createSharedVault(owner.page, {
        vaultName: sharedVaultName,
        accountName: sharedAccountName,
        ownerPassphrase: owner.passphrase,
        onFailurePhase: (phase) => {
          failurePhase = phase;
        },
      });
      const members = [];
      for (let index = 1; index <= memberCount; index += 1) {
        const email = `shared-member-${suffix}-${index}@loadtest.invalid`;
        failurePhase = "shared_member_session_preparation";
        const member = await createBrowserUser(browser, {
          baseUrl,
          mailpitOrigin,
          email,
          vaultName: `Load Test Member Personal ${index}`,
          accountName: `loadtest-member-account-${index}`,
          onFailurePhase: (phase) => {
            failurePhase = phase;
          },
        });
        let memberAdded = false;
        try {
          failurePhase = "shared_invitation_creation";
          invitation = await createSecureInvitation(owner.page, email, (phase) => {
            failurePhase = phase;
          });
          failurePhase = "shared_invitation_redemption";
          await redeemSharedVaultInvitation(member.page, {
            invitation,
            passphrase: member.passphrase,
            sharedVaultId,
            accountName: sharedAccountName,
          });
          invitation = "";
          members.push({ cookie: member.cookie, vaultId: member.vaultId });
          memberAdded = true;
        } finally {
          if (memberAdded) failurePhase = "shared_member_context_close";
          await member.context.close();
        }
      }
      failurePhase = "shared_mailpit_final_clear";
      await clearCapturedMessages(mailpitOrigin);
      output = {
        sharedVaultId,
        owner: { cookie: owner.cookie, vaultId: owner.vaultId },
        members,
      };
    }
    completed = true;
  } finally {
    invitation = "";
    if (completed) failurePhase = "shared_fixture_cleanup";
    await clearCapturedMessages(mailpitOrigin).catch(() => undefined);
    await owner?.context.close();
    await browser.close();
  }
  failurePhase = "shared_fixture_output";
  process.stdout.write(JSON.stringify(output));
}

main().catch(async () => {
  await clearCapturedMessages(mailpitOrigin).catch(() => undefined);
  process.stdout.write(JSON.stringify({ failurePhase }));
  process.exitCode = 1;
});
