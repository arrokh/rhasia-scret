import { randomBytes } from "node:crypto";

export const SESSION_COOKIE_NAMES = new Set([
  "rhsia-passwordless-access",
  "rhsia-passwordless-refresh",
  "rhsia-passwordless-assertion",
]);
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const INVITATION_SUBMIT_PROBE_KEY = "__rhsiaLoadtestInvitationSubmitProbe";

async function installInvitationSubmitProbe(form) {
  return form
    .first()
    .evaluate((formElement, probeKey) => {
      const probe = { buttonClickObserved: false, enterKeyObserved: false, submitEventObserved: false };
      const onClick = (event) => {
        if (event.target instanceof globalThis.Element && event.target.closest('button[type="submit"]'))
          probe.buttonClickObserved = true;
      };
      const onKeydown = (event) => {
        if (event.key === "Enter") probe.enterKeyObserved = true;
      };
      const onSubmit = () => {
        probe.submitEventObserved = true;
      };
      formElement.addEventListener("click", onClick, true);
      formElement.addEventListener("keydown", onKeydown, true);
      formElement.addEventListener("submit", onSubmit, true);
      probe.cleanup = () => {
        formElement.removeEventListener("click", onClick, true);
        formElement.removeEventListener("keydown", onKeydown, true);
        formElement.removeEventListener("submit", onSubmit, true);
      };
      Object.defineProperty(globalThis, probeKey, { configurable: true, value: probe });
      return true;
    }, INVITATION_SUBMIT_PROBE_KEY)
    .catch(() => false);
}

async function snapshotInvitationSubmitProbe(page) {
  return page
    .evaluate((probeKey) => {
      const probe = globalThis[probeKey];
      if (!probe) return null;
      return {
        buttonClickObserved: probe.buttonClickObserved === true,
        enterKeyObserved: probe.enterKeyObserved === true,
        submitEventObserved: probe.submitEventObserved === true,
      };
    }, INVITATION_SUBMIT_PROBE_KEY)
    .catch(() => null);
}

async function collectInvitationSubmitProbe(page) {
  const probe = await snapshotInvitationSubmitProbe(page);
  await page
    .evaluate((probeKey) => {
      const current = globalThis[probeKey];
      current?.cleanup();
      delete globalThis[probeKey];
    }, INVITATION_SUBMIT_PROBE_KEY)
    .catch(() => undefined);
  return probe;
}

async function requestInvitationFormSubmit(form) {
  return form
    .first()
    .evaluate((formElement) => {
      if (!(formElement instanceof globalThis.HTMLFormElement)) return false;
      const recipient = formElement.querySelector('input[type="email"]');
      const button = formElement.querySelector('button[type="submit"]');
      if (
        !(recipient instanceof globalThis.HTMLInputElement) ||
        !(button instanceof globalThis.HTMLButtonElement) ||
        button.form !== formElement ||
        button.disabled ||
        !recipient.validity.valid ||
        recipient.getAttribute("aria-invalid") === "true"
      )
        return false;
      let submitEventDispatched = false;
      const preventNativeNavigation = (event) => {
        submitEventDispatched = true;
        event.preventDefault();
      };
      formElement.addEventListener("submit", preventNativeNavigation, { capture: true, once: true });
      formElement.requestSubmit(button);
      if (!submitEventDispatched) formElement.removeEventListener("submit", preventNativeNavigation, true);
      return submitEventDispatched;
    })
    .catch(() => false);
}

export function validateBrowserTarget(target, mailpitOrigin, projectId) {
  if (target !== "http://localhost:4000" || mailpitOrigin !== "http://localhost:8025")
    throw new Error("invalid-target");
  if (!/^rhasia-load-[0-9a-f]{12,32}$/.test(projectId)) throw new Error("invalid-project");
}

export function isMagicLinkRequestTarget(method, requestUrl, baseUrl) {
  return isSameOriginPostTarget(method, requestUrl, baseUrl, "/api/v1/auth/magic-link/request");
}

export function isSameOriginAuthPostTarget(method, requestUrl, baseUrl) {
  if (method !== "POST") return false;
  try {
    const url = new URL(requestUrl);
    return url.origin === baseUrl && /^\/api\/v1\/auth\//.test(url.pathname);
  } catch {
    return false;
  }
}

export function isSharedVaultCreationRequestTarget(method, requestUrl, baseUrl) {
  return isSameOriginPostTarget(method, requestUrl, baseUrl, "/api/v1/shared-vaults");
}

export function isSharedVaultManagementDetailsPath(pathname) {
  return /^\/vaults\/manage\/[A-Za-z0-9_-]{16,128}$/.test(pathname);
}

