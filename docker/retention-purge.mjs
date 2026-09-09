const secret = process.env.CRON_SECRET?.trim();
const targetUrl = process.env.RETENTION_PURGE_URL ?? "http://web:3000/api/internal/retention-purge";
const requestTimeoutMs = 10_000;

if (!secret || secret.length < 32) {
  console.error("CRON_SECRET must contain at least 32 characters.");
  process.exit(1);
}

function millisecondsUntilNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(3, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

async function runPurge() {
  try {
    const response = await fetch(targetUrl, {
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(requestTimeoutMs),
    });

    if (!response.ok) {
      console.error(`Retention purge request failed with HTTP ${response.status}.`);
      return;
    }

    console.info("Retention purge completed.");
  } catch {
    console.error("Retention purge request failed before receiving a response.");
  }
}

function scheduleNextRun() {
  const delay = millisecondsUntilNextRun();
  setTimeout(async () => {
    await runPurge();
    scheduleNextRun();
  }, delay);
}

console.info("Retention purge scheduler started; next run is at 03:00 UTC.");
scheduleNextRun();
