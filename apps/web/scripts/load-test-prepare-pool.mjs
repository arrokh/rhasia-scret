import { chromium } from "playwright";
import { clearCapturedMessages, createBrowserUser, validateBrowserTarget } from "./load-test-browser-support.mjs";

const baseUrl = process.env.LOADTEST_TARGET;
const mailpitOrigin = process.env.LOADTEST_MAILPIT_ORIGIN;
const projectId = process.env.LOADTEST_PROJECT_ID;
const count = Number(process.env.LOADTEST_POOL_COUNT);
let failurePhase = "input_validation";

async function main() {
  validateBrowserTarget(baseUrl, mailpitOrigin, projectId);
  if (!Number.isSafeInteger(count) || count < 1 || count > 20) throw new Error("invalid-pool-size");
  failurePhase = "web_health_check";
  const readiness = await fetch(`${baseUrl}/api/v1/health`, {
    headers: { origin: baseUrl },
    signal: AbortSignal.timeout(3_000),
  });
  if (!readiness.ok) throw new Error("run-web-unhealthy");
  failurePhase = "browser_launch";
  const browser = await chromium.launch({ headless: true });
  let output;
  let completed = false;
  try {
    failurePhase = "mailpit_initial_clear";
    await clearCapturedMessages(mailpitOrigin);
    const sessions = [];
    let browserSession;
    for (let index = 1; index <= count; index += 1) {
      const user = await createBrowserUser(browser, {
        baseUrl,
        mailpitOrigin,
        email: `returning-${projectId.slice(-16)}-${index}@loadtest.invalid`,
        vaultName: `Load Test Personal ${index}`,
        accountName: `loadtest-account-${index}`,
        onFailurePhase: (phase) => {
          failurePhase = phase;
        },
      });
      sessions.push({ cookie: user.cookie, vaultId: user.vaultId });
      if (index === 1) browserSession = { ...user };
      failurePhase = "session_context_close";
      await user.context.close();
    }
    failurePhase = "mailpit_final_clear";
    await clearCapturedMessages(mailpitOrigin);
    output = {
      sessions,
      browserSession: {
        cookie: browserSession.cookie,
        vaultId: browserSession.vaultId,
        passphrase: browserSession.passphrase,
      },
    };
    completed = true;
  } finally {
    await clearCapturedMessages(mailpitOrigin).catch(() => undefined);
    if (completed) failurePhase = "browser_close";
    await browser.close();
  }
  process.stdout.write(JSON.stringify(output));
}

main().catch(async () => {
  await clearCapturedMessages(mailpitOrigin).catch(() => undefined);
  process.stdout.write(JSON.stringify({ failurePhase }));
  process.exitCode = 1;
});
