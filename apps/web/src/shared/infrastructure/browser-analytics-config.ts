"use client";

import type { BeforeSendFn, PostHogConfig } from "posthog-js/dist/module.full.no-external";
import { isAnalyticsPublicRoute } from "./analytics-route-policy";

/** Analytics is restricted to public information pages and the public landing surface. */
export const ANALYTICS_EVENTS = {
  authenticationSignInLinkRequested: "authentication_sign_in_link_requested",
  authenticationSignInLinkRequestFailed: "authentication_sign_in_link_request_failed",
  authenticationSessionEstablished: "authentication_session_established",
  authenticationSignedOut: "authentication_signed_out",
  personalVaultInitialized: "personal_vault_initialized",
  personalVaultInitializationFailed: "personal_vault_initialization_failed",
  sharedVaultCreated: "shared_vault_created",
  sharedVaultCreationFailed: "shared_vault_creation_failed",
  sharedVaultRenamed: "shared_vault_renamed",
  sharedVaultDeleted: "shared_vault_deleted",
  sharedVaultInvitationCreated: "shared_vault_invitation_created",
  sharedVaultInvitationReissued: "shared_vault_invitation_reissued",
  sharedVaultParticipantRemoved: "shared_vault_participant_removed",
  sharedVaultDefaultPermissionsUpdated: "shared_vault_default_permissions_updated",
  sharedVaultMemberPermissionsUpdated: "shared_vault_member_permissions_updated",
  sharedVaultOperationFailed: "shared_vault_operation_failed",
  vaultUnlocked: "vault_unlocked",
  vaultUnlockFailed: "vault_unlock_failed",
  offlineVaultUnlocked: "offline_vault_unlocked",
  offlineVaultUnlockFailed: "offline_vault_unlock_failed",
  offlineVaultLocked: "offline_vault_locked",
  offlineVaultCleared: "offline_vault_cleared",
  localVaultCreated: "local_vault_created",
  localVaultUnlocked: "local_vault_unlocked",
  localVaultUnlockFailed: "local_vault_unlock_failed",
  localVaultMigrated: "local_vault_migrated",
  localVaultLocked: "local_vault_locked",
  localVaultCleared: "local_vault_cleared",
  localVaultRenamed: "local_vault_renamed",
  localVaultArchiveExportPrepared: "local_vault_archive_export_prepared",
  localVaultArchiveImportCompleted: "local_vault_archive_import_completed",
  localAuthenticatorAccountCreated: "local_authenticator_account_created",
  localAuthenticatorAccountUpdated: "local_authenticator_account_updated",
  localAuthenticatorAccountDeleted: "local_authenticator_account_deleted",
  rememberedBrowserEnabled: "remembered_browser_enabled",
  rememberedBrowserRemoved: "remembered_browser_removed",
  authenticatorAccountCreated: "authenticator_account_created",
  authenticatorAccountUpdated: "authenticator_account_updated",
  authenticatorAccountDeleted: "authenticator_account_deleted",
  authenticatorAccountOperationFailed: "authenticator_account_operation_failed",
  secureShareLinkRedeemed: "secure_share_link_redeemed",
  personalVaultResetCompleted: "personal_vault_reset_completed",
  vaultArchiveExportPrepared: "vault_archive_export_prepared",
  vaultArchiveImportCompleted: "vault_archive_import_completed",
  passkeyRecoveryEnabled: "passkey_recovery_enabled",
  passkeyRecoveryResetCompleted: "passkey_recovery_reset_completed",
  clientError: "client_error",
} as const;

export type AnalyticsEventName = keyof AnalyticsEventProperties;
type AnalyticsVaultType = "PERSONAL" | "SHARED";
type AnalyticsAuthenticationMethod = "email";
type AnalyticsVaultUnlockMethod = "passphrase" | "remembered_browser" | "passkey";
type AnalyticsOfflineUnlockMethod = "passphrase" | "remembered_browser";
type AnalyticsFailureCode =
  | "rate_limited"
  | "provider_error"
  | "invalid_secret"
  | "remembered_browser_error"
  | "passkey_error"
  | "permission_denied"
  | "duplicate"
  | "destination_unavailable"
  | "unknown";
type AnalyticsAccountOperation = "create" | "update" | "delete";
type AnalyticsParticipantType = "member" | "invitation";