export function isSharedVaultInvitationCreationRequestTarget(method, requestUrl, baseUrl) {
  if (method !== "POST") return false;
  try {
    const url = new URL(requestUrl);
    return (
      url.origin === baseUrl && /^\/api\/v1\/shared-vaults\/[A-Za-z0-9_-]{16,128}\/share-links$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function classifySharedVaultInvitationStatus(status) {
  if (status >= 200 && status < 300) return null;
  if (status === 400 || status === 422) return "shared_invitation_validation_rejected";
  if (status === 401) return "shared_invitation_unauthenticated";
  if (status === 403) return "shared_invitation_forbidden";
  if (status === 404) return "shared_invitation_not_found";
  if (status === 409) return "shared_invitation_conflict";
  if (status === 429) return "shared_invitation_rate_limited";
  if (status >= 500 && status <= 599) return "shared_invitation_server_error";
  return "shared_invitation_unexpected_status";
}

const SHARED_INVITATION_CLICK_FAILURE_PHASES = Object.freeze({
  strict_match: "shared_invitation_submit_multiple_buttons",
  intercepted: "shared_invitation_submit_click_intercepted",
  detached: "shared_invitation_submit_button_detached",
  unstable: "shared_invitation_submit_button_unstable",
  timeout: "shared_invitation_submit_click_timeout",
  other: "shared_invitation_submit_click_failed",
});

export function classifySharedInvitationClickError(error) {
  if (!(error instanceof Error)) return SHARED_INVITATION_CLICK_FAILURE_PHASES.other;
  if (/strict mode violation/i.test(error.message)) return SHARED_INVITATION_CLICK_FAILURE_PHASES.strict_match;
  if (/intercepts pointer events/i.test(error.message)) return SHARED_INVITATION_CLICK_FAILURE_PHASES.intercepted;
  if (/not attached to the DOM|detached from the DOM/i.test(error.message))
    return SHARED_INVITATION_CLICK_FAILURE_PHASES.detached;
  if (/not stable|moving/i.test(error.message)) return SHARED_INVITATION_CLICK_FAILURE_PHASES.unstable;
  if (error.name === "TimeoutError" || /timed out|timeout.*exceeded/i.test(error.message))
    return SHARED_INVITATION_CLICK_FAILURE_PHASES.timeout;
  return SHARED_INVITATION_CLICK_FAILURE_PHASES.other;
}

export function classifySharedInvitationSubmitFailure({
  requestObserved,
  buttonCount,
  buttonVisible,
  buttonDisabled,
  recipientInvalid,
  clickFailure,
  clickSurface,
}) {
  if (requestObserved) return "shared_invitation_submit_request_observed";
  if (recipientInvalid) return "shared_invitation_recipient_rejected";
  if (buttonCount === 0) return "shared_invitation_submit_button_missing";
  if (buttonCount > 1) return SHARED_INVITATION_CLICK_FAILURE_PHASES.strict_match;
  if (!buttonVisible) return "shared_invitation_submit_button_hidden";
  if (buttonDisabled) return "shared_invitation_submit_button_disabled";
  if (clickSurface && !clickSurface.connected) return SHARED_INVITATION_CLICK_FAILURE_PHASES.detached;
  if (clickSurface && !clickSurface.centerInViewport) return "shared_invitation_submit_button_outside_viewport";
  if (clickSurface && !clickSurface.hitTargetMatchesButton) return SHARED_INVITATION_CLICK_FAILURE_PHASES.intercepted;
  return Object.values(SHARED_INVITATION_CLICK_FAILURE_PHASES).includes(clickFailure)
    ? clickFailure
    : SHARED_INVITATION_CLICK_FAILURE_PHASES.other;
}

export function shouldRetrySharedInvitationSubmitWithKeyboard({
  failurePhase,
  requestObserved,
  buttonCount,
  buttonVisible,
  buttonDisabled,
  recipientInvalid,
}) {
  return (
    failurePhase === "shared_invitation_submit_click_intercepted" &&
    !requestObserved &&
    buttonCount === 1 &&
    buttonVisible &&
    !buttonDisabled &&
    !recipientInvalid
  );
}

export function shouldRequestSharedInvitationSubmit({
  requestObserved,
  sameOriginApiPostObserved,
  submitEventObserved,
  formControlsAssociated,
  buttonCount,
  buttonVisible,
  buttonDisabled,
  recipientInvalid,
  recipientNativeValid,
}) {
  return (
    !requestObserved &&
    !sameOriginApiPostObserved &&
    !submitEventObserved &&
    formControlsAssociated &&
    buttonCount === 1 &&
    buttonVisible &&
    !buttonDisabled &&
    !recipientInvalid &&
    recipientNativeValid
  );
}

export function classifySharedInvitationEventOutcome({
  probeAvailable,
  sameOriginApiPostObserved,
  buttonClickObserved,
  keyboardFallbackAttempted,
  enterKeyObserved,
  submitEventObserved,
  requestSubmitFallbackAttempted,
}) {
  if (!probeAvailable) return "shared_invitation_event_probe_unavailable";
  if (sameOriginApiPostObserved) return "shared_invitation_request_target_mismatch";
  if (submitEventObserved) return "shared_invitation_submit_event_no_request";
  if (requestSubmitFallbackAttempted) return "shared_invitation_request_submit_not_observed";
  if (buttonClickObserved) return "shared_invitation_button_click_no_submit";
  if (keyboardFallbackAttempted && enterKeyObserved) return "shared_invitation_enter_without_submit";
  if (keyboardFallbackAttempted) return "shared_invitation_keyboard_event_not_observed";
  return "shared_invitation_activation_not_observed";
}

export function classifySharedVaultCreationStatus(status) {
  if (status >= 200 && status < 300) return null;
  if (status === 400 || status === 422) return "shared_creation_validation_rejected";
  if (status === 401) return "shared_creation_unauthenticated";
  if (status === 403) return "shared_creation_forbidden";
  if (status === 409) return "shared_creation_conflict";
  if (status === 429) return "shared_creation_rate_limited";
  if (status >= 500 && status <= 599) return "shared_creation_server_error";
  return "shared_creation_unexpected_status";
}

const WORKSPACE_UNLOCK_FAILURE_PHASES = Object.freeze({
  authentication_failed: "shared_creation_unlock_authentication_failure",
  crypto_unlock_failed: "shared_creation_unlock_cryptographic_failure",
  invalid_secret: "shared_creation_unlock_passphrase_rejected",
  key_derivation_failed: "shared_creation_unlock_cryptographic_failure",
  local_storage_failed: "shared_creation_unlock_sync_failure",
  personal_vault_key_wrap_failed: "shared_creation_unlock_cryptographic_failure",
  personal_vault_mismatch: "shared_creation_unlock_workspace_failure",
  personal_vault_name_decryption_failed: "shared_creation_unlock_workspace_failure",
  profile_data_invalid: "shared_creation_unlock_profile_failure",
  profile_rewrap_failed: "shared_creation_unlock_profile_failure",
  profile_migration_failed: "shared_creation_unlock_profile_failure",
  root_key_wrap_failed: "shared_creation_unlock_cryptographic_failure",
  remembered_browser_error: "shared_creation_unlock_other_known_failure",
  sync_failed: "shared_creation_unlock_sync_failure",
  passkey_error: "shared_creation_unlock_other_known_failure",
  workspace_bundle_invalid: "shared_creation_unlock_workspace_failure",
  workspace_processing_failed: "shared_creation_unlock_workspace_failure",
  workspace_response_failed: "shared_creation_unlock_sync_failure",
  vault_content_decryption_failed: "shared_creation_unlock_workspace_failure",
  user_encryption_key_recovery_failed: "shared_creation_unlock_identity_failure",
  user_encryption_envelope_invalid: "shared_creation_unlock_identity_failure",
  user_encryption_key_decryption_failed: "shared_creation_unlock_identity_failure",
  user_encryption_legacy_envelope: "shared_creation_unlock_identity_failure",
  user_encryption_private_key_invalid: "shared_creation_unlock_identity_failure",
});

export function classifyWorkspaceUnlockFailureCode(code) {
  return typeof code === "string" && Object.hasOwn(WORKSPACE_UNLOCK_FAILURE_PHASES, code)
    ? WORKSPACE_UNLOCK_FAILURE_PHASES[code]
    : null;
}

export function classifySharedVaultUnlockOutcome({
  passphraseVisible,
  passphraseRejected,
  hasAlert,
  reportedFailurePhase,
  sharedVaultPresence,
}) {
  if (passphraseRejected) return "shared_creation_unlock_input_rejected";
  if (Object.values(WORKSPACE_UNLOCK_FAILURE_PHASES).includes(reportedFailurePhase)) return reportedFailurePhase;
  if (!passphraseVisible && hasAlert) {
    if (sharedVaultPresence === "present") return "shared_creation_unlock_workspace_omitted_vault";
    if (sharedVaultPresence === "missing") return "shared_creation_unlock_membership_missing";
    if (sharedVaultPresence === "unauthenticated") return "shared_creation_unlock_authentication_failure";
    if (sharedVaultPresence === "forbidden") return "shared_creation_unlock_authorization_failure";
    return "shared_creation_unlock_alert_without_input";
  }
  if (!passphraseVisible) return "shared_creation_unlock_tabs_unavailable";
  return hasAlert ? "shared_creation_unlock_alert" : "shared_creation_unlock_timeout";
}

function isSameOriginPostTarget(method, requestUrl, baseUrl, pathname) {
  if (method !== "POST") return false;
  try {
    const url = new URL(requestUrl);
    return url.origin === baseUrl && url.pathname === pathname;
  } catch {
    return false;
  }
}

function observeWorkspaceUnlockFailure(page) {
  let resolveFailurePhase;
  const failurePhase = new Promise((resolve) => {
    resolveFailurePhase = resolve;
  });
  const listener = (message) => {
    if (message.type() !== "warning") return;
    const [label, details] = message.args();
    if (!label || !details) return;
    void Promise.all([label.jsonValue(), details.jsonValue()])
      .then(([eventLabel, payload]) => {
        if (eventLabel !== "[vault-unlock] Unlock failed" || !payload || typeof payload !== "object") return;
        const phase = classifyWorkspaceUnlockFailureCode(payload.failure_code);
        if (phase) resolveFailurePhase(phase);
      })
      .catch(() => undefined);
  };
  page.on("console", listener);
  return { failurePhase, stop: () => page.off("console", listener) };
}

async function observeSharedVaultPresence(page, sharedVaultId) {
  return page
    .evaluate(async (vaultId) => {
      try {
        const response = await fetch("/api/v1/shared-vaults", { credentials: "same-origin" });
        if (response.status === 401) return "unauthenticated";
        if (response.status === 403) return "forbidden";
        if (!response.ok) return "unavailable";
        const vaults = await response.json();
        if (!Array.isArray(vaults)) return "unavailable";
        return vaults.some((vault) => vault && typeof vault === "object" && vault.vaultId === vaultId)
          ? "present"
          : "missing";
      } catch {
        return "unavailable";
      }
    }, sharedVaultId)
    .catch(() => "unavailable");
}

export async function clearCapturedMessages(mailpitOrigin) {
  const response = await fetch(`${mailpitOrigin}/api/v1/messages`, { method: "DELETE" });
  if (!response.ok) throw new Error("local-mailpit-cleanup-failed");
}

export function classifyMagicLinkRequestFailure(status, responseBody) {
  const body = responseBody && typeof responseBody === "object" && !Array.isArray(responseBody) ? responseBody : null;
  const errorCode = body && typeof body.error === "string" ? body.error : null;
  const knownErrors = {
    invalid_request: "request_response_invalid_request",
    turnstile_failed: "request_response_turnstile_failed",
    turnstile_unavailable: "request_response_turnstile_unavailable",
    rate_limit_unavailable: "request_response_rate_limit_unavailable",
    rate_limited: "request_response_rate_limited",
    email_delivery_failed: "request_response_email_delivery_failed",
  };
  if (errorCode && Object.hasOwn(knownErrors, errorCode)) return knownErrors[errorCode];
  if (status === 200) return null;
  if (status === 403) return "request_response_forbidden";
  if (status === 429) return "request_response_rate_limited";
  if (status >= 500) return "request_response_server_error";
  if (status >= 400) return "request_response_rejected";
  return "request_response_unexpected";
}

export async function createBrowserUser(
  browser,
  { baseUrl, mailpitOrigin, email, vaultName, accountName, onFailurePhase = () => {} },
) {
  const passphrase = `Load test ${randomBytes(24).toString("base64url")}`;
  onFailurePhase("browser_context_creation");
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    onFailurePhase("browser_page_creation");
    const page = await context.newPage();
    await signIn(page, { baseUrl, mailpitOrigin, email }, onFailurePhase);
    onFailurePhase("personal_vault_creation");
    await createPersonalVault(page, vaultName, passphrase);
    onFailurePhase("personal_vault_unlock");
    await unlockPersonalVault(page, passphrase);
    onFailurePhase("synthetic_account_creation");
    await createSyntheticAccount(page, accountName);
    onFailurePhase("session_read");
    const session = await readSession(page, context, baseUrl);
    return { context, page, passphrase, ...session };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function requireOk(response) {
  if (!response.ok) throw new Error("local-mailpit-request-failed");
  return response;
}

async function waitForActionUrl(mailpitOrigin, baseUrl, email) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const listResponse = await requireOk(await fetch(`${mailpitOrigin}/api/v1/messages?start=0&limit=50`));
    const list = await listResponse.json();
    const summary = Array.isArray(list.messages)
      ? list.messages.find(
          (message) =>
            Array.isArray(message.To) && message.To.some((recipient) => recipient.Address?.toLowerCase() === email),
        )
      : undefined;
    if (!summary) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    const messageId = summary.ID ?? summary.Id ?? summary.id;
    if (typeof messageId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(messageId))
      throw new Error("local-mailpit-message-invalid");
    const detailResponse = await requireOk(await fetch(`${mailpitOrigin}/api/v1/message/${messageId}`));
    const detail = await detailResponse.json();
    const content = `${detail.Text ?? ""}\n${detail.HTML ?? ""}`.replaceAll("&amp;", "&");
    const match = content.match(/https?:\/\/localhost:4000\/auth\/confirm#[^\s"'<>]+/);
    if (!match) throw new Error("local-mailpit-link-missing");
    const actionUrl = new URL(match[0]);
    if (actionUrl.origin !== baseUrl || actionUrl.pathname !== "/auth/confirm")
      throw new Error("local-mailpit-link-target-invalid");
    if (!new URLSearchParams(actionUrl.hash.slice(1)).get("token")) throw new Error("local-mailpit-link-invalid");
    await clearCapturedMessages(mailpitOrigin);
    return actionUrl.toString();
  }
  throw new Error("local-mailpit-message-timeout");
}

async function waitUntilEnabled(locator) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await locator.isEnabled()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("turnstile-widget-timeout");
}

async function signIn(page, { baseUrl, mailpitOrigin, email }, onFailurePhase) {
  onFailurePhase("sign_in_page_navigation");
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const emailField = page.locator("#email");
  onFailurePhase("email_form_hydration");
  const hydrationDeadline = Date.now() + 15_000;
  let formHydrated = false;
  while (Date.now() < hydrationDeadline) {
    await emailField.fill("invalid");
    await emailField.blur();
    if ((await emailField.getAttribute("aria-invalid")) === "true") {
      formHydrated = true;
      break;
    }
    await page.waitForTimeout(100);
  }
  if (!formHydrated) throw new Error("sign-in-form-not-hydrated");
  onFailurePhase("email_form_fill");
  await emailField.fill(email);
  await emailField.blur();
  await page.waitForFunction(
    () => document.querySelector("#email")?.getAttribute("aria-invalid") === "false",
    undefined,
    { timeout: 10_000 },
  );
  if ((await emailField.inputValue()) !== email) throw new Error("sign-in-email-not-retained");
  const submit = page.getByRole("button", { name: "Lanjutkan dengan email" });
  onFailurePhase("turnstile_ready");
  await waitUntilEnabled(submit);
  let requestObserved = false;
  let sameOriginAuthRequestObserved = false;
  const observeRequest = (request) => {
    if (isSameOriginAuthPostTarget(request.method(), request.url(), baseUrl)) sameOriginAuthRequestObserved = true;
    if (isMagicLinkRequestTarget(request.method(), request.url(), baseUrl)) requestObserved = true;
  };
  page.on("request", observeRequest);
  const requestResponse = page
    .waitForResponse((response) => isMagicLinkRequestTarget(response.request().method(), response.url(), baseUrl), {
      timeout: 20_000,
    })
    .then(
      (response) => ({ response }),
      () => ({ response: null }),
    );
  let response;
  onFailurePhase("magic_link_request_submit");
  try {
    await submit.click();
    onFailurePhase("magic_link_request_response");
    ({ response } = await requestResponse);
  } catch {
    onFailurePhase("magic_link_request_submit");
    throw new Error("magic_link_request_submit_failed");
  } finally {
    page.off("request", observeRequest);
  }
  if (!response) {
    if (requestObserved) {
      onFailurePhase("request_response_timeout");
    } else if (sameOriginAuthRequestObserved) {
      onFailurePhase("request_unexpected_endpoint");
    } else {
      const hasAlert = await page
        .getByRole("alert")
        .first()
        .isVisible()
        .catch(() => false);
      const hasStatus = await page
        .getByRole("status")
        .first()
        .isVisible()
        .catch(() => false);
      const browserIsOnline = await page.evaluate(() => navigator.onLine).catch(() => null);
      onFailurePhase(
        hasAlert
          ? browserIsOnline === false
            ? "request_offline_client_alert"
            : "request_client_alert"
          : hasStatus
            ? "request_client_status"
            : "request_not_dispatched",
      );
    }
    throw new Error("magic_link_request_response_missing");
  }
  if (response.status() !== 200) {
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    onFailurePhase(classifyMagicLinkRequestFailure(response.status(), body));
    throw new Error("magic_link_request_rejected");
  }
  onFailurePhase("request_confirmation");
  await page.getByText(/Periksa kotak masuk/).waitFor({ state: "visible", timeout: 30_000 });
  onFailurePhase("magic_link_email_wait");
  const actionUrl = await waitForActionUrl(mailpitOrigin, baseUrl, email);
  onFailurePhase("magic_link_redemption");
  await page.goto(actionUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  onFailurePhase("personal_vault_setup");
  await page.getByRole("heading", { name: "Siapkan Brankas Pribadi" }).waitFor({ state: "visible", timeout: 30_000 });
}

async function createPersonalVault(page, name, passphrase) {
  await page.getByLabel("Nama Brankas").fill(name);
  const customPassphrase = page.getByRole("radio", { name: "Buat sendiri" });
  const choiceDeadline = Date.now() + 15_000;
  while ((await customPassphrase.getAttribute("aria-checked")) !== "true" && Date.now() < choiceDeadline) {
    await customPassphrase.click({ timeout: 2_000 });
    await page.waitForTimeout(100);
  }
  if ((await customPassphrase.getAttribute("aria-checked")) !== "true")
    throw new Error("custom-passphrase-choice-unavailable");
  await page.getByRole("textbox", { name: "Passphrase Brankas Anda" }).fill(passphrase);
  await page.getByRole("textbox", { name: "Masukkan kembali Passphrase Brankas" }).fill(passphrase);
  await page.getByLabel(/Saya memahami/).click();
  await page.getByRole("button", { name: "Amankan Brankas Pribadi" }).click();
  await page.getByRole("heading", { name: "Brankas Anda terkunci" }).waitFor({ state: "visible", timeout: 60_000 });
}

async function unlockPersonalVault(page, passphrase) {
  await fillPassphraseAfterHydration(page, passphrase);
  await page.getByRole("button", { name: "Buka Brankas" }).click();
  await page.getByRole("heading", { name: "Akun autentikator" }).last().waitFor({ state: "visible", timeout: 60_000 });
}

async function fillPassphraseAfterHydration(page, passphrase, onHydrationCheck = () => {}) {
  const input = page.getByRole("textbox", { name: "Passphrase Brankas", exact: true });
  await input.waitFor({ state: "visible", timeout: 30_000 });
  const revealPassphrase = input.locator("..").getByRole("button");
  const hydrationDeadline = Date.now() + 30_000;
  onHydrationCheck();
  while ((await input.getAttribute("type")) !== "text" && Date.now() < hydrationDeadline) {
    await revealPassphrase.click({ timeout: 2_000 });
    await page.waitForTimeout(100);
  }
  if ((await input.getAttribute("type")) !== "text") throw new Error("vault-unlock-form-not-hydrated");
  await revealPassphrase.click();
  await input.fill(passphrase);
  if ((await input.inputValue()) !== passphrase) throw new Error("vault-passphrase-input-not-ready");
}

function base32(bytes) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(value >>> bits) & 31];
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

async function createSyntheticAccount(page, accountName, digits = 6, alreadyOnForm = false) {
  const secret = base32(randomBytes(20));
  const uri = `otpauth://totp/Load%20Test:${encodeURIComponent(accountName)}?secret=${secret}&issuer=Load%20Test&algorithm=SHA1&digits=${digits}&period=30`;
  if (!alreadyOnForm) await page.getByRole("link", { name: "Tambahkan akun autentikator" }).click();
  await page.getByRole("button", { name: "Opsi lanjutan" }).click();
  await page.getByRole("textbox", { name: "Masukkan URI secara manual" }).fill(uri);
  await page.getByRole("button", { name: "Gunakan URI manual" }).click();
  await page.getByRole("button", { name: "Simpan akun" }).click();
  const accountButton = page.getByRole("button", { name: new RegExp(`Salin OTP.*${accountName}`) });
  const accountCard = page.locator("article").filter({ has: accountButton });
  const otp = accountCard.getByLabel("OTP saat ini");
  await otp.waitFor({ state: "visible", timeout: 30_000 });
  const displayed = await otp.textContent();
  const groups = digits === 8 ? /^\s*\d{4}\s+\d{4}\s*$/ : /^\s*\d{3}\s+\d{3}\s*$/;
  if (!groups.test(displayed ?? "")) throw new Error("client-otp-not-rendered");
}

async function readSession(page, context, baseUrl) {
  const cookies = await context.cookies(baseUrl);
  const cookie = cookies
    .filter((entry) => SESSION_COOKIE_NAMES.has(entry.name))
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("; ");
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/v1/personal-vault");
    return { status: response.status, body: await response.json() };
  });
  if (result.status !== 200 || cookie.length === 0) throw new Error("prepared-user-unavailable");
  if (typeof result.body.id !== "string" || result.body.id.length < 1 || result.body.id.length > 128)
    throw new Error("prepared-vault-invalid");
  return { cookie, vaultId: result.body.id };
}

