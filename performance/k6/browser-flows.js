import { browser } from "k6/browser";
import { check, sleep } from "k6";
import { Counter } from "k6/metrics";
import { selectCustomPassphrase, unlockPersonalVault } from "./browser-support.js";
import { randomBytes } from "k6/crypto";
import { b64encode } from "k6/encoding";
import {
  BASE_URL,
  PROJECT_ID,
  SUMMARY_TREND_STATS,
  clearCapturedMessages,
  handleSummary,
  waitForCapturedActionUrl,
  SYSTEM_TAGS,
} from "./common.js";

export const options = {
  systemTags: SYSTEM_TAGS,
  summaryTrendStats: SUMMARY_TREND_STATS,
  thresholds: { checks: ["rate==1"] },
  scenarios: {
    lowVolumeBrowserJourney: {
      executor: "shared-iterations",
      vus: 1,
      iterations: 1,
      options: { browser: { type: "chromium" } },
    },
  },
};

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const browserPageCreated = new Counter("first_time_browser_page_created");
const signInPageLoaded = new Counter("first_time_sign_in_page_loaded");
const invalidEmailFilled = new Counter("first_time_invalid_email_filled");
const invalidEmailBlurred = new Counter("first_time_invalid_email_blurred");
const signInFormHydrated = new Counter("first_time_sign_in_form_hydrated");
const emailAddressTyped = new Counter("first_time_email_address_typed");
const emailAddressFilled = new Counter("first_time_email_address_filled");
const emailAddressRetained = new Counter("first_time_email_address_retained");
const emailAddressFocused = new Counter("first_time_email_address_focused");
const emailFocusMoved = new Counter("first_time_email_focus_moved");
const emailAddressBlurred = new Counter("first_time_email_address_blurred");
const emailValidationCleared = new Counter("first_time_email_validation_cleared");
const emailValidated = new Counter("first_time_email_validated");
const turnstileReady = new Counter("first_time_turnstile_ready");
const passwordlessRequestSubmitted = new Counter("first_time_passwordless_request_submitted");
const passwordlessRequestConfirmed = new Counter("first_time_passwordless_request_confirmed");
const magicLinkCaptureDiagnostics = new Map([
  ["list_response_received", new Counter("first_time_magic_link_list_response_received")],
  ["list_parsed", new Counter("first_time_magic_link_list_parsed")],
  ["message_found", new Counter("first_time_magic_link_message_found")],
  ["message_id_validated", new Counter("first_time_magic_link_message_id_validated")],
  ["detail_received", new Counter("first_time_magic_link_detail_received")],
  ["detail_parsed", new Counter("first_time_magic_link_detail_parsed")],
  ["confirmation_link_found", new Counter("first_time_magic_link_confirmation_link_found")],
  ["url_parsed", new Counter("first_time_magic_link_url_parsed")],
  ["origin_validated", new Counter("first_time_magic_link_origin_validated")],
  ["path_validated", new Counter("first_time_magic_link_path_validated")],
  ["token_present", new Counter("first_time_magic_link_token_present")],
  ["action_url_validated", new Counter("first_time_magic_link_action_url_validated")],
  ["mailbox_cleared", new Counter("first_time_magic_link_mailbox_cleared")],
]);
const magicLinkCaptured = new Counter("first_time_magic_link_captured");
const magicLinkRedeemed = new Counter("first_time_magic_link_redeemed");
const vaultNameFilled = new Counter("first_time_vault_name_filled");
const customPassphraseSelected = new Counter("first_time_custom_passphrase_selected");
const customPassphraseFilled = new Counter("first_time_custom_passphrase_filled");
const customPassphraseFormStateValid = new Counter("first_time_custom_passphrase_form_state_valid");
const customPassphraseFormStateInvalid = new Counter("first_time_custom_passphrase_form_state_invalid");
const customPassphraseFormStateProbeIncomplete = new Counter(
  "first_time_custom_passphrase_form_state_probe_incomplete",
);
const passphraseConfirmationFilled = new Counter("first_time_passphrase_confirmation_filled");
const setupAcknowledgementChecked = new Counter("first_time_setup_acknowledgement_checked");
const vaultSetupSubmitProbeStarted = new Counter("first_time_vault_setup_submit_probe_started");
const vaultSetupSubmitButtonLocated = new Counter("first_time_vault_setup_submit_button_located");
const vaultSetupSubmitEnabled = new Counter("first_time_vault_setup_submit_enabled");
const vaultSetupSubmitDisabled = new Counter("first_time_vault_setup_submit_disabled");
const vaultSetupSubmitBusy = new Counter("first_time_vault_setup_submit_busy");
const vaultSetupCustomModeAtSubmit = new Counter("first_time_vault_setup_custom_mode_at_submit");
const vaultSetupGeneratedModeAtSubmit = new Counter("first_time_vault_setup_generated_mode_at_submit");
const vaultSetupSubmitClicked = new Counter("first_time_vault_setup_submit_clicked");
const vaultInitializationErrorVisible = new Counter("first_time_vault_initialization_error_visible");
const vaultInitializationFailureDiagnostics = new Map([
  ["client_crypto_failure", new Counter("first_time_vault_initialization_client_crypto_failure")],
  ["invalid_request", new Counter("first_time_vault_initialization_invalid_request")],
  ["unauthenticated", new Counter("first_time_vault_initialization_unauthenticated")],
  ["forbidden", new Counter("first_time_vault_initialization_forbidden")],
  ["conflict", new Counter("first_time_vault_initialization_conflict")],
  ["rate_limited", new Counter("first_time_vault_initialization_rate_limited")],
  ["server_error", new Counter("first_time_vault_initialization_server_error")],
  ["unexpected_response", new Counter("first_time_vault_initialization_unexpected_response")],
  ["transport_error", new Counter("first_time_vault_initialization_transport_error")],
  ["request_failure", new Counter("first_time_vault_initialization_request_failure")],
  ["post_initialization_failure", new Counter("first_time_vault_initialization_post_failure")],
]);
const vaultInitializationFailureUnclassified = new Counter("first_time_vault_initialization_failure_unclassified");
const vaultSetupFailureDiagnosticsStarted = new Counter("first_time_vault_setup_failure_diagnostics_started");
const vaultSetupDiagnosticProbeIncomplete = new Counter("first_time_vault_setup_diagnostic_probe_incomplete");
const vaultSetupSubmitBusyAtTimeout = new Counter("first_time_vault_setup_submit_busy_at_timeout");
const vaultSetupValidationFailed = new Counter("first_time_vault_setup_validation_failed");
const vaultSetupValidationDiagnostics = new Map([
  ["vault_name", new Counter("first_time_vault_setup_validation_vault_name_invalid")],
  ["passphrase", new Counter("first_time_vault_setup_validation_passphrase_invalid")],
  ["confirmation", new Counter("first_time_vault_setup_validation_confirmation_invalid")],
  ["acknowledgement", new Counter("first_time_vault_setup_validation_acknowledgement_invalid")],
]);
const vaultSetupFailureSurfaceUnclassified = new Counter("first_time_vault_setup_failure_surface_unclassified");
const vaultInitialized = new Counter("first_time_vault_initialized");
const vaultUnlocked = new Counter("first_time_vault_unlocked");
const accountCreationLinkVisible = new Counter("first_time_account_creation_link_visible");
const accountCreationOpened = new Counter("first_time_account_creation_opened");
const manualUriSectionOpened = new Counter("first_time_manual_uri_section_opened");
const manualUriFilled = new Counter("first_time_manual_uri_filled");
const manualUriSubmitEnabled = new Counter("first_time_manual_uri_submit_enabled");
const manualUriSubmitClicked = new Counter("first_time_manual_uri_submit_clicked");
const accountReviewFormVisible = new Counter("first_time_account_review_form_visible");
const accountSaveEnabled = new Counter("first_time_account_save_enabled");
const accountSaveSubmitted = new Counter("first_time_account_save_submitted");
const otpRendered = new Counter("first_time_otp_rendered");
const assertionBlockStarted = new Counter("first_time_assertion_block_started");
const assertionBlockCompleted = new Counter("first_time_assertion_block_completed");