type AnalyticsEventProperties = {
  authentication_sign_in_link_requested: { method: AnalyticsAuthenticationMethod };
  authentication_sign_in_link_request_failed: {
    method: AnalyticsAuthenticationMethod;
    failure_code: "rate_limited" | "provider_error";
  };
  authentication_session_established: undefined;
  authentication_signed_out: undefined;
  personal_vault_initialized: undefined;
  personal_vault_initialization_failed: undefined;
  shared_vault_created: undefined;
  shared_vault_creation_failed: undefined;
  shared_vault_renamed: undefined;
  shared_vault_deleted: undefined;
  shared_vault_invitation_created: undefined;
  shared_vault_invitation_reissued: undefined;
  shared_vault_participant_removed: { participant_type: AnalyticsParticipantType };
  shared_vault_default_permissions_updated: undefined;
  shared_vault_member_permissions_updated: undefined;
  shared_vault_operation_failed: {
    operation:
      | "rename"
      | "delete"
      | "invite"
      | "reinvite"
      | "remove_participant"
      | "update_permissions"
      | "update_default_permissions";
    failure_code: "permission_denied" | "unknown";
  };
  vault_unlocked: { method: AnalyticsVaultUnlockMethod };
  vault_unlock_failed: {
    method: AnalyticsVaultUnlockMethod;
    failure_code:
      | "authentication_failed"
      | "crypto_unlock_failed"
      | "invalid_secret"
      | "key_derivation_failed"
      | "local_storage_failed"
      | "personal_vault_key_wrap_failed"
      | "personal_vault_mismatch"
      | "personal_vault_name_decryption_failed"
      | "profile_data_invalid"
      | "profile_migration_failed"
      | "profile_rewrap_failed"
      | "root_key_wrap_failed"
      | "remembered_browser_error"
      | "passkey_error"
      | "sync_failed"
      | "unknown"
      | "workspace_bundle_invalid"
      | "workspace_processing_failed"
      | "workspace_response_failed"
      | "vault_content_decryption_failed"
      | "user_encryption_key_recovery_failed"
      | "user_encryption_envelope_invalid"
      | "user_encryption_key_decryption_failed"
      | "user_encryption_legacy_envelope"
      | "user_encryption_private_key_invalid";
  };
  offline_vault_unlocked: { method: AnalyticsOfflineUnlockMethod };
  offline_vault_unlock_failed: {
    method: AnalyticsOfflineUnlockMethod;
    failure_code:
      | "authentication_failed"
      | "invalid_secret"
      | "key_derivation_failed"
      | "local_storage_failed"
      | "personal_vault_key_wrap_failed"
      | "personal_vault_name_decryption_failed"
      | "profile_data_invalid"
      | "profile_migration_failed"
      | "root_key_wrap_failed"
      | "remembered_browser_error"
      | "sync_failed"
      | "unknown"
      | "user_encryption_key_recovery_failed";
  };
  offline_vault_locked: undefined;
  offline_vault_cleared: undefined;
  local_vault_created: undefined;
  local_vault_unlocked: { method: "passphrase" };
  local_vault_unlock_failed: {
    method: "passphrase";
    failure_code: "invalid_secret" | "migration_required" | "unknown";
  };
  local_vault_migrated: undefined;
  local_vault_locked: undefined;
  local_vault_cleared: undefined;
  local_vault_renamed: undefined;
  local_vault_archive_export_prepared: { account_count: number };
  local_vault_archive_import_completed: { account_count: number };
  local_authenticator_account_created: undefined;
  local_authenticator_account_updated: undefined;
  local_authenticator_account_deleted: undefined;
  remembered_browser_enabled: undefined;
  remembered_browser_removed: undefined;
  authenticator_account_created: { vault_type: AnalyticsVaultType };
  authenticator_account_updated: { vault_type: AnalyticsVaultType };
  authenticator_account_deleted: { vault_type: AnalyticsVaultType };
  authenticator_account_operation_failed: { operation: AnalyticsAccountOperation; failure_code: AnalyticsFailureCode };
  secure_share_link_redeemed: undefined;
  personal_vault_reset_completed: undefined;
  vault_archive_export_prepared: { vault_type: AnalyticsVaultType };
  vault_archive_import_completed: {
    account_count: number;
    destination_type: AnalyticsVaultType;
    created_new_vault: boolean;
  };
  passkey_recovery_enabled: undefined;
  passkey_recovery_reset_completed: undefined;
  client_error: { error_name: string; error_digest: string };
};

