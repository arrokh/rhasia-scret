# English and Indonesian i18n implementation plan

## Outcome

Make every user-facing web and native application surface available in English and Indonesian (Bahasa Indonesia) while preserving the current routes, zero-knowledge boundaries, encrypted offline behavior, and Indonesian experience as the default. Web catalog and `next-intl` work described here applies to `apps/web`; the Expo client maintains exact key parity in `apps/mobile/src/localization.ts` without importing `next-intl`.

A complete implementation includes visible copy, accessibility text, validation and error messages, dates and plurals, metadata, the web app manifest, development previews, and browser tests. API contracts, domain enums, cryptographic formats, and encrypted user content remain locale-independent.

## Current state

- `apps/web/src/app/layout.tsx` resolves `<html lang>` and localized metadata.
- `apps/web/src/app/manifest.ts` resolves the localized `lang` and description.
- Copy is embedded across 22 App Router page/layout/metadata files, 38 context presentation files, and 7 shared presentation files.
- Date formatting is fixed to `id-ID` in synchronization, account, crypto, and vault-management presentation code. Audit timestamps additionally use `Asia/Jakarta`.
- Some user-visible messages currently cross the presentation boundary as localized `Error.message` values, notably TOTP parsing, QR import, passkey recovery, workspace loading, and archive import.
- Browser and component tests generally locate elements through Indonesian accessible names and copy.
- The web implementation has a `next-intl` resolver and typed `apps/web/messages/id.json` / `apps/web/messages/en.json` catalogs. The native Expo client has a separate typed Indonesian/English catalog in `apps/mobile/src/localization.ts`; native locale state is presentation-only and is not stored in the web cookie, Prisma, encrypted content, or offline snapshots.

## Implemented decisions

These decisions are recorded in ADR-0035 and are now the maintenance contract for web and native presentation because routing and locale persistence are costly to reverse.

| Concern | Decision | Reason |
| --- | --- | --- |
| Library | Use `next-intl` with ICU messages and strict message-key typing. | It supports Next.js App Router server/client components, plurals, dates, rich text, and typed catalogs. |
| Locale identifiers | Use application locales `id` and `en`; map formatting to `id-ID` and `en-US`. | Short stable identifiers keep the preference contract simple while formatting remains deterministic. |
| Default | Default to `id`; do not silently negotiate from `Accept-Language` in the first release. | This preserves current behavior and keeps public, test, and offline rendering deterministic. |
| Routing | Keep locale out of URLs. Continue using `/`, `/vaults`, `/offline`, and `/vaults/invitations/redeem#…`. | The app uses passwordless email auth rather than SEO-led localized routes. This avoids migrations and regressions in auth callbacks, protected-route checks, PWA scope, and secret-bearing share-link fragments. |
| Persistence | Store only `id` or `en` in a first-party `RHSIA_LOCALE` cookie (`Path=/`, `SameSite=Lax`, one-year maximum age). Do not store it in Prisma, IndexedDB, or TanStack Query. | The preference is non-sensitive, works for server rendering, and does not alter server data or cached encrypted content. |
| Switching | Put an accessible language switcher on every page through the shared footer. A switch writes the cookie, refreshes the current route, and refreshes the cached offline shell when online. | Public, authenticated, and offline entry points all remain reachable without duplicating controls per context. |
| Catalog ownership | Keep two web catalogs, `apps/web/messages/id.json` and `apps/web/messages/en.json`, whose namespaces mirror bounded contexts; keep the native catalog in `apps/mobile/src/localization.ts` with exact key parity. | Translators get conventional web files while keys preserve domain ownership (`Identity`, `VaultManagement`, `OtpRuntime`, and so on). Catalogs contain copy only, never behavior. |
| Error boundary | Domain, application, and infrastructure code expose typed errors or stable error codes. Presentation maps those codes to catalog keys. | `next-intl` must not enter domain/application/infrastructure layers, and raw localized `Error.message` values must not become contracts. |
| Existing URLs and APIs | Do not translate route paths, query parameter values, API error codes, enum values, audit event types, archive versions, or cryptographic names. | These are machine contracts rather than copy. |
| Destructive reset token | Keep the ADR-0025 token `HAPUS DATA BRANKAS` identical in both locales; translate the instructions and warnings around it. | Changing or accepting another token changes a security-sensitive application contract and needs a separate ADR amendment. |
| Product terminology | Keep `rhasia-scret` unchanged. Use **Passphrase Brankas** in Indonesian and **Vault Passphrase** in English as the product labels for the domain term Vault Unlock Secret. | This remains distinct from an authentication password or a Vault Encryption Key. Add the English label to `CONTEXT.md`. |
| Time zones | Preserve current semantics: device-local time for snapshots/enrollment and `Asia/Jakarta` for audit history, while localizing each output's language. | Localization should not silently change the instant or time-zone meaning currently shown. |

