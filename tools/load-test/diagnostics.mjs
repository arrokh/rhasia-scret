import { BROWSER_HELPER_FAILURE_PHASES } from "./settings.mjs";

export function parseBrowserHelperFailurePhase(output) {
  if (typeof output !== "string" || output.length > 256) return null;
  try {
    const parsed = JSON.parse(output);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      Object.keys(parsed).length !== 1 ||
      !BROWSER_HELPER_FAILURE_PHASES.has(parsed.failurePhase)
    )
      return null;
    return parsed.failurePhase;
  } catch {
    return null;
  }
}

export function firstTimeAssertionFailureDetail(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return "first_time_summary_missing";
  const metrics = summary.metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return "first_time_summary_missing";
  const milestones = [
    ["first_time_browser_page_created", "first_time_browser_not_started"],
    ["first_time_sign_in_page_loaded", "first_time_sign_in_page_not_loaded"],
    ["first_time_invalid_email_filled", "first_time_sign_in_form_input_failed"],
    ["first_time_invalid_email_blurred", "first_time_sign_in_form_blur_failed"],
    ["first_time_sign_in_form_hydrated", "first_time_sign_in_form_not_hydrated"],
    ["first_time_email_address_typed", "first_time_email_typing_failed"],
    ["first_time_email_address_filled", "first_time_email_input_failed"],
    ["first_time_email_address_retained", "first_time_email_not_retained"],
    ["first_time_email_address_focused", "first_time_email_focus_failed"],
    ["first_time_turnstile_ready", "first_time_turnstile_not_ready"],
    ["first_time_email_focus_moved", "first_time_email_focus_move_failed"],
    ["first_time_email_address_blurred", "first_time_email_blur_failed"],
    ["first_time_email_validation_cleared", "first_time_email_validation_not_observed"],
    ["first_time_email_validated", "first_time_email_not_validated"],
    ["first_time_passwordless_request_submitted", "first_time_passwordless_request_not_submitted"],
    ["first_time_passwordless_request_confirmed", "first_time_passwordless_request_not_confirmed"],
    ["first_time_magic_link_list_response_received", "first_time_magic_link_mailpit_list_unavailable"],
    ["first_time_magic_link_list_parsed", "first_time_magic_link_mailpit_list_invalid"],
    ["first_time_magic_link_message_found", "first_time_magic_link_message_not_found"],
    ["first_time_magic_link_message_id_validated", "first_time_magic_link_message_id_invalid"],
    ["first_time_magic_link_detail_received", "first_time_magic_link_detail_unavailable"],
    ["first_time_magic_link_detail_parsed", "first_time_magic_link_detail_invalid"],
    ["first_time_magic_link_confirmation_link_found", "first_time_magic_link_link_missing"],
    ["first_time_magic_link_url_parsed", "first_time_magic_link_url_parse_failed"],
    ["first_time_magic_link_origin_validated", "first_time_magic_link_origin_mismatch"],
    ["first_time_magic_link_path_validated", "first_time_magic_link_path_mismatch"],
    ["first_time_magic_link_token_present", "first_time_magic_link_token_missing"],
    ["first_time_magic_link_action_url_validated", "first_time_magic_link_url_validation_incomplete"],
    ["first_time_magic_link_mailbox_cleared", "first_time_magic_link_mailbox_cleanup_failed"],
    ["first_time_magic_link_captured", "first_time_magic_link_not_captured"],
    ["first_time_magic_link_redeemed", "first_time_magic_link_not_redeemed"],
    ["first_time_vault_name_filled", "first_time_vault_name_not_filled"],
    ["first_time_custom_passphrase_selected", "first_time_custom_passphrase_not_selected"],
    ["first_time_custom_passphrase_filled", "first_time_custom_passphrase_not_filled"],
    ["first_time_passphrase_confirmation_filled", "first_time_passphrase_confirmation_not_filled"],
    ["first_time_setup_acknowledgement_checked", "first_time_setup_acknowledgement_not_checked"],
    ["first_time_vault_setup_submit_enabled", "first_time_vault_setup_submit_not_enabled"],
    ["first_time_vault_setup_submit_clicked", "first_time_vault_setup_not_submitted"],
    ["first_time_vault_initialized", "first_time_vault_not_initialized"],
    ["first_time_vault_unlocked", "first_time_vault_not_unlocked"],
    ["first_time_account_creation_link_visible", "first_time_account_creation_link_not_visible"],
    ["first_time_account_creation_opened", "first_time_account_creation_not_opened"],
    ["first_time_manual_uri_section_opened", "first_time_manual_uri_section_not_opened"],
    ["first_time_manual_uri_filled", "first_time_manual_uri_not_filled"],
    ["first_time_manual_uri_submit_enabled", "first_time_manual_uri_submit_not_enabled"],
    ["first_time_manual_uri_submit_clicked", "first_time_manual_uri_submit_not_clicked"],
    ["first_time_account_review_form_visible", "first_time_account_review_form_not_visible"],
    ["first_time_account_save_enabled", "first_time_account_save_not_enabled"],
    ["first_time_account_save_submitted", "first_time_account_not_created"],
  ];
  for (const [metric, failureDetail] of milestones) {
    if (metrics[metric]?.count === 1) continue;
    if (metric === "first_time_vault_setup_submit_enabled") {
      if (metrics.first_time_vault_setup_submit_probe_started?.count !== 1)
        return "first_time_vault_setup_submit_probe_not_started";
      if (metrics.first_time_vault_setup_submit_button_located?.count !== 1)
        return "first_time_vault_setup_submit_button_missing";
      if (metrics.first_time_vault_setup_submit_disabled?.count !== 1)
        return "first_time_vault_setup_submit_probe_incomplete";
      if (metrics.first_time_vault_setup_validation_failed?.count === 1) {
        const invalidFields = [
          [
            "first_time_vault_setup_validation_vault_name_invalid",
            "first_time_vault_setup_validation_vault_name_invalid",
          ],
          [
            "first_time_vault_setup_validation_passphrase_invalid",
            "first_time_vault_setup_validation_passphrase_invalid",
          ],
          [
            "first_time_vault_setup_validation_confirmation_invalid",
            "first_time_vault_setup_validation_confirmation_invalid",
          ],
          [
            "first_time_vault_setup_validation_acknowledgement_invalid",
            "first_time_vault_setup_validation_acknowledgement_invalid",
          ],
        ];
        for (const [failureMetric, failureDetail] of invalidFields) {
          if (metrics[failureMetric]?.count === 1) return failureDetail;
        }
      }
      if (metrics.first_time_vault_setup_submit_busy?.count === 1) return "first_time_vault_setup_submit_busy";
      if (metrics.first_time_vault_setup_custom_mode_at_submit?.count !== 1)
        return "first_time_vault_setup_custom_mode_not_selected";
      return "first_time_vault_setup_submit_disabled_unclassified";
    }
    if (
      metric === "first_time_vault_initialized" &&
      metrics.first_time_custom_passphrase_form_state_invalid?.count === 1
    )
      return "first_time_custom_passphrase_form_state_invalid";
    if (
      metric === "first_time_vault_initialized" &&
      metrics.first_time_custom_passphrase_form_state_probe_incomplete?.count === 1
    )
      return "first_time_custom_passphrase_form_state_probe_incomplete";
    if (metric === "first_time_vault_initialized" && metrics.first_time_vault_setup_submit_busy_at_timeout?.count === 1)
      return "first_time_vault_initialization_still_pending";
    if (
      metric === "first_time_vault_initialized" &&
      metrics.first_time_vault_setup_diagnostic_probe_incomplete?.count === 1
    )
      return "first_time_vault_setup_diagnostic_probe_incomplete";
    if (
      metric === "first_time_vault_initialized" &&
      (metrics.first_time_vault_setup_validation_failed?.count === 1 ||
        metrics.first_time_vault_setup_failure_surface_unclassified?.count === 1)
    ) {
      const validationFailures = [
        [
          "first_time_vault_setup_validation_vault_name_invalid",
          "first_time_vault_setup_validation_vault_name_invalid",
        ],
        [
          "first_time_vault_setup_validation_passphrase_invalid",
          "first_time_vault_setup_validation_passphrase_invalid",
        ],
        [
          "first_time_vault_setup_validation_confirmation_invalid",
          "first_time_vault_setup_validation_confirmation_invalid",
        ],
        [
          "first_time_vault_setup_validation_acknowledgement_invalid",
          "first_time_vault_setup_validation_acknowledgement_invalid",
        ],
      ];
      for (const [failureMetric, failureDetail] of validationFailures) {
        if (metrics[failureMetric]?.count === 1) return failureDetail;
      }
      return "first_time_vault_initialization_failure_unclassified";
    }
    if (
      metric === "first_time_vault_initialized" &&
      metrics.first_time_vault_initialization_error_visible?.count === 1
    ) {
      const initializationFailures = [
        [
          "first_time_vault_initialization_client_crypto_failure",
          "first_time_vault_initialization_client_crypto_failure",
        ],
        ["first_time_vault_initialization_invalid_request", "first_time_vault_initialization_invalid_request"],
        ["first_time_vault_initialization_unauthenticated", "first_time_vault_initialization_unauthenticated"],
        ["first_time_vault_initialization_forbidden", "first_time_vault_initialization_forbidden"],
        ["first_time_vault_initialization_conflict", "first_time_vault_initialization_conflict"],
        ["first_time_vault_initialization_rate_limited", "first_time_vault_initialization_rate_limited"],
        ["first_time_vault_initialization_server_error", "first_time_vault_initialization_server_error"],
        ["first_time_vault_initialization_unexpected_response", "first_time_vault_initialization_unexpected_response"],
        ["first_time_vault_initialization_transport_error", "first_time_vault_initialization_transport_error"],
        ["first_time_vault_initialization_request_failure", "first_time_vault_initialization_request_failure"],
        ["first_time_vault_initialization_post_failure", "first_time_vault_initialization_post_failure"],
        [
          "first_time_vault_initialization_failure_unclassified",
          "first_time_vault_initialization_failure_unclassified",
        ],
      ];
      for (const [failureMetric, failureDetail] of initializationFailures) {
        if (metrics[failureMetric]?.count === 1) return failureDetail;
      }
      return "first_time_vault_initialization_rejected";
    }
    return failureDetail;
  }
  if (metrics.first_time_otp_rendered?.count !== 1) return "first_time_otp_not_rendered";
  if (metrics.first_time_assertion_block_started?.count !== 1) return "first_time_assertion_block_not_reached";
  if (metrics.first_time_assertion_block_completed?.count !== 1) return "first_time_assertion_block_incomplete";
  const checks = metrics.checks;
  if (
    !checks ||
    typeof checks !== "object" ||
    typeof checks.rate !== "number" ||
    typeof checks.passes !== "number" ||
    typeof checks.fails !== "number" ||
    checks.passes + checks.fails !== 2
  )
    return "first_time_check_observations_missing";
  if (checks.rate !== 1 || checks.fails !== 0) return "first_time_assertions_failed";
  return null;
}