export async function createSharedVault(page, { vaultName, accountName, ownerPassphrase, onFailurePhase = () => {} }) {
  onFailurePhase("shared_management_navigation");
  await page.getByRole("link", { name: "Brankas", exact: true }).click();
  onFailurePhase("shared_creation_link");
  await page.getByRole("link", { name: "Brankas Bersama" }).click();
  onFailurePhase("shared_creation_form_fill");
  await page.getByLabel("Nama Brankas Bersama").fill(vaultName);
  const baseUrl = new URL(page.url()).origin;
  let requestObserved = false;
  const observeRequest = (request) => {
    if (isSharedVaultCreationRequestTarget(request.method(), request.url(), baseUrl)) requestObserved = true;
  };
  page.on("request", observeRequest);
  const responsePromise = page
    .waitForResponse(
      (response) => isSharedVaultCreationRequestTarget(response.request().method(), response.url(), baseUrl),
      { timeout: 20_000 },
    )
    .then(
      (response) => response,
      () => null,
    );
  let response;
  onFailurePhase("shared_creation_submit");
  try {
    await page.getByRole("button", { name: "Buat Brankas" }).click();
    onFailurePhase("shared_creation_response");
    response = await responsePromise;
  } catch {
    onFailurePhase("shared_creation_submit");
    throw new Error("shared-vault-creation-submit-failed");
  } finally {
    page.off("request", observeRequest);
  }
  if (!response) {
    onFailurePhase(requestObserved ? "shared_creation_response_timeout" : "shared_creation_not_dispatched");
    throw new Error("shared-vault-creation-response-missing");
  }
  const responseFailurePhase = classifySharedVaultCreationStatus(response.status());
  if (responseFailurePhase) {
    onFailurePhase(responseFailurePhase);
    throw new Error("shared-vault-creation-rejected");
  }
  onFailurePhase("shared_creation_confirmation");
  await page.waitForURL((url) => isSharedVaultManagementDetailsPath(url.pathname));
  const sharedVaultId = new URL(page.url()).pathname.split("/").at(-1);
  if (!sharedVaultId || !isSharedVaultManagementDetailsPath(`/vaults/manage/${sharedVaultId}`))
    throw new Error("shared-vault-id-invalid");
  onFailurePhase("shared_creation_account_navigation");
  await page.getByRole("link", { name: "Tambah akun" }).click();
  onFailurePhase("shared_creation_account_form");
  await createSyntheticAccount(page, accountName, 8, true);
  onFailurePhase("shared_creation_management_reload");
  await page.goto(new URL(`/vaults/manage/${sharedVaultId}`, page.url()).toString(), { waitUntil: "domcontentloaded" });
  const tab = page.locator('[data-slot="tabs-list"] [data-slot="tabs-trigger"]').first();
  const passphrase = page.getByRole("textbox", { name: "Passphrase Brankas", exact: true });
  onFailurePhase("shared_creation_unlock_state");
  const unlockState = await Promise.race([
    tab
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "unlocked")
      .catch(() => null),
    passphrase
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "locked")
      .catch(() => null),
  ]);
  if (!unlockState) {
    onFailurePhase("shared_creation_unlock_state_timeout");
    throw new Error("shared-vault-unlock-state-unavailable");
  }
  if (unlockState === "locked") {
    onFailurePhase("shared_creation_unlock_input");
    await fillPassphraseAfterHydration(page, ownerPassphrase, () => onFailurePhase("shared_creation_unlock_hydration"));
    const diagnostics = observeWorkspaceUnlockFailure(page);
    try {
      onFailurePhase("shared_creation_unlock_submit");
      await page.getByRole("button", { name: "Buka Brankas" }).click();
      onFailurePhase("shared_creation_unlock_confirmation");
      const unlocked = await tab.waitFor({ state: "visible", timeout: 30_000 }).then(
        () => true,
        () => false,
      );
      if (!unlocked) {
        const passphraseVisible = await passphrase.isVisible().catch(() => false);
        const passphraseRejected = passphraseVisible
          ? (await passphrase.getAttribute("aria-invalid").catch(() => null)) === "true"
          : false;
        const hasAlert = await page
          .getByRole("alert")
          .first()
          .isVisible()
          .catch(() => false);
        const reportedFailurePhase = await Promise.race([
          diagnostics.failurePhase,
          page.waitForTimeout(300).then(() => null),
        ]);
        const sharedVaultPresence =
          !passphraseVisible && hasAlert ? await observeSharedVaultPresence(page, sharedVaultId) : null;
        onFailurePhase(
          classifySharedVaultUnlockOutcome({
            passphraseVisible,
            passphraseRejected,
            hasAlert,
            reportedFailurePhase,
            sharedVaultPresence,
          }),
        );
        throw new Error("shared-vault-owner-unlock-failed");
      }
    } finally {
      diagnostics.stop();
    }
  }
  onFailurePhase("shared_creation_complete");
  return sharedVaultId;
}