export default async function () {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  browserPageCreated.add(1);
  const suffix = PROJECT_ID.slice(-16);
  const email = `first-time-${suffix}@loadtest.invalid`;
  const passphrase = `Load Test ${b64encode(new Uint8Array(randomBytes(24)))}`;
  try {
    clearCapturedMessages();
    await page.goto(`${BASE_URL}/sign-in`, { waitUntil: "domcontentloaded" });
    const emailField = page.locator("#email");
    await emailField.waitFor({ state: "visible", timeout: 15_000 });
    signInPageLoaded.add(1);
    const hydrationDeadline = Date.now() + 15_000;
    let formHydrated = false;
    let invalidEmailWasFilled = false;
    let invalidEmailWasBlurred = false;
    while (Date.now() < hydrationDeadline) {
      await emailField.fill("invalid");
      if (!invalidEmailWasFilled) {
        invalidEmailFilled.add(1);
        invalidEmailWasFilled = true;
      }
      await page.keyboard.press("Tab");
      if (!invalidEmailWasBlurred) {
        invalidEmailBlurred.add(1);
        invalidEmailWasBlurred = true;
      }
      if ((await emailField.getAttribute("aria-invalid")) === "true") {
        formHydrated = true;
        break;
      }
      await page.waitForTimeout(100);
    }
    if (!formHydrated) throw new Error("The sign-in form did not hydrate.");
    signInFormHydrated.add(1);
    await emailField.fill("");
    await emailField.type(email);
    emailAddressTyped.add(1);
    emailAddressFilled.add(1);
    if ((await emailField.inputValue()) !== email) throw new Error("The synthetic sign-in address was not retained.");
    emailAddressRetained.add(1);
    await emailField.focus();
    emailAddressFocused.add(1);
    const submit = page.locator('form:has(#email) button[type="submit"]');
    await waitForEnabled(submit);
    turnstileReady.add(1);
    await submit.focus();
    emailFocusMoved.add(1);
    const emailValidationDeadline = Date.now() + 10_000;
    let emailValidationClearedState = false;
    while (Date.now() < emailValidationDeadline) {
      if ((await emailField.getAttribute("aria-invalid")) === "false") {
        emailValidationClearedState = true;
        break;
      }
      await page.waitForTimeout(100);
    }
    if (!emailValidationClearedState)
      throw new Error("The valid sign-in address did not clear validation after focus moved.");
    emailAddressBlurred.add(1);
    emailValidationCleared.add(1);
    emailValidated.add(1);
    await submit.click();
    passwordlessRequestSubmitted.add(1);
    await page.locator('form:has(#email) [role="status"]').waitFor({ state: "visible", timeout: 30_000 });
    passwordlessRequestConfirmed.add(1);
    const observedMagicLinkDiagnostics = new Set();
    const actionUrl = waitForCapturedActionUrl(email, 30, (phase) => {
      if (observedMagicLinkDiagnostics.has(phase)) return;
      observedMagicLinkDiagnostics.add(phase);
      magicLinkCaptureDiagnostics.get(phase)?.add(1);
    });
    magicLinkCaptured.add(1);
    await page.goto(actionUrl, { waitUntil: "domcontentloaded" });
    await page.locator("#vault-name").waitFor({ state: "visible", timeout: 30_000 });
    magicLinkRedeemed.add(1);

    const vaultNameInput = page.locator("#vault-name");
    await vaultNameInput.fill("");
    await vaultNameInput.focus();
    await page.keyboard.type("Load Test Personal Vault");
    if ((await vaultNameInput.inputValue()) !== "Load Test Personal Vault")
      throw new Error("The synthetic Personal Vault name was not retained.");
    vaultNameFilled.add(1);

    await selectCustomPassphrase(page);
    customPassphraseSelected.add(1);

    const passphraseInput = page.locator("#custom-unlock-secret");
    await passphraseInput.fill("");
    await passphraseInput.focus();
    await page.keyboard.type(passphrase);
    if ((await passphraseInput.inputValue()) !== passphrase)
      throw new Error("The synthetic passphrase was not retained.");
    customPassphraseFilled.add(1);
    const passphraseFormState = await passphraseInput.getAttribute("data-personal-vault-passphrase-valid");
    if (passphraseFormState === "true") customPassphraseFormStateValid.add(1);
    else if (passphraseFormState === "false") customPassphraseFormStateInvalid.add(1);
    else customPassphraseFormStateProbeIncomplete.add(1);

    const confirmationInput = page.locator("#unlock-secret-confirmation");
    await confirmationInput.fill("");
    await confirmationInput.focus();
    await page.keyboard.type(passphrase);
    if ((await confirmationInput.inputValue()) !== passphrase)
      throw new Error("The synthetic passphrase confirmation was not retained.");
    passphraseConfirmationFilled.add(1);

    const acknowledgement = page.locator("#setup-acknowledgement");
    await acknowledgement.click();
    if ((await acknowledgement.getAttribute("data-state")) !== "checked")
      throw new Error("The Personal Vault setup acknowledgement was not checked.");
    setupAcknowledgementChecked.add(1);

    vaultSetupSubmitProbeStarted.add(1);
    const vaultSetupSubmit = page.locator('form:has(#vault-name) button[type="submit"]');
    await vaultSetupSubmit.waitFor({ state: "visible", timeout: 5_000 });
    vaultSetupSubmitButtonLocated.add(1);
    const disabledAttribute = await vaultSetupSubmit.getAttribute("disabled");
    if (disabledAttribute !== null) {
      vaultSetupSubmitDisabled.add(1);
      if ((await page.locator("#custom-secret").getAttribute("aria-checked")) === "true")
        vaultSetupCustomModeAtSubmit.add(1);
      if ((await page.locator("#generated-secret").getAttribute("aria-checked")) === "true")
        vaultSetupGeneratedModeAtSubmit.add(1);
      if ((await vaultSetupSubmit.getAttribute("aria-busy")) === "true") vaultSetupSubmitBusy.add(1);
      let invalidFieldObserved = false;
      const invalidFields = [
        ["vault_name", page.locator("#vault-name")],
        ["passphrase", page.locator("#custom-unlock-secret")],
        ["confirmation", page.locator("#unlock-secret-confirmation")],
        ["acknowledgement", page.locator("#setup-acknowledgement")],
      ];
      for (const [field, locator] of invalidFields) {
        if ((await locator.getAttribute("aria-invalid")) !== "true") continue;
        invalidFieldObserved = true;
        vaultSetupValidationDiagnostics.get(field)?.add(1);
      }
      if (invalidFieldObserved) vaultSetupValidationFailed.add(1);
      throw new Error("The Personal Vault setup action was not enabled.");
    }
    vaultSetupSubmitEnabled.add(1);
    await vaultSetupSubmit.click();
    vaultSetupSubmitClicked.add(1);

    const unlockInput = page.locator("#vault-unlock-secret");
    try {
      await unlockInput.waitFor({ state: "visible", timeout: 60_000 });
    } catch {
      vaultSetupFailureDiagnosticsStarted.add(1);
      let initializationFailureObserved = false;
      const initializationError = page.locator(
        'form:has(#vault-name) [data-personal-vault-initialization-error="true"]',
      );
      try {
        await initializationError.waitFor({ state: "visible", timeout: 1_000 });
        initializationFailureObserved = true;
        vaultInitializationErrorVisible.add(1);
        let failureCategory = null;
        try {
          failureCategory = await initializationError.getAttribute("data-initialization-failure-category");
        } catch {
          vaultSetupDiagnosticProbeIncomplete.add(1);
        }
        const diagnostic = vaultInitializationFailureDiagnostics.get(failureCategory ?? "");
        if (diagnostic) diagnostic.add(1);
        else vaultInitializationFailureUnclassified.add(1);
      } catch {
        // No initialization-error wrapper was visible; inspect only fixed field/button attributes below.
      }
      if (!initializationFailureObserved) {
        const invalidFields = [
          ["vault_name", page.locator("#vault-name")],
          ["passphrase", page.locator("#custom-unlock-secret")],
          ["confirmation", page.locator("#unlock-secret-confirmation")],
          ["acknowledgement", page.locator("#setup-acknowledgement")],
        ];
        let invalidFieldObserved = false;
        let diagnosticProbeIncomplete = false;
        for (const [field, locator] of invalidFields) {
          let invalidState;
          try {
            invalidState = await locator.getAttribute("aria-invalid");
          } catch {
            diagnosticProbeIncomplete = true;
            continue;
          }
          if (invalidState === "true") {
            invalidFieldObserved = true;
            vaultSetupValidationDiagnostics.get(field)?.add(1);
          } else if (invalidState !== "false") diagnosticProbeIncomplete = true;
        }
        let submitBusyState;
        try {
          submitBusyState = await vaultSetupSubmit.getAttribute("aria-busy");
        } catch {
          diagnosticProbeIncomplete = true;
        }
        if (submitBusyState === "true") vaultSetupSubmitBusyAtTimeout.add(1);
        else if (submitBusyState !== "false") diagnosticProbeIncomplete = true;
        if (invalidFieldObserved) vaultSetupValidationFailed.add(1);
        if (diagnosticProbeIncomplete) vaultSetupDiagnosticProbeIncomplete.add(1);
        else if (!invalidFieldObserved && submitBusyState !== "true") vaultSetupFailureSurfaceUnclassified.add(1);
      }
      throw new Error("The Personal Vault initialization did not reach the unlock form.");
    }
    vaultInitialized.add(1);

    await unlockPersonalVault(page, passphrase);
    vaultUnlocked.add(1);

    const accountName = "loadtest-first-account";
    const secret = base32(new Uint8Array(randomBytes(20)));
    const uri = `otpauth://totp/Load%20Test:${accountName}?secret=${secret}&issuer=Load%20Test&algorithm=SHA1&digits=6&period=30`;
    const accountCreationLink = page.locator('[data-slot="vault-account-actions"] a[href="/vaults/accounts/new"]');
    await accountCreationLink.waitFor({ state: "visible", timeout: 15_000 });
    accountCreationLinkVisible.add(1);
    await accountCreationLink.click();
    accountCreationOpened.add(1);
    const manualUriTrigger = page.locator('[data-slot="collapsible-trigger"]');
    await manualUriTrigger.click();
    if ((await manualUriTrigger.getAttribute("data-state")) !== "open")
      throw new Error("The advanced authenticator import controls did not open.");
    manualUriSectionOpened.add(1);

    const uriInput = page.locator("#manual-authenticator-uri");
    await uriInput.fill("");
    await uriInput.focus();
    await page.keyboard.type(uri);
    if ((await uriInput.inputValue()) !== uri) throw new Error("The synthetic authenticator URI was not retained.");
    manualUriFilled.add(1);

    const manualUriSubmit = page.locator('form:has(#manual-authenticator-uri) button[type="submit"]');
    await manualUriSubmit.waitFor({ state: "visible", timeout: 10_000 });
    if (!(await manualUriSubmit.isEnabled())) throw new Error("The manual authenticator import action was disabled.");
    manualUriSubmitEnabled.add(1);
    await manualUriSubmit.click();
    manualUriSubmitClicked.add(1);

    const accountUriPreview = page.locator("#account-uri");
    await accountUriPreview.waitFor({ state: "visible", timeout: 15_000 });
    accountReviewFormVisible.add(1);
    const accountSave = page.locator('form:has(#account-uri) button[type="submit"]');
    await accountSave.waitFor({ state: "visible", timeout: 10_000 });
    if (!(await accountSave.isEnabled())) throw new Error("The authenticator account save action was disabled.");
    accountSaveEnabled.add(1);
    await accountSave.click();
    accountSaveSubmitted.add(1);
    const otp = page.locator('output[aria-label="OTP saat ini"]');
    await otp.waitFor({ state: "visible", timeout: 30_000 });
    otpRendered.add(1);
    const display = await otp.textContent();
    assertionBlockStarted.add(1);
    check(display, {
      "first-time workflow reaches the Personal Vault": (value) => typeof value === "string",
      "first-time Authenticator Account renders a client OTP": (value) => /^\s*\d{3}\s+\d{3}\s*$/.test(value ?? ""),
    });
    assertionBlockCompleted.add(1);
  } finally {
    try {
      await clearCapturedMessages();
    } finally {
      await page.close();
    }
  }
}

async function waitForEnabled(locator) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await locator.isEnabled()) return;
    sleep(0.25);
  }
  throw new Error("The fresh local Turnstile widget token did not become ready.");
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

export { handleSummary };
