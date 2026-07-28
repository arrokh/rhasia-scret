import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { expect, test, type BrowserContext, type Locator, type Page, type Request, type Response } from "@playwright/test";
import { e2eUserAlias } from "./support/e2e-users";

const personalSecret = "performance personal vault passphrase";
const personalName = "Performance Personal Vault";
const sharedName = "Performance Shared Vault";

type InteractionMetric = {
  name: string;
  temperature: "cold" | "warm";
  clickToFeedbackMs: number | null;
  clickToUsableMs: number;
  rscRequests: number;
  prefetchedRscRequests: number;
  serverTimingMs: number[];
  longTaskCount: number;
  longTaskDurationMs: number;
};

type BrowserMetricState = {
  startedAt: number;
  feedbackMs: number | null;
  longTasks: number[];
  mutationObserver: MutationObserver;
  longTaskObserver: PerformanceObserver | null;
};

declare global {
  interface Window {
    __RHSIA_PERFORMANCE_METRIC__?: BrowserMetricState;
  }
}

test("measures protected navigation and interaction performance without recording sensitive values", async ({ page, context, baseURL }) => {
  if (!baseURL) throw new Error("A performance base URL is required.");
  const alias = e2eUserAlias("chromium", "personal");
  await authenticate(context, alias, baseURL);
  await page.goto("/vaults");
  await initializePersonalVault(page);
  await expect(page.getByRole("heading", { name: "Brankas Anda terkunci" })).toBeVisible({ timeout: 60_000 });

  await page.getByRole("textbox", { name: "Passphrase Brankas", exact: true }).fill(personalSecret);
  const unlock = await measureInteraction(page, "unlock", "cold", () => page.getByRole("button", { name: "Buka Brankas" }).click(), page.getByRole("button", { name: "Kunci" }));
  const unlockStages = await page.evaluate(() => Object.fromEntries(
    performance.getEntriesByType("measure")
      .filter((entry) => entry.name.startsWith("rhsia:unlock:"))
      .map((entry) => [entry.name.replace("rhsia:unlock:", ""), Math.round(entry.duration * 100) / 100])
  ));

  const metrics: InteractionMetric[] = [];
  metrics.push(await navigate(page, "accounts-to-directory", "cold", page.getByRole("link", { name: "Brankas", exact: true }), page.getByRole("heading", { name: "Semua brankas" })));
  metrics.push(await navigate(page, "directory-to-personal", "cold", page.getByRole("link", { name: /Brankas Pribadi/ }), page.getByRole("heading", { name: "Kelola Brankas Pribadi" })));
  metrics.push(await navigate(page, "personal-to-directory", "warm", page.getByRole("link", { name: "Kembali ke daftar brankas" }), page.getByRole("heading", { name: "Semua brankas" })));
  metrics.push(await navigate(page, "directory-to-accounts", "warm", page.getByRole("link", { name: "Kembali ke akun autentikator" }), page.getByRole("heading", { name: "Akun autentikator" }).first()));
  metrics.push(await navigate(page, "accounts-to-add", "cold", page.getByRole("link", { name: "Tambahkan akun autentikator" }), page.getByRole("heading", { name: "Tambahkan akun autentikator" })));
  metrics.push(await navigate(page, "add-to-accounts", "warm", page.getByRole("link", { name: "Kembali ke brankas" }), page.getByRole("heading", { name: "Akun autentikator" }).first()));

  await page.getByRole("link", { name: "Brankas", exact: true }).click();
  await page.getByRole("link", { name: "Brankas Bersama" }).click();
  await page.getByLabel("Nama Brankas Bersama").fill(sharedName);
  await page.getByRole("button", { name: "Buat Brankas" }).click();
  await expect(page.getByRole("heading", { name: "Kelola Brankas Bersama" })).toBeVisible();
  await page.getByRole("link", { name: "Kembali ke daftar brankas" }).click();
  await page.getByRole("link", { name: "Kembali ke akun autentikator" }).click();

  metrics.push(await navigate(page, "accounts-to-directory", "warm", page.getByRole("link", { name: "Brankas", exact: true }), page.getByRole("heading", { name: "Semua brankas" })));
  metrics.push(await navigate(page, "directory-to-personal", "warm", page.getByRole("link", { name: /Brankas Pribadi/ }), page.getByRole("heading", { name: "Kelola Brankas Pribadi" })));
  metrics.push(await navigate(page, "personal-to-directory", "warm", page.getByRole("link", { name: "Kembali ke daftar brankas" }), page.getByRole("heading", { name: "Semua brankas" })));
  metrics.push(await navigate(page, "directory-to-shared", "warm", page.getByRole("link", { name: new RegExp(sharedName) }), page.getByRole("heading", { name: "Kelola Brankas Bersama" })));
  metrics.push(await navigate(page, "shared-to-directory", "warm", page.getByRole("link", { name: "Kembali ke daftar brankas" }), page.getByRole("heading", { name: "Semua brankas" })));
  metrics.push(await navigate(page, "directory-to-accounts", "warm", page.getByRole("link", { name: "Kembali ke akun autentikator" }), page.getByRole("heading", { name: "Akun autentikator" }).first()));
  metrics.push(await navigate(page, "accounts-to-add", "warm", page.getByRole("link", { name: "Tambahkan akun autentikator" }), page.getByRole("heading", { name: "Tambahkan akun autentikator" })));
  metrics.push(await navigate(page, "add-to-accounts", "warm", page.getByRole("link", { name: "Kembali ke brankas" }), page.getByRole("heading", { name: "Akun autentikator" }).first()));

  const warm = metrics.filter((metric) => metric.temperature === "warm");
  const report = {
    schemaVersion: 1,
    label: process.env.PERFORMANCE_LABEL ?? "implementation",
    runtime: process.env.PERFORMANCE_RUNTIME ?? "development",
    budgets: { visibleResponseP75Ms: 50, visibleResponseCoverage: 1, warmClickToUsableP75Ms: 300, maximumRscRequests: 1 },
    summary: {
      warmClickToUsableP75Ms: percentile(warm.map((metric) => metric.clickToUsableMs), 0.75),
      clickToFeedbackP75Ms: percentile(metrics.flatMap((metric) => metric.clickToFeedbackMs === null ? [] : [metric.clickToFeedbackMs]), 0.75),
      feedbackCoverage: metrics.filter((metric) => metric.clickToFeedbackMs !== null).length / metrics.length,
      visibleResponseP75Ms: percentile(metrics.map((metric) => metric.clickToFeedbackMs ?? metric.clickToUsableMs), 0.75),
      visibleResponseCoverage: metrics.filter((metric) => (metric.clickToFeedbackMs ?? metric.clickToUsableMs) <= 50).length / metrics.length,
      maximumRscRequests: Math.max(...metrics.map((metric) => metric.rscRequests))
    },
    unlock: { ...unlock, stages: unlockStages },
    interactions: metrics
  };
  const output = resolve(process.env.PERFORMANCE_OUTPUT ?? "artifacts/performance/navigation-current.json");
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);

  expect(report.summary.maximumRscRequests).toBeLessThanOrEqual(1);
  if (process.env.PERFORMANCE_ENFORCE_BUDGETS === "1") {
    expect(report.summary.visibleResponseCoverage).toBe(report.budgets.visibleResponseCoverage);
    expect(report.summary.visibleResponseP75Ms).toBeLessThanOrEqual(report.budgets.visibleResponseP75Ms);
    expect(report.summary.warmClickToUsableP75Ms).toBeLessThanOrEqual(report.budgets.warmClickToUsableP75Ms);
  }
});