export async function createSecureInvitation(page, recipientEmail, onFailurePhase = () => {}) {
  const tabList = page.locator('[data-slot="tabs-list"] [data-slot="tabs-trigger"]');
  const invitationTab = tabList
    .filter({ hasText: /(Undangan|Invitations)/i })
    .or(page.getByRole("button", { name: /(Undangan|Invitations)/i }));
  onFailurePhase("shared_invitation_tab");
  try {
    await invitationTab.first().waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    const [tabCount, invitationTabCount] = await Promise.all([
      tabList.count().catch(() => 0),
      invitationTab.count().catch(() => 0),
    ]);
    onFailurePhase(
      tabCount === 0
        ? "shared_invitation_tablist_missing"
        : invitationTabCount === 0
          ? "shared_invitation_tab_not_found"
          : "shared_invitation_tab_hidden",
    );
    throw new Error("secure-share-invitation-tab-unavailable");
  }
  const invitationTabTarget = invitationTab.first();
  onFailurePhase("shared_invitation_tab_click");
  try {
    await invitationTabTarget.scrollIntoViewIfNeeded();
    await invitationTabTarget.click();
  } catch {
    const inputAlreadyVisible = await page
      .getByLabel("Email penerima")
      .isVisible()
      .catch(() => false);
    if (!inputAlreadyVisible) {
      const disabled = await invitationTabTarget.isDisabled().catch(() => true);
      if (disabled) {
        onFailurePhase("shared_invitation_tab_disabled");
        throw new Error("secure-share-invitation-tab-disabled");
      }
      try {
        await invitationTabTarget.click({ force: true, timeout: 3_000 });
      } catch {
        onFailurePhase("shared_invitation_tab_click_failed");
        throw new Error("secure-share-invitation-tab-click-failed");
      }
    }
  }
  onFailurePhase("shared_invitation_form");
  const recipientField = page.getByLabel("Email penerima");
  try {
    await recipientField.fill(recipientEmail);
  } catch {
    onFailurePhase("shared_invitation_input");
    throw new Error("secure-share-invitation-input-unavailable");
  }
  const baseUrl = new URL(page.url()).origin;
  let requestObserved = false;
  let sameOriginApiPostObserved = false;
  const observeRequest = (request) => {
    if (request.method() !== "POST") return;
    try {
      const requestUrl = new URL(request.url());
      if (requestUrl.origin === baseUrl && requestUrl.pathname.startsWith("/api/")) sameOriginApiPostObserved = true;
    } catch {
      // Ignore malformed browser request URLs without retaining them.
    }
    if (isSharedVaultInvitationCreationRequestTarget(request.method(), request.url(), baseUrl)) requestObserved = true;
  };
  page.on("request", observeRequest);
  const waitForInvitationResponse = () =>
    page
      .waitForResponse(
        (response) =>
          isSharedVaultInvitationCreationRequestTarget(response.request().method(), response.url(), baseUrl),
        { timeout: 20_000 },
      )
      .then(
        (response) => response,
        () => null,
      );
  let responsePromise = waitForInvitationResponse();
  let response;
  const invitationForm = page.locator("form").filter({ has: recipientField });
  const submitProbeInstalled = await installInvitationSubmitProbe(invitationForm);
  let submitEventProbe = null;
  const namedSubmitButton = invitationForm.getByRole("button", { name: /^(Buat undangan|Create invitation)$/ });
  const submitButton =
    (await namedSubmitButton.count().catch(() => 0)) > 0
      ? namedSubmitButton
      : invitationForm.locator('button[type="submit"]');
  const invitationFormControlsAssociated = await invitationForm
    .first()
    .evaluate((form) => {
      const recipient = form.querySelector('input[type="email"]');
      const submit = form.querySelector('button[type="submit"]');
      return Boolean(recipient && submit && recipient.form === form && submit.form === form);
    })
    .catch(() => false);
  let keyboardFallbackAttempted = false;
  let requestSubmitFallbackAttempted = false;
  try {
    onFailurePhase("shared_invitation_submit");
    try {
      await submitButton.click();
    } catch (error) {
      const [buttonCount, buttonVisible, buttonDisabled, recipientInvalid, clickSurface] = await Promise.all([
        submitButton.count().catch(() => 0),
        submitButton.isVisible().catch(() => false),
        submitButton.isDisabled().catch(() => true),
        recipientField
          .getAttribute("aria-invalid")
          .catch(() => null)
          .then((value) => value === "true"),
        submitButton
          .first()
          .evaluate((button) => {
            const rect = button.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const centerInViewport =
              rect.width > 0 &&
              rect.height > 0 &&
              centerX >= 0 &&
              centerY >= 0 &&
              centerX < window.innerWidth &&
              centerY < window.innerHeight;
            const hitTarget = centerInViewport ? document.elementFromPoint(centerX, centerY) : null;
            return {
              connected: button.isConnected,
              centerInViewport,
              hitTargetMatchesButton: hitTarget === button || (hitTarget instanceof Node && button.contains(hitTarget)),
            };
          })
          .catch(() => null),
      ]);
      const failurePhase = classifySharedInvitationSubmitFailure({
        requestObserved,
        buttonCount,
        buttonVisible,
        buttonDisabled,
        recipientInvalid,
        clickFailure: classifySharedInvitationClickError(error),
        clickSurface,
      });
      if (
        !shouldRetrySharedInvitationSubmitWithKeyboard({
          failurePhase,
          requestObserved,
          buttonCount,
          buttonVisible,
          buttonDisabled,
          recipientInvalid,
        })
      ) {
        onFailurePhase(failurePhase);
        throw new Error("secure-share-invitation-submit-failed");
      }
      keyboardFallbackAttempted = true;
      try {
        await submitButton.press("Enter", { timeout: 5_000 });
      } catch {
        onFailurePhase(failurePhase);
        throw new Error("secure-share-invitation-submit-failed");
      }
    }
    onFailurePhase("shared_invitation_response");
    response = await responsePromise;
    if (!response && !requestObserved) {
      const [
        eventProbe,
        buttonCount,
        buttonVisible,
        buttonDisabled,
        recipientInvalid,
        recipientNativeValid,
        creationErrorVisible,
      ] = await Promise.all([
        snapshotInvitationSubmitProbe(page),
        submitButton.count().catch(() => 0),
        submitButton.isVisible().catch(() => false),
        submitButton.isDisabled().catch(() => true),
        recipientField
          .getAttribute("aria-invalid")
          .catch(() => null)
          .then((value) => value === "true"),
        recipientField.evaluate((input) => input.validity.valid).catch(() => false),
        invitationForm
          .getByRole("alert")
          .first()
          .isVisible()
          .catch(() => false),
      ]);
      if (
        shouldRequestSharedInvitationSubmit({
          requestObserved,
          sameOriginApiPostObserved,
          submitEventObserved: eventProbe?.submitEventObserved ?? false,
          formControlsAssociated: invitationFormControlsAssociated,
          buttonCount,
          buttonVisible,
          buttonDisabled,
          recipientInvalid,
          recipientNativeValid,
        }) &&
        !creationErrorVisible
      ) {
        requestSubmitFallbackAttempted = true;
        responsePromise = waitForInvitationResponse();
        const dispatched = await requestInvitationFormSubmit(invitationForm);
        if (dispatched) response = await responsePromise;
      }
    }
  } finally {
    page.off("request", observeRequest);
    submitEventProbe = await collectInvitationSubmitProbe(page);
  }
  if (!response) {
    const [creationErrorVisible, submitStillPending, recipientInvalid, recipientNativeValid] = await Promise.all([
      invitationForm
        .getByRole("alert")
        .first()
        .isVisible()
        .catch(() => false),
      submitButton.isDisabled().catch(() => true),
      recipientField
        .getAttribute("aria-invalid")
        .then((value) => value === "true")
        .catch(() => false),
      recipientField.evaluate((input) => input.validity.valid).catch(() => false),
    ]);
    onFailurePhase(
      requestObserved
        ? "shared_invitation_response_timeout"
        : !invitationFormControlsAssociated
          ? "shared_invitation_controls_form_mismatch"
          : recipientInvalid
            ? "shared_invitation_recipient_rejected"
            : !recipientNativeValid
              ? "shared_invitation_recipient_native_invalid"
              : creationErrorVisible
                ? "shared_invitation_creation_error_alert"
                : submitStillPending
                  ? "shared_invitation_submit_still_pending"
                  : classifySharedInvitationEventOutcome({
                      probeAvailable: submitProbeInstalled && submitEventProbe !== null,
                      sameOriginApiPostObserved,
                      buttonClickObserved: submitEventProbe?.buttonClickObserved ?? false,
                      keyboardFallbackAttempted,
                      enterKeyObserved: submitEventProbe?.enterKeyObserved ?? false,
                      submitEventObserved: submitEventProbe?.submitEventObserved ?? false,
                      requestSubmitFallbackAttempted,
                    }),
    );
    throw new Error("secure-share-invitation-response-missing");
  }
  const responseFailurePhase = classifySharedVaultInvitationStatus(response.status());
  if (responseFailurePhase) {
    onFailurePhase(responseFailurePhase);
    throw new Error("secure-share-invitation-rejected");
  }
  onFailurePhase("shared_invitation_confirmation");
  const output = page.getByLabel("Tautan undangan aman");
  try {
    await output.waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    onFailurePhase("shared_invitation_link_unavailable");
    throw new Error("secure-share-invitation-link-unavailable");
  }
  const invitation = (await output.textContent())?.trim() ?? "";
  if (!invitation.startsWith(`${baseUrl}/vaults/invitations/redeem#`)) {
    onFailurePhase("shared_invitation_link_invalid");
    throw new Error("secure-share-link-invalid");
  }
  onFailurePhase("shared_invitation_complete");
  return invitation;
}

