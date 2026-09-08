# Web and mobile release process

This document defines the repeatable release boundary for the web application,
the platform-neutral client package, and the Expo iOS/Android clients. It is a
repository process, not a claim that the current checkout is ready for a public
release.

## Version source of truth

The root `package.json` `version` is the product release version. The web,
mobile, and `client-vault-core` package versions plus `apps/mobile/app.config.ts`
must match it exactly. `pnpm run verify:version-alignment` enforces this rule
and runs in the main-push quality workflow.

The embedded `apps/mobile/modules/native-argon2id` library keeps its own native
module version metadata because it is an implementation dependency, not a
separately shipped product. Its version must not be used as the mobile app
release version.

Use SemVer:

| Change | Version rule | Compatibility requirement |
| --- | --- | --- |
| Patch | `x.y.Z` | Security fixes, bug fixes, and dependency updates with no protocol or migration contract change. |
| Minor | `x.Y.z` | Backward-compatible product capabilities and additive API/database changes. Existing released clients continue to read their permitted data. |
| Major | `X.y.z` | Breaking API, encrypted-protocol, authentication, database, or client behavior. Publish migration and upgrade guidance before the tag. |

Protocol/envelope versions are separate from the product version. A crypto or
wire-format change requires an ADR, explicit reader/writer compatibility,
synthetic cross-platform vectors, migration or rollback behavior, and a security
review. Never infer protocol compatibility from a matching package version.

## Compatibility and rollout rules

- Database migrations use an expand-and-contract sequence: deploy additive
  schema first, deploy code that can read both shapes, backfill through an
  idempotent bounded operation, then remove obsolete schema only in a later
  release. Do not roll back application code across a destructive migration
  without an approved recovery plan.
- Web releases must preserve the service-worker update/lock behavior and the
  tested Cache Storage boundary. Run the PWA and browser checks from
  [`offline-pwa-verification.md`](offline-pwa-verification.md) against the
  release candidate; a stale client must not display a server-derived workspace
  before the tested update path completes.
- Native releases use the stable identifiers `com.arrokh.rhasiascret` and the
  verified-link configuration in
  [`mobile-release-configuration.md`](mobile-release-configuration.md). Store
  build numbers are monotonic per platform and are managed by the signing/
  release system; they are not secrets and do not replace the SemVer product
  version.
- Distributed native builds must omit
  `EXPO_PUBLIC_NATIVE_CRYPTO_VALIDATION=1`. Validation builds are local
  diagnostics only and must never be uploaded to a store.

## Release-candidate workflow

1. Confirm the launch issue dependencies are complete or have a maintainer-
   approved exception. A missing production or independent-review artifact is
   `Not Verifiable`, not Pass.
2. Update the root version, all aligned manifests, `CHANGELOG.md`, and any
   user-facing release notes in one change. Run
   `pnpm run verify:version-alignment`.
3. Start from a clean checkout using Node.js `24.19.0`, pnpm `11.17.0`, and
   the mise-managed commands:

   ```bash
   mise install
   mise run setup
   pnpm install --frozen-lockfile
   pnpm run verify:ci-policy
   pnpm run verify:version-alignment
   pnpm run test:full
   ```

4. Capture the separate native evidence required by the mobile release guide:

   ```bash
   mise exec -- pnpm --dir apps/mobile run build:android-native
   mise exec -- pnpm --dir apps/mobile run build:ios-simulator
   mise exec -- pnpm --dir apps/mobile run test:android-native
   ```

   Add signed-device, verified-link, store metadata, and real-device results
   to the release evidence record. Simulator or JavaScript bundle evidence does
   not substitute for those checks.
5. Build from the tagged commit in a clean runner. Record the commit SHA,
   dependency lockfile digest, web build output digest, native artifact
   digests, toolchain versions, and the exact command exit statuses. Keep
   provenance and logs free of environment files, provider tokens, cookies,
   Vault material, OTPs, QR data, or decrypted content.
6. Deploy web/database changes through the documented migration order. Run the
   public health/header smoke test, provider configuration checks, retention
   scheduler check, and rollback-target check before enabling traffic.
7. Validate the signed iOS/Android artifacts and HTTPS association endpoints.
   Confirm production builds do not contain validation diagnostics or secrets.
8. Have the maintainer review the completed readiness record. Only then create
   an annotated `vX.Y.Z` tag and GitHub Release whose notes are copied from the
   changelog. Do not publish a tag while the decision is `HOLD`.

## Provenance, signing, and rollback

Signing credentials, provider secrets, deployment credentials, Apple Team IDs,
Android App Signing fingerprints, and database credentials stay in the approved
secret manager or release environment. They never enter Git, `.env.example`,
logs, artifacts, issue comments, or release notes.

Retain the previous known-good web artifact, native artifacts, migration state,
commit SHA, and release evidence until the new release passes its observation
window. A web rollback may restore the prior artifact only when the database
schema remains compatible. A suspected dependency, CI, or artifact compromise
requires the containment and cache/artifact invalidation steps in
[`security/incident-response.md`](security/incident-response.md), not only a
version rollback.

## Release record

Create one dated record under `docs/release-readiness/` for each candidate. It
must contain:

- candidate/product version, commit SHA, tag status, and launch decision;
- issue/PR links and explicit exceptions with owner and expiry;
- repository gate and native evidence with exact commands and results;
- provider, database, deployment, backup/restore, monitoring, and incident
  exercise evidence, or `Not Verifiable` when unavailable;
- artifact/provenance and signing evidence without secrets; and
- rollback target, observation window, and maintainer sign-off.