### Deliberate trade-off

Reading the locale cookie in the root layout makes otherwise static public/preview routes request-rendered. This is acceptable for the email-authenticated application and is the cost of localized server-rendered accessibility text without changing URLs. Record this explicitly in the ADR.

## Target structure

```text
apps/web/messages/
  id.json                       # canonical key shape and current Indonesian copy
  en.json                       # exact English key parity
apps/web/src/i18n/
  config.ts                     # locales, default, cookie name, validation/mapping
  request.ts                    # request-scoped locale and selected messages
  locale-provider.tsx           # selected next-intl client provider
  locale-switcher.tsx           # accessible cookie + refresh behavior
apps/web/src/types/next-intl.d.ts # AppConfig Locale/Messages augmentation
apps/mobile/src/localization.ts # native Indonesian/English catalog
apps/web/src/app/layout.tsx    # resolved lang and provider
apps/web/src/app/manifest.ts   # localized description/lang
```

Catalog namespaces should follow the existing ownership model:

```text
Common
Metadata
Home
Preview
Identity
Crypto
VaultManagement
VaultMembership
AuthenticatorAccount
OtpRuntime
Sync
VaultArchive
```

Keys describe meaning rather than source text, for example `VaultManagement.destructiveReset.warningTitle`, not `VaultManagement.hapusDataTerenkripsi`.

## Request and switch flow

1. `src/i18n/request.ts` reads `RHSIA_LOCALE` through `cookies()`.
2. `resolveLocale` accepts only `id` or `en`; a missing, malformed, or unsupported value falls back to `id`.
3. The root layout sets `<html lang={locale}>` and passes only the selected catalog to `NextIntlClientProvider`.
4. Server components use `getTranslations`/`getFormatter`; client components use `useTranslations`/`useFormatter`.
5. The language switcher writes the validated cookie and calls `router.refresh()` so server and client component copy change together without changing the URL.
6. When a service worker controls the page, an online locale switch asks it to re-fetch `/offline` with credentials and replace the cached offline shell. Increment the static cache version when this behavior ships.
7. If the device is offline, keep the last cached locale and explain that changing the offline language requires reconnecting. Do not queue a server mutation.

The locale and catalogs must never be placed in TanStack Query state, Local Vault Snapshots, cryptographic payloads, or mutation closures.

## Translation boundary rules

### Translate

- Headings, paragraphs, buttons, links, menu items, tabs, badges, empty states, banners, dialogs, and progress text.
- `aria-label`, `title`, placeholders, screen-reader live regions, and image descriptions where non-empty.
- TanStack Form validation messages and field guidance.
- User-visible error and status messages.
- Counts through ICU plural/select messages rather than string concatenation.
- Dates and relative times through `next-intl` formatters.
- Metadata descriptions, manifest description/lang, and development preview/smoke copy.

### Do not translate

- Product name `rhasia-scret` and user-provided encrypted Vault/account names.
- Email addresses, OTP values, URLs, IDs, API paths, query keys, response error codes, and database strings.
- `otpauth://totp`, Base64, AES-GCM, Argon2id, WebAuthn, PRF, TOTP, OTP, and fixed role/enum values when used as protocols.
- Developer-only invariant errors that cannot reach the UI.
- The exact destructive-reset confirmation token unless ADR-0025 is separately changed.

### Replace localized error leakage

Do not render `reason.message` directly. Introduce stable classifications where localized errors currently escape lower layers:

- `src/modules/otp-runtime/domain/totp-configuration.ts`: typed parse error codes such as `invalid_uri`, `missing_secret`, and `unsupported_algorithm`; localize them in OTP and account presentation.
- `src/modules/vault-archive/infrastructure/browser-vault-import-client.ts` and archive workflow errors: retain typed import failure reasons; localize in `vault-archive-importer.tsx`.
- `src/modules/crypto/presentation/passkey-recovery-enrollment.tsx`: change `passkeyRecoveryEnrollmentErrorMessage` into an error classifier, then translate the classifier result.
- QR, workspace unlock, account creation, and browser enrollment flows: store statuses/error codes in component state rather than completed Indonesian sentences.
- Keep server API errors as the existing stable machine codes and map them only in owning presentation components.

This refactor changes presentation mechanics, not encryption, authorization, or server-visible data.

## Implementation sequence

Each step should leave both catalogs at exact key parity and keep lint, typecheck, and the affected test projects green.

### 1. Record terminology and i18n architecture

- Add the English **Vault Passphrase** product label to `CONTEXT.md` without changing the authoritative Vault Unlock Secret domain term.
- Add an ADR covering `next-intl`, cookie-based locale selection, Indonesian default, unchanged routes, no database preference, request-rendering trade-off, and the invariant destructive-reset token.
- Add a checklist/inventory of all user-facing App Router, shared presentation, and context presentation files.

**Commit:** `docs(i18n): record locale and terminology decisions`

### 2. Add the locale foundation and public switch

- Add `next-intl` with pnpm and wrap `next.config.ts` with its plugin.
- Add locale validation, request configuration, typed message augmentation, and initial catalogs.
- Make `src/app/layout.tsx` resolve the locale, set `html[lang]`, install the provider, and generate localized metadata.
- Add the global language switcher to `AppFooter`; labels should be `Bahasa Indonesia` and `English`, with the selected language exposed accessibly.
- Translate shared primitives (`PageHeader` defaults, confirmation cancel action, password visibility, navigation progress) and the public sign-in/auth-notice journey.
- Localize `src/app/manifest.ts` while keeping app name, `start_url`, scope, icons, and colors unchanged.

**Commit:** `feat(i18n): add typed locale foundation and public switch`

### 3. Translate setup, unlock, and recovery

- Migrate Identity and Crypto presentation copy.
- Migrate Personal Vault setup, unlock, logout, Remembered Browser, Passkey-Assisted Unlock/Recovery, and destructive reset surfaces.
- Convert passkey and browser-enrollment error message helpers to stable classifications.
- Preserve all security warnings and the distinction between authentication, Vault Passphrase, recovery, and destructive reset.
- Add English and Indonesian unit/component coverage for validation, dialogs, and error states.

**Commit:** `feat(i18n): translate vault access and recovery journeys`

### 4. Translate authenticator-account and OTP journeys

- Migrate account list, creation, edit/delete, QR camera/upload/manual entry, local TOTP, countdown, clipboard, and clock-drift copy.
- Replace localized TOTP parser errors with typed domain error codes and presentation mappings.
- Use ICU plurals for account counts, seconds, unavailable Shared Vault counts, and similar dynamic text.
- Keep issuer, account name, secret, and generated OTP strictly as runtime interpolation values; never place them in catalogs.

**Commit:** `feat(i18n): translate account and OTP journeys`

### 5. Translate Shared Vault management

- Migrate the Vault directory, create/rename/delete/recover flows, Owner/Viewer labels, invitations, Secure Share Link handling, participant management, and audit history.
- Map audit event enums to translation keys with an exhaustive record; unknown future events get a safe localized fallback.
- Localize audit dates and relative times while retaining `Asia/Jakarta`.
- Use ICU plurals for member, invitation, Vault, and activity counts.

**Commit:** `feat(i18n): translate shared vault management`

### 6. Translate offline synchronization and archive import

- Migrate offline shell, sync-state labels, snapshot timestamps, stale/read-only warnings, and no-replay explanations.
- Migrate archive preview/import copy, validation, duplicate handling, and typed failure mappings.
- Extend `public/sw.js` with a narrowly scoped locale-refresh message that only replaces `/offline`; continue excluding API/auth requests and user data from Cache Storage.
- Increment `CACHE_VERSION` and update offline architecture/browser tests.
- Verify an English shell selected while online can boot offline and still decrypt only the existing encrypted IndexedDB snapshot client-side.

**Commit:** `feat(i18n): translate offline and archive journeys`