export async function redeemSharedVaultInvitation(page, { invitation, passphrase, sharedVaultId, accountName }) {
  await page.goto(invitation, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const passphraseInput = page.getByRole("textbox", { name: "Passphrase Brankas", exact: true });
  const accept = page.getByRole("button", { name: "Terima undangan" });
  const unlockedState = await Promise.race([
    passphraseInput
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "locked")
      .catch(() => null),
    accept
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "unlocked")
      .catch(() => null),
  ]);
  if (unlockedState === "locked") {
    await passphraseInput.fill(passphrase);
    await page.getByRole("button", { name: "Buka Brankas" }).click();
  }
  await accept.waitFor({ state: "visible", timeout: 60_000 });
  const responsePromise = page.waitForResponse((response) => {
    if (response.request().method() !== "POST") return false;
    try {
      return new URL(response.url()).pathname === "/api/v1/secure-share-links";
    } catch {
      return false;
    }
  });
  await accept.click();
  const response = await responsePromise;
  if (response.status() !== 204) throw new Error("secure-share-redemption-failed");
  await page.getByRole("heading", { name: "Brankas Anda terkunci" }).waitFor({ state: "visible", timeout: 30_000 });
  await unlockPersonalVault(page, passphrase);
  const membership = await page.evaluate(async (vaultId) => {
    const response = await fetch(`/api/v1/shared-vaults/${encodeURIComponent(vaultId)}`);
    const body = await response.json();
    return {
      status: response.status,
      vaultId: body.vaultId,
      accounts: Array.isArray(body.accounts) ? body.accounts.length : 0,
    };
  }, sharedVaultId);
  if (membership.status !== 200 || membership.vaultId !== sharedVaultId || membership.accounts < 1)
    throw new Error("shared-vault-member-access-not-established");
  const sharedAccountButton = page.getByRole("button", { name: new RegExp(`Salin OTP.*${accountName}`) });
  const sharedAccountCard = page.locator("article").filter({ has: sharedAccountButton });
  const otp = sharedAccountCard.getByLabel("OTP saat ini");
  await otp.waitFor({ state: "visible", timeout: 30_000 });
  const displayed = await otp.textContent();
  if (!/^\s*\d{4}\s+\d{4}\s*$/.test(displayed ?? "")) throw new Error("shared-vault-otp-not-rendered");
  if (!(await page.getByRole("button", { name: new RegExp(`Salin OTP.*${accountName}`) }).isVisible()))
    throw new Error("shared-vault-account-not-visible");
}