export type AnalyticsEventPropertiesFor<Name extends AnalyticsEventName> = AnalyticsEventProperties[Name];
const SANITIZED_URL_PROPERTIES = ["$current_url"] as const;
// Only source-controlled route segments may leave the browser. Unknown suffixes
// fail closed, including future dynamic routes and user-controlled 404 paths.
const STATIC_ANALYTICS_ROUTES = [
  "/",
  "/landing",
  "/privacy",
  "/support",
  "/local",
  "/offline",
  "/sign-in",
  "/account/delete",
  "/account/delete/reauth",
  "/account/delete/complete",
  "/smoke",
  "/totp",
  "/auth/confirm",
  "/auth/pwa-confirm",
  "/auth/complete",
  "/auth/logout",
  "/vaults",
  "/vaults/recovery",
  "/vaults/accounts/new",
  "/vaults/manage",
  "/vaults/manage/personal",
  "/vaults/manage/new",
  "/vaults/backup",
  "/vaults/import",
  "/vaults/invitations/redeem",
  "/ui-preview",
  "/ui-preview/recovery",
  "/ui-preview/archive-backup",
  "/ui-preview/archive-import",
  "/ui-preview/remembered-browser",
  "/ui-preview/vaults",
] as const;
const SAFE_ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const SAFE_ERROR_DIGEST_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
// The SDK adds `token` to every capture as a required ingestion property. It is
// the public project token, not application or Vault data, and must survive before_send.
const SAFE_ANALYTICS_PROPERTY_KEYS = new Set([
  "token",
  "distinct_id",
  "$device_id",
  "$session_id",
  "$window_id",
  "$lib",
  "$lib_version",
  "$process_person_profile",
  "$browser",
  "$browser_version",
  "$device_type",
  "$os",
  "$os_version",
  "$screen_height",
  "$screen_width",
  "$viewport_height",
  "$viewport_width",
  "$timezone",
]);
const KNOWN_AUTOMATIC_EVENTS = new Set([
  "$pageview",
  "$pageleave",
  "$web_vitals",
  "$performance_event",
  "$autocapture",
  "$dead_click",
  "$exception",
  "$rageclick",
]);
const SAFE_WEB_VITAL_PROPERTY_PATTERN = /^\$web_vitals_(?:LCP|CLS|FCP|INP)_value$/;
const SAFE_PERFORMANCE_PROPERTY_PATTERN = /^\$performance_[a-z0-9_]+_(?:duration|value|count)$/;
const SAFE_ANALYTICS_NUMBER = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 900_000;

export function sanitizeAnalyticsCapture(capture: Parameters<BeforeSendFn>[0]): ReturnType<BeforeSendFn> {
  if (!capture) return null;
  const automaticCapture = capture.event.startsWith("$");
  const explicitClientError = capture.event === ANALYTICS_EVENTS.clientError;
  if (!automaticCapture && !explicitClientError) return null;
  if (typeof window !== "undefined" && !isAnalyticsPublicRoute(window.location.pathname)) return null;
  if (!isAnalyticsPublicRoute(getAnalyticsPath(capture))) return null;
  if (automaticCapture && !KNOWN_AUTOMATIC_EVENTS.has(capture.event)) return null;
  for (const property of Object.keys(capture.properties)) {
    const value = capture.properties[property];
    if (property === "$referrer" || property === "$initial_referrer") {
      delete capture.properties[property];
      continue;
    }
    if (SANITIZED_URL_PROPERTIES.includes(property as (typeof SANITIZED_URL_PROPERTIES)[number])) {
      if (typeof value !== "string") {
        delete capture.properties[property];
        continue;
      }
      try {
        capture.properties[property] = sanitizeAnalyticsUrl(value);
      } catch {
        delete capture.properties[property];
      }
      continue;
    }
    if (property === "$pathname") {
      if (typeof value === "string" && value.startsWith("/") && !value.startsWith("//")) {
        capture.properties[property] = sanitizeAnalyticsPath(value.split(/[?#]/, 1)[0]);
      } else delete capture.properties[property];
      continue;
    }
    if (property === "$exception_list") {
      if (capture.event !== "$exception") delete capture.properties[property];
      else {
        const exceptionList = sanitizeAnalyticsExceptionList(value);
        if (exceptionList.length === 0) delete capture.properties[property];
        else capture.properties[property] = exceptionList;
      }
      continue;
    }
    if (property === "error_name") {
      if (!explicitClientError) delete capture.properties[property];
      else capture.properties[property] = normalizeAnalyticsErrorName(value);
      continue;
    }
    if (property === "error_digest") {
      if (!explicitClientError) delete capture.properties[property];
      else capture.properties[property] = normalizeAnalyticsErrorDigest(value);
      continue;
    }
    if (automaticCapture) {
      if (!isAllowedAutomaticProperty(capture.event, property, value)) delete capture.properties[property];
    } else if (
      !isPrimitiveAnalyticsValue(value) ||
      (!SAFE_ANALYTICS_PROPERTY_KEYS.has(property) && !isAllowedExplicitProperty(property, value))
    ) {
      delete capture.properties[property];
    }
  }
  return capture;
}

function isPrimitiveAnalyticsValue(value: unknown): boolean {
  return value === null || ["boolean", "number", "string"].includes(typeof value);
}

function isAllowedAutomaticProperty(event: string, property: string, value: unknown): boolean {
  if (SAFE_ANALYTICS_PROPERTY_KEYS.has(property)) return isPrimitiveAnalyticsValue(value);
  if (event === "$web_vitals" && SAFE_WEB_VITAL_PROPERTY_PATTERN.test(property)) return SAFE_ANALYTICS_NUMBER(value);
  if (event === "$performance_event" && SAFE_PERFORMANCE_PROPERTY_PATTERN.test(property))
    return SAFE_ANALYTICS_NUMBER(value);
  return false;
}

function isAllowedExplicitProperty(property: string, value: unknown): boolean {
  if (property === "error_name") return typeof value === "string" && normalizeAnalyticsErrorName(value) === value;
  if (property === "error_digest") return typeof value === "string" && normalizeAnalyticsErrorDigest(value) === value;
  return false;
}

function sanitizeAnalyticsExceptionList(value: unknown): Array<{ type: string }> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 3).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const type = (entry as Record<string, unknown>).type;
    return [{ type: normalizeAnalyticsErrorName(type) }];
  });
}