### 7. Complete previews, tests, and hard-coded-copy audit

- Translate all `/ui-preview` and `/smoke` routes.
- Update test helpers so locale-sensitive accessible names come from the selected test catalog rather than duplicated literals where practical.
- Run an AST-based i18n inventory test over App Router pages and presentation directories. It should flag untranslated JSX text and translatable accessibility attributes while allowing routes, class names, technical constants, fixture data, and branding.
- Add an architecture test that permits `next-intl` only in `src/i18n`, `src/app`, shared presentation, and context presentation; domain/application/infrastructure layers must remain framework-free.
- Remove fixed `id-ID` formatters outside i18n configuration/tests and audit intentional non-translated strings.

**Commit:** `test(i18n): enforce bilingual catalogs and presentation boundaries`

## Test plan

### Unit and architecture

- Locale resolver accepts `id`/`en` and falls back to `id` for missing or invalid cookies.
- `id.json` and `en.json` have recursively identical keys, only non-empty message values, and valid ICU syntax.
- Strict TypeScript rejects unknown namespaces/message keys.
- Language switcher writes only the allowed locale cookie and updates the selected state/accessibility label.
- Representative server and client components render both locales.
- TOTP, archive, passkey, and browser error classifiers are exhaustive and locale-independent.
- Date tests use fixed timestamps/time zones and assert both Indonesian and English output.
- No `next-intl` imports exist below presentation, and no raw locale-specific formatter remains in runtime presentation code.
- Existing TanStack Form, TanStack Query, direct-fetch, sensitive-data, and dependency-cruiser inventories remain green.

### Contract

- Auth and API paths are unchanged.
- API payloads/error codes are identical under `id` and `en` cookies.
- The manifest returns the matching `lang`/description without changing scope, `start_url`, or icons.
- The destructive reset endpoint continues to accept only `HAPUS DATA BRANKAS`.
- Protected-route redirects continue to land on `/` and render the active cookie locale.

### Browser

- No cookie renders Indonesian and `html[lang="id"]`.
- Switching to English changes visible and accessible copy, sets `html[lang="en"]`, survives reload/navigation/logout, and does not change the pathname.
- Switching back to Indonesian behaves symmetrically.
- Run the existing end-to-end security workflows with an explicit `id` cookie to preserve the baseline.
- Add English smoke coverage for sign-in, setup/unlock, one account/OTP action, one Shared Vault management surface, and one validation/error state.
- Pre-cache and boot `/offline` in each locale; confirm Cache Storage still contains no API/auth response and IndexedDB still contains no plaintext Vault/account/OTP/key material.
- Verify language switching never changes or exposes the fragment secret in a Secure Share Link.

### Final quality gate

From the configured mise toolchain:

```bash
mise install
mise run setup
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run test:architecture
pnpm run test:browser
pnpm run build
```

## Acceptance criteria

- Every production and preview UI surface has complete English and Indonesian copy, including accessibility and error states.
- Indonesian remains the no-cookie default and retains the existing meaning and security warnings.
- A user can switch language globally and the choice persists without locale-prefixed URLs or database writes.
- Selected language is reflected by `html[lang]`, metadata, date/plural formatting, and the web app manifest.
- The last selected online language is available in the cached read-only offline shell.
- Translation code is confined to presentation/composition boundaries; APIs and domain/application behavior remain locale-independent.
- No plaintext secret, OTP, encrypted-content label, key material, share-link secret, or decrypted content enters a catalog, locale cookie, Query cache, or service-worker cache.
- All required quality commands pass.

## Ongoing maintenance rule

This plan and ADR-0035 apply to future changes as well as the initial implementation. Every new or changed production/preview presentation surface must update Indonesian and English catalogs in the same change, preserve exact key parity and locale-independent lower-layer contracts, and add or update the relevant unit, architecture, contract, browser, accessibility, or offline coverage. Repository agents must follow the localization section in `AGENTS.md` and must not reintroduce hard-coded translatable copy.

## Out of scope

- Locale-prefixed or translated URLs.
- Automatic browser-language negotiation.
- A server/database-backed per-user locale preference.
- Translator SaaS, machine translation at runtime, or an admin translation UI.
- Additional languages, RTL layout, or localized user-provided Vault/account content.
- Changing the ADR-0025 destructive-reset token.