async function navigate(page: Page, name: string, temperature: "cold" | "warm", link: Locator, target: Locator): Promise<InteractionMetric> {
  if (temperature === "warm") await page.waitForLoadState("networkidle");
  return measureInteraction(page, name, temperature, () => link.click(), target);
}

async function measureInteraction(page: Page, name: string, temperature: "cold" | "warm", action: () => Promise<void>, target: Locator): Promise<InteractionMetric> {
  let rscRequests = 0;
  let prefetchedRscRequests = 0;
  const serverTimingMs: number[] = [];
  const onRequest = (request: Request) => {
    const headers = request.headers();
    if (request.url().includes("_rsc=") || headers.rsc === "1") {
      if (headers["next-router-prefetch"] === "1" || headers.purpose === "prefetch") prefetchedRscRequests += 1;
      else rscRequests += 1;
    }
  };
  const onResponse = async (response: Response) => {
    const headers = await response.allHeaders();
    const match = /auth_claims;dur=([\d.]+)/.exec(headers["server-timing"] ?? "");
    if (match) serverTimingMs.push(Number(match[1]));
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  await page.evaluate(() => {
    const previous = window.__RHSIA_PERFORMANCE_METRIC__;
    previous?.mutationObserver.disconnect();
    previous?.longTaskObserver?.disconnect();
    const state: BrowserMetricState = { startedAt: performance.now(), feedbackMs: null, longTasks: [], mutationObserver: null as unknown as MutationObserver, longTaskObserver: null };
    state.mutationObserver = new MutationObserver(() => {
      if (state.feedbackMs !== null) return;
      if (document.querySelector('[role="progressbar"], [aria-busy="true"]')) state.feedbackMs = performance.now() - state.startedAt;
    });
    state.mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy"] });
    try {
      state.longTaskObserver = new PerformanceObserver((list) => { state.longTasks.push(...list.getEntries().map((entry) => entry.duration)); });
      state.longTaskObserver.observe({ entryTypes: ["longtask"] });
    } catch { state.longTaskObserver = null; }
    window.__RHSIA_PERFORMANCE_METRIC__ = state;
  });
  try {
    await action();
    await expect(target).toBeVisible();
    return await page.evaluate(({ metricName, metricTemperature, requestCount, prefetchCount, timings }) => {
      const state = window.__RHSIA_PERFORMANCE_METRIC__;
      if (!state) throw new Error("Performance state was not initialized.");
      state.mutationObserver.disconnect();
      state.longTaskObserver?.disconnect();
      return {
        name: metricName,
        temperature: metricTemperature,
        clickToFeedbackMs: state.feedbackMs === null ? null : Math.round(state.feedbackMs * 100) / 100,
        clickToUsableMs: Math.round((performance.now() - state.startedAt) * 100) / 100,
        rscRequests: requestCount,
        prefetchedRscRequests: prefetchCount,
        serverTimingMs: timings,
        longTaskCount: state.longTasks.length,
        longTaskDurationMs: Math.round(state.longTasks.reduce((total, duration) => total + duration, 0) * 100) / 100
      };
    }, { metricName: name, metricTemperature: temperature, requestCount: rscRequests, prefetchCount: prefetchedRscRequests, timings: serverTimingMs });
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }
}

async function authenticate(context: BrowserContext, alias: string, baseURL: string): Promise<void> {
  await context.addCookies([{ name: "rhsia-e2e-session", value: alias, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
}

async function initializePersonalVault(page: Page): Promise<void> {
  await page.getByLabel("Nama Brankas").fill(personalName);
  await page.getByLabel("Buat sendiri").click();
  await page.getByRole("textbox", { name: "Passphrase Brankas Anda" }).fill(personalSecret);
  await page.getByRole("textbox", { name: "Masukkan kembali Passphrase Brankas" }).fill(personalSecret);
  await page.getByLabel(/Saya memahami/).click();
  await page.getByRole("button", { name: "Amankan Brankas Pribadi" }).click();
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)] ?? 0;
}
