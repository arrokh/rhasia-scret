# Privacy-safe analytics events

The sole web client retains a typed product-event contract in `apps/web/src/shared/infrastructure/browser-analytics-config.ts`. Product events are not transmitted on any route. PostHog receives aggregate page/performance events, redacted public click/submit interactions, bounded exception types, and the bounded error-boundary event on `/`, `/landing`, `/privacy`, and `/support` when its public configuration is enabled. The application never identifies a PostHog user.

## Event catalog

### Application and authentication

- `authentication_sign_in_link_requested` — `method`
- `authentication_sign_in_link_request_failed` — `method`, `failure_code`
- `authentication_session_established`
- `authentication_signed_out`

`method` is currently `email`. The sign-in event means that the provider accepted the request to send a link; it does not claim that the link was opened or that a session was established.

### Hosted Vault lifecycle

- `personal_vault_initialized`
- `personal_vault_initialization_failed`
- `shared_vault_created`
- `shared_vault_creation_failed`
- `shared_vault_renamed`
- `shared_vault_deleted`
- `vault_unlocked` — `method`: `passphrase`, `remembered_browser`, or `passkey`
- `vault_unlock_failed` — `method`, `failure_code`
- `remembered_browser_enabled`
- `remembered_browser_removed`
- `passkey_recovery_enabled`
- `passkey_recovery_reset_completed`
- `personal_vault_reset_completed`

### Offline Personal Vault access

- `offline_vault_unlocked` — `method`: `passphrase` or `remembered_browser`
- `offline_vault_unlock_failed` — `method`, `failure_code` from the bounded client allowlist
- `offline_vault_locked`
- `offline_vault_cleared`

These events describe use of the read-only Personal Vault snapshot; they do not indicate offline Shared Vault access or queued mutations.

### Shared Vault collaboration

- `shared_vault_invitation_created`
- `shared_vault_invitation_reissued`
- `secure_share_link_redeemed`
- `shared_vault_participant_removed` — `participant_type`: `member` or `invitation`
- `shared_vault_default_permissions_updated`
- `shared_vault_member_permissions_updated`
- `shared_vault_operation_failed` — `operation`, `failure_code`

### Authenticator Account usage

- `authenticator_account_created` — `vault_type`, `PERSONAL` or `SHARED`
- `authenticator_account_updated` — `vault_type`
- `authenticator_account_deleted` — `vault_type`
- `authenticator_account_operation_failed` — `operation`, `failure_code`

### Archive workflows

- `vault_archive_export_prepared` — `vault_type`
- `vault_archive_import_completed` — `account_count`, `destination_type`, `created_new_vault`

### Account deletion

Account deletion is intentionally absent from the browser/PostHog event catalog. The
server records only a non-user-linked aggregate metric with authentication
backend and bounded counts for deleted or transferred Shared Vaults and
Authenticator Accounts. It never stores an Application User ID, email,
provider subject, receipt ID, Vault ID, Vault Name, or TOTP data in the metric,
and it never resets analytics identity or emits an identified deletion event.

### Local Vault

- `local_vault_created`
- `local_vault_unlocked` — `method`: `passphrase`
- `local_vault_unlock_failed` — `method`, `failure_code`
- `local_vault_migrated`
- `local_vault_locked`
- `local_vault_cleared`
- `local_vault_renamed`
- `local_vault_archive_export_prepared` — `account_count`
- `local_vault_archive_import_completed` — `account_count`
- `local_authenticator_account_created`
- `local_authenticator_account_updated`
- `local_authenticator_account_deleted`

`client_error` is reserved for the existing redacted error boundary telemetry (`error_name`, `error_digest`) and is not a product funnel event. Personal-only snapshot migration, Shared Vault eviction, and workspace protocol failures add no analytics events; if operational measurements are added, they remain bounded and contain no user, Vault, account, ciphertext, key, OTP, or label data.

## Analysis guidance

The event names below remain as typed client definitions, but they are not
currently available for PostHog funnels or trends. Re-enabling product-event
collection requires a separate privacy and security review. Do not use raw
URLs, event properties, or PostHog autocapture to recover labels or
identifiers. Browser persistence stays disabled because the SDK can retain
session URL properties before `before_send` runs.

## Automatic reports and operational views

The browser SDK explicitly enables only these automatic reports on public
routes, along with the bounded error-boundary event:

- **Web Analytics / page reports:** `$pageview` and `$pageleave`. Only `/`, `/landing`, `/privacy`, and `/support` are allowed. Query strings, fragments, credentials, titles, DOM text, and element attributes are removed.
- **Public interactions:** click/submit events are limited to links and buttons. DOM text, attributes, and URL values are removed; each remaining event represents a redacted interaction on a public path.
- **Web Vitals:** `$web_vitals` for LCP, CLS, FCP, and INP. Only bounded numeric metric values survive the client sanitizer; attribution objects and navigation URLs do not.
- **Live traffic:** PostHog Live Events contain public page, performance, redacted interaction, and bounded exception events only; application routes produce no events.
- **Installation health:** use PostHog's deployment/project health view and the event delivery/request error indicators. Keep staging and production projects separate.
- **Error tracking:** unhandled errors and promise rejections are enabled; console capture is disabled. Automatic exceptions retain only a bounded error type. The explicit `client_error` event retains only a bounded error name and digest.
- **Logs:** browser console-log capture is intentionally disabled. PostHog browser log records attach current URL metadata outside the event `before_send` sanitizer, so arbitrary browser logs would violate the privacy contract. Do not enable console logs until a URL-redacting log hook is available.

The sanitizer is allowlist-first at runtime: unknown automatic events and explicit events are dropped, event properties are validated by event name, counts are bounded, and only fixed enum values are accepted. The unit tests in `src/tests/unit/shared/browser-analytics.test.ts` are the contract for this policy.

## Configure in PostHog

The application sends public-only analytics; dashboards and insights are configured in the PostHog project. Repeat the smoke check after each analytics-policy change. Product-event funnels listed in the typed catalog cannot receive new events under ADR-0062.

1. Confirm the deployed environment has `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` set to the intended PostHog project. Keep staging and production in separate projects when possible.
2. Deploy to staging, open one of the allowed public pages, and verify that only a sanitized pageview and aggregate Web Vitals are received. Do not use real or user-provided Vault names, account labels, email addresses, secrets, or QR data during the test.
3. Create a dashboard from **Dashboards → New dashboard → Blank dashboard**, name it `RHSIA Public Page Health`, and add pageview and Web Vitals insights only. See the [PostHog dashboard documentation](https://posthog.com/docs/product-analytics/dashboards) for dashboard filters, date ranges, and sharing. Set a shared date range such as **Last 30 days** after data is available; use **Last 7 days** for the operating view.
4. Share the dashboard only with the intended team, and review the received properties once after deployment. If an unexpected property appears, disable the integration and update the sanitizer test before re-enabling it.
