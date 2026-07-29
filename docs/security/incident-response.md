# Security incident-response runbook

This runbook is intentionally provider- and deployment-neutral. Record only opaque incident IDs, timestamps, operation classes, and redacted actor/Vault identifiers. Never paste Vault Names, account labels, TOTP configuration, OTPs, QR data, secrets, keys, ciphertext contents, cookies, access tokens, or authorization headers into tickets or chat.

## First response

1. Open a redacted incident record and assign an incident commander, security lead, communications lead, and release/deployment owner.
2. Preserve deployment, dependency, CI, auth, database, cache, and audit evidence without copying sensitive payloads.
3. Determine whether the event affects hosted client delivery, a dependency/action, server credentials, an authenticated session, a Vault/member authorization boundary, or availability/retention.
4. Freeze unrelated deploys and destructive cleanup jobs when doing so does not increase exposure. Do not disable encryption, authorization, audit redaction, revision checks, or rate limits as a workaround.

## Client or hosted-application compromise

- Stop serving the compromised build, revoke the deployment, and force a known-good client update/rollback.
- Compare deployed artifact hashes/provenance with the approved release and review CSP/headers, source-map exposure, service-worker caches, and CDN behavior.
- Treat secrets opened while the compromised client was active as exposed. Notify affected users with service-specific TOTP reset guidance; deleting Vault ciphertext does not revoke credentials already learned.
- Revoke server sessions and clear server-derived workspaces/Remembered Browser packages where appropriate. Preserve independent Local Profile ciphertext and explain that an actively malicious host can observe opened Local Vault secrets.

## Dependency, CI, or artifact compromise

- Pin/replace the affected package or action at a verified patched commit, invalidate affected caches/artifacts, and rebuild from a clean runner.
- Review lockfile changes, install scripts, generated Prisma clients, deployment provenance, secret-scanning results, and all releases built during the exposure window.
- Rotate any server credential or signing key that the compromised workflow could access. Do not log the old or new secret.

## Server credential or provider compromise

- Revoke/rotate Supabase service credentials, database credentials, deployment tokens, and provider keys through the operator-approved channel.
- Review database access, RLS/Data API exposure, replication, backups, logs, audit history, and provider Security Advisor evidence. Assume stored ciphertext may be copied but remains protected by client-only key material unless a client/key path was also compromised.
- Re-run authorization, retention, rate-limit, migration, and redaction checks before restoring writes.

## Stolen session or authentication compromise

- Revoke the affected provider session(s), review session IDs/freshness, and clear unlocked server workspaces and snapshots.
- Review user switching, invitation/admission, identity-linking, and sensitive-operation events. Do not automatically link or transfer identities by email.
- The Local Profile is independent: preserve it unless the user explicitly clears it, and require a separate local action for any copy.

## Vault/member compromise

- Revoke membership authorization immediately and review redacted Vault Audit History by opaque Vault/account IDs.
- Remember that revocation cannot erase ciphertext or TOTP secrets previously obtained by a member. Advise reset/re-enrollment at the original service when a TOTP secret may have been exposed.
- For a suspected key compromise, follow the approved key-rotation/recovery ADR; do not claim that deletion alone is cryptographic remediation.

## Recovery, rollback, and notification

- Restore only from verified encrypted backups and separately retained archive keys. Never upload archive keys or plaintext to the service.
- For interrupted envelope migration, retain the last valid ciphertext, reject stale revisions/key versions, and resume only through the explicit context-bound migration path.
- Notify affected users with scope, dates, known/possible data exposure, actions taken, and safe next steps. Do not include secrets or decrypted content.
- Close only after root cause, containment, eradication, recovery, user notification, evidence retention, and a post-incident control update are recorded.