export function normalizeAnalyticsErrorName(value: unknown): string {
  return typeof value === "string" && SAFE_ERROR_NAME_PATTERN.test(value) ? value : "Error";
}

export function normalizeAnalyticsErrorDigest(value: unknown): string {
  return typeof value === "string" && SAFE_ERROR_DIGEST_PATTERN.test(value) ? value : "unknown";
}

const sanitizeAnalyticsUrls: BeforeSendFn = sanitizeAnalyticsCapture;

function sanitizeAnalyticsUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Unsupported analytics URL protocol");
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  url.pathname = sanitizeAnalyticsPath(url.pathname);
  return url.toString();
}

function sanitizeAnalyticsPath(pathname: string): string {
  const segments = pathname.split("/");
  let knownPrefix = "";
  let privateSuffix = false;
  return segments
    .map((segment, index) => {
      if (index === 0 || (index === segments.length - 1 && segment === "")) return segment;
      knownPrefix += `/${segment}`;
      privateSuffix ||= !STATIC_ANALYTICS_ROUTES.some(
        (route) => route === knownPrefix || route.startsWith(`${knownPrefix}/`),
      );
      return privateSuffix ? "[redacted]" : segment;
    })
    .join("/");
}

function getAnalyticsPath(capture: NonNullable<Parameters<BeforeSendFn>[0]>): string {
  const currentUrl = capture.properties.$current_url;
  if (typeof currentUrl === "string") {
    try {
      const url = new URL(currentUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") return "";
      return url.pathname;
    } catch {
      return "";
    }
  }
  return typeof window === "undefined" ? "" : window.location.pathname;
}

export const BROWSER_ANALYTICS_CONFIG = {
  defaults: "2026-01-30",
  ui_host: "https://us.posthog.com",
  autocapture: {
    url_ignorelist: [/\/(?:account|auth|local|offline|sign-in|totp|vaults)(?:\/|$)/],
    dom_event_allowlist: ["click", "submit"],
    element_allowlist: ["a", "button"],
    css_selector_ignorelist: [".ph-no-capture", "[data-ph-no-capture]"],
    element_attribute_ignorelist: [
      "aria-label",
      "data-slot",
      "data-testid",
      "for",
      "href",
      "id",
      "name",
      "placeholder",
      "title",
      "value",
    ],
    capture_copied_text: false,
  },
  capture_pageview: "history_change",
  capture_pageleave: true,
  capture_dead_clicks: true,
  capture_heatmaps: false,
  capture_performance: {
    web_vitals: true,
    web_vitals_allowed_metrics: ["LCP", "CLS", "FCP", "INP"],
    web_vitals_delayed_flush_ms: 5_000,
    web_vitals_attribution: false,
    network_timing: false,
  },
  capture_exceptions: {
    capture_unhandled_errors: true,
    capture_unhandled_rejections: true,
    capture_console_errors: false,
  },
  error_tracking: {
    captureExtensionExceptions: false,
    exception_steps: { enabled: false },
  },
  disable_session_recording: true,
  disable_surveys: true,
  disable_persistence: true,
  // Keep the former key so the SDK removes legacy stored identity.
  persistence_name: "rhasia_scret_posthog",
  disable_capture_url_hashes: true,
  save_referrer: false,
  save_campaign_params: false,
  mask_all_text: true,
  mask_all_element_attributes: true,
  mask_personal_data_properties: true,
  custom_personal_data_properties: ["email", "token", "secret", "passphrase", "password", "otp", "code"],
  person_profiles: "identified_only",
  respect_dnt: true,
  advanced_disable_flags: true,
  disable_web_experiments: true,
  disable_product_tours: true,
  disable_conversations: true,
  disable_external_dependency_loading: true,
  // Console logs are deliberately disabled: third-party and application log
  // messages can contain URL fragments, labels, secrets, or stack data. Use
  // redacted automatic events and the explicit error-boundary event instead.
  logs: { captureConsoleLogs: false },
  before_send: sanitizeAnalyticsUrls,
  debug: process.env.NODE_ENV === "development",
} satisfies Partial<PostHogConfig>;
