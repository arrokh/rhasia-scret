import { browser } from "k6/browser";
import { check } from "k6";
import { openPersonalVaultForSession } from "./browser-support.js";
import { BASE_URL, handleSummary, readSessionPool, SUMMARY_TREND_STATS, SYSTEM_TAGS } from "./common.js";

export const options = {
  systemTags: SYSTEM_TAGS,
  summaryTrendStats: SUMMARY_TREND_STATS,
  scenarios: {
    returningUserBrowserSmoke: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      options: { browser: { type: "chromium" } },
    },
  },
};

export function setup() {
  return readSessionPool();
}

export default async function (data) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await openPersonalVaultForSession(page, data.browserSession, BASE_URL);
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

export { handleSummary };
