import { sleep } from "k6";

export async function selectCustomPassphrase(page) {
  const choice = page.locator("#custom-secret");
  const deadline = Date.now() + 15_000;
  while ((await choice.getAttribute("aria-checked")) !== "true" && Date.now() < deadline) {
    await choice.click({ timeout: 2_000 });
    sleep(0.1);
  }
  if ((await choice.getAttribute("aria-checked")) !== "true")
    throw new Error("The custom passphrase choice did not become available.");
}

export async function unlockPersonalVault(page, passphrase) {
  const input = page.locator("#vault-unlock-secret");
  await input.waitFor({ state: "visible", timeout: 30_000 });
  const revealPassphrase = page.locator("#vault-unlock-secret + button");
  const hydrationDeadline = Date.now() + 30_000;
  while ((await input.getAttribute("type")) !== "text" && Date.now() < hydrationDeadline) {
    await revealPassphrase.click({ timeout: 2_000 });
    sleep(0.1);
  }
  if ((await input.getAttribute("type")) !== "text") throw new Error("The vault unlock form did not hydrate.");
  await revealPassphrase.click();
  await input.fill("");
  await input.focus();
  await page.keyboard.type(passphrase);
  if ((await input.inputValue()) !== passphrase) throw new Error("The vault passphrase input is not ready.");
  await page.locator('form:has(#vault-unlock-secret) button[type="submit"]').click();
  await page.locator("#account-list-heading").waitFor({ state: "visible", timeout: 60_000 });
}

export async function openPersonalVaultForSession(page, session, baseUrl) {
  const cookies = session.cookie.split("; ").map((part) => {
    const separator = part.indexOf("=");
    if (separator < 1) throw new Error("The in-memory browser session cookie was invalid.");
    return {
      name: part.slice(0, separator),
      value: part.slice(separator + 1),
      url: baseUrl,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    };
  });
  await page.context().addCookies(cookies);
  await page.goto(`${baseUrl}/vaults`, { waitUntil: "domcontentloaded" });
  await page.locator("#vault-unlock-secret").waitFor({ state: "visible" });
  await unlockPersonalVault(page, session.passphrase);
}