export function rateLimitAssertionFailureDetail(summary, boundary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return "rate_limit_summary_missing";
  const metrics = summary.metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) return "rate_limit_summary_missing";
  const expectations =
    boundary === "email"
      ? [{ prefix: "rate_limit_anonymous_boundary", attempts: 6, admitted: 5, limited: 1 }]
      : boundary === "network"
        ? [{ prefix: "rate_limit_anonymous_boundary", attempts: 21, admitted: 20, limited: 1 }]
        : boundary === "authenticated"
          ? [
              { prefix: "rate_limit_key_material_mutation", attempts: 11, admitted: 10, limited: 1 },
              { prefix: "rate_limit_account_mutation", attempts: 121, admitted: 120, limited: 1 },
              { prefix: "rate_limit_vault_mutation", attempts: 31, admitted: 30, limited: 1 },
              { prefix: "rate_limit_membership_mutation", attempts: 31, admitted: 30, limited: 1 },
            ]
          : null;
  if (!expectations) return "rate_limit_boundary_unsupported";
  for (const expectation of expectations) {
    const observed = {
      attempts: metrics[`${expectation.prefix}_attempts`]?.count,
      admitted: metrics[`${expectation.prefix}_admitted`]?.count,
      limited: metrics[`${expectation.prefix}_limited`]?.count,
    };
    if (Object.values(observed).some((value) => !Number.isSafeInteger(value) || value < 0))
      return "rate_limit_boundary_observations_missing";
    if (observed.attempts !== expectation.attempts) return "rate_limit_boundary_attempt_count_mismatch";
    if (observed.admitted !== expectation.admitted) return "rate_limit_boundary_admitted_count_mismatch";
    if (observed.limited !== expectation.limited) return "rate_limit_boundary_limited_count_mismatch";
  }
  return null;
}

export function parseProcessUsage(output) {
  if (typeof output !== "string") return null;
  const fields = output.trim().split(/\s+/);
  if (fields.length !== 2) return null;
  const cpuPercent = Number(fields[0]);
  const residentMemoryKiB = Number(fields[1]);
  if (
    !Number.isFinite(cpuPercent) ||
    cpuPercent < 0 ||
    cpuPercent > 10_000 ||
    !Number.isSafeInteger(residentMemoryKiB) ||
    residentMemoryKiB < 0 ||
    residentMemoryKiB > Math.floor(Number.MAX_SAFE_INTEGER / 1_024)
  )
    return null;
  return { cpuPercent, residentMemoryBytes: residentMemoryKiB * 1_024 };
}
