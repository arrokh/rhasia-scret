# Privacy-safe analytics events

PostHog receives explicit product events from the browser through the typed contract in `apps/web/src/shared/infrastructure/browser-analytics-config.ts`. These events are intentionally aggregate-only so they can describe adoption and reliability without identifying Vault content.

## Event catalog

### Application and authentication

- `application_opened`
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

`client_error` is reserved for the existing redacted error boundary telemetry (`error_name`, `error_digest`) and is not a product funnel event.

## Analysis guidance

`authentication_sign_in_link_requested` is an anonymous pre-authentication signal. It means that the provider accepted the request to send a link; it should be analyzed separately from identified post-login events. `authentication_session_established` is emitted only after the browser has identified the authenticated user with the SHA-256-derived identifier, so it is the correct starting point for authenticated funnels. Use unique users for funnel conversion and treat event totals as activity, not sessions.

Recommended PostHog views are:

1. New-user activation funnel: `authentication_session_established` → `personal_vault_initialized` → `vault_unlocked` → `authenticator_account_created`.
2. Shared collaboration: `shared_vault_created` → `shared_vault_invitation_created` → `secure_share_link_redeemed` → `authenticator_account_created` filtered to `vault_type = SHARED`.
3. Unlock reliability: compare each successful unlock event with its matching `*_unlock_failed` event by method.
4. Local adoption: compare local Vault creation, unlock, account, archive, and clear events separately from hosted Vault activity.

Do not use raw URLs, event properties, or PostHog autocapture to recover labels or identifiers. Protected routes remain limited to redacted automatic page/performance events, and browser persistence is disabled because PostHog can retain session URL properties before `before_send` runs.

## Automatic reports and operational views

The browser SDK explicitly enables only these automatic reports:

- **Web Analytics / page reports:** `$pageview` and `$pageleave`, with static route paths preserved and dynamic segments replaced by `[redacted]`. Query strings, fragments, credentials, titles, DOM text, and element attributes are removed.
- **Web Vitals:** `$web_vitals` for LCP, CLS, FCP, and INP. Only bounded numeric metric values survive the client sanitizer; attribution objects and navigation URLs do not.
- **Live traffic:** use PostHog Live Events over the same sanitized event stream. Do not enable raw-property inspection for protected-route events.
- **Installation health:** use PostHog's deployment/project health view and the event delivery/request error indicators. Keep staging and production projects separate.
- **Error tracking:** unhandled errors and promise rejections are enabled; console capture is disabled. Automatic exceptions retain only a bounded error type. The explicit `client_error` event retains only a bounded error name and digest.
- **Logs:** browser console-log capture is intentionally disabled. PostHog browser log records attach current URL metadata outside the event `before_send` sanitizer, so arbitrary browser logs would violate the privacy contract. Do not enable console logs until a URL-redacting log hook is available.

The sanitizer is allowlist-first at runtime: unknown automatic events and explicit events are dropped, event properties are validated by event name, counts are bounded, and only fixed enum values are accepted. The unit tests in `src/tests/unit/shared/browser-analytics.test.ts` are the contract for this policy.

## Configure in PostHog

The application only sends events; dashboards and insights are configured in the PostHog project. Complete this once per PostHog project and repeat the smoke check after each event-contract change.

1. Confirm the deployed environment has `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` set to the intended PostHog project. Keep staging and production in separate projects when possible.
2. Deploy to staging, perform one controlled test flow, and verify the events appear with only the documented properties. Do not use real Vault names, account labels, email addresses, secrets, or QR data during the test.
3. In PostHog, open **Product analytics → New insight**, choose **Funnel**, add the events in order, and save the insight. See the [PostHog funnel documentation](https://posthog.com/docs/product-analytics/funnels) for the current funnel editor. PostHog supports sequential, strict-order, and any-order funnels; use sequential for the flows above unless the product requirement explicitly demands strict adjacency.
4. Create a dashboard from **Dashboards → New dashboard → Blank dashboard**, name it `RHSIA Product Analytics`, and add the saved insights. See the [PostHog dashboard documentation](https://posthog.com/docs/product-analytics/dashboards) for dashboard filters, date ranges, and sharing. Set a shared date range such as **Last 30 days** after data is available; use **Last 7 days** for the operating view.
5. Add these initial insights:
   - **Authenticated activation:** funnel from `authentication_session_established` to `authenticator_account_created`; add a breakdown by `vault_type` only on the account-created step or use a separate hosted/shared insight.
   - **Authentication reliability:** trends for `authentication_sign_in_link_requested` and `authentication_sign_in_link_request_failed`, broken down by `failure_code`.
   - **Unlock reliability:** trends for `vault_unlocked` and `vault_unlock_failed`, broken down by `method` and `failure_code`.
   - **Shared collaboration:** funnel from `shared_vault_created` to `secure_share_link_redeemed`, then a separate trend for `authenticator_account_created` filtered to `vault_type = SHARED`.
   - **Local adoption:** trends for `local_vault_created`, `local_vault_unlocked`, `local_authenticator_account_created`, and `local_vault_archive_import_completed`.
6. Share the dashboard only with the intended team, and review the raw event properties once after deployment. If an unexpected property appears, pause the dashboard rollout and update the sanitizer test before adding more insights.
