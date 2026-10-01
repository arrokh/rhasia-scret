import { copyFileSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { startConfigurationWizard } from "../../../../../tools/self-hosted-configure.mjs";

const repositoryRoot = resolve(process.cwd(), "../..");

test("local setup wizard validates accessibly in both languages and saves without disabled passkey values", async ({
  page,
}) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "rhasia-selfhosted-wizard-"));
  copyFileSync(join(repositoryRoot, ".env.example"), join(temporaryRoot, ".env.example"));
  const wizard = await startConfigurationWizard({
    root: temporaryRoot,
    port: 0,
    commitSha: "abc1234",
    tailscaleOrigin: "https://node.example.test",
  });

  try {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto(wizard.url);
    await expect(page.getByRole("heading", { name: "Konfigurasi self-hosted" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "id");
    await expect(page).toHaveTitle("Konfigurasi self-hosted");
    await page
      .getByRole("button", { name: "Gunakan origin Tailscale yang terdeteksi: https://node.example.test" })
      .click();
    await expect(page.getByLabel("Origin aplikasi kanonis")).toHaveValue("https://node.example.test");
    await expect(page.getByLabel("Autentikasi aplikasi")).toHaveValue("none");
    await expect(page.getByLabel("SMTP password")).toBeDisabled();

    await page.locator("#language").selectOption("en");
    await expect(page.getByRole("heading", { name: "Self-hosted setup" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle("Self-hosted setup");
    await expect(page.locator("#authBackend-description")).toContainText("Funnel is publicly reachable");
    await page.locator("#language").selectOption("id");
    await expect(page.getByRole("heading", { name: "Konfigurasi self-hosted" })).toBeVisible();
    await expect(page.locator("#authBackend-description")).toContainText("Funnel dapat diakses publik");
    await page.locator("#language").selectOption("en");

    await page.getByLabel("Application authentication").selectOption("passwordless");
    await page.getByRole("button", { name: "Save .env" }).click();
    const turnstileSiteKey = page.getByLabel("Turnstile site key (public)");
    const turnstileSecretKey = page.getByLabel("Turnstile secret key");
    await expect(turnstileSiteKey).toHaveAttribute("aria-invalid", "false");
    await expect(turnstileSecretKey).toHaveAttribute("aria-invalid", "false");
    const smtpHost = page.getByLabel("SMTP host");
    await expect(smtpHost).toHaveAttribute("aria-invalid", "true");
    await expect(smtpHost).toHaveAttribute("aria-describedby", "smtpHost-error");
    await expect(page.locator("#smtpHost-error")).toHaveText("This field is required for passwordless authentication.");

    const smtpPassword = page.getByLabel("SMTP password");
    await turnstileSecretKey.fill("synthetic-turnstile-secret");
    await smtpPassword.fill("synthetic-smtp-password");
    await page.getByLabel("Application authentication").selectOption("none");
    await expect(turnstileSecretKey).toHaveValue("");
    await expect(smtpPassword).toHaveValue("");
    await page.getByLabel("Application authentication").selectOption("passwordless");
    await page.getByRole("button", { name: "Save .env" }).click();
    await expect(smtpHost).toHaveAttribute("aria-invalid", "true");

    const darkTextContrast = await page.evaluate(() => {
      const hint = getComputedStyle(document.querySelector("#privacy")!).color;
      const error = getComputedStyle(document.querySelector("#smtpHost-error")!).color;
      const background = getComputedStyle(document.body).backgroundColor;
      const channels = (color: string) =>
        color
          .match(/[\d.]+/gu)
          ?.slice(0, 3)
          .map(Number) ?? [];
      const luminance = (color: string) => {
        const values = channels(color);
        if (values.length !== 3) throw new Error("Expected an opaque RGB color.");
        const linear = values.map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
      };
      const backgroundLuminance = luminance(background);
      const ratio = (foreground: string) => {
        const foregroundLuminance = luminance(foreground);
        return (
          (Math.max(backgroundLuminance, foregroundLuminance) + 0.05) /
          (Math.min(backgroundLuminance, foregroundLuminance) + 0.05)
        );
      };
      return { hint: ratio(hint), error: ratio(error) };
    });
    expect(darkTextContrast.hint).toBeGreaterThanOrEqual(4.5);
    expect(darkTextContrast.error).toBeGreaterThanOrEqual(4.5);

    const passkeyToggle = page.getByLabel("Configure passkey origin");
    await passkeyToggle.check();
    await expect(page.getByLabel("Passkey RP ID (hostname)")).toHaveValue("node.example.test");
    await expect(page.getByLabel("Passkey origin", { exact: true })).toHaveValue("https://node.example.test");
    await passkeyToggle.uncheck();
    await expect(page.locator("#passkeyFields")).toHaveCount(0);

    await page.getByLabel("SMTP host").fill("smtp.example.test");
    await page.getByLabel("SMTP port (465 or 587)").fill("587");
    await page.getByLabel("SMTP username").fill("setup@example.test");
    await smtpPassword.fill("synthetic-smtp-password");
    await page.getByLabel("Sender email address").fill("no-reply@example.test");
    await page.getByLabel("Sender name").fill("Example Test");
    await page.getByRole("button", { name: "Save .env" }).click();

    const savedDialog = page.getByRole("dialog");
    await expect(savedDialog).toBeVisible();
    await expect(savedDialog.getByRole("heading", { name: "Configuration saved" })).toBeVisible();
    await expect(savedDialog).toContainText(
      "Return to the terminal for the next step. If you started pnpm selfhosted:install, installation will continue there automatically.",
    );
    await expect(savedDialog).toContainText("You can close this browser tab.");
    await savedDialog.getByRole("button", { name: "Return to terminal" }).click();
    await expect(savedDialog).not.toBeVisible();
    await expect(page.getByRole("alert")).toHaveText(".env was saved with file mode 0600.");
    expect(wizard.saved).toBe(true);
    expect(statSync(join(temporaryRoot, ".env")).mode & 0o777).toBe(0o600);
  } finally {
    await wizard.close();
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
