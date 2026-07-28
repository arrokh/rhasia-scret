# Soft-delete Authenticator Accounts for 30 days

## Status

Accepted

## Decision

Owners soft-delete Authenticator Accounts. ADR-0035 amends the actor authorization: a Shared Vault member with effective delete permission may also soft-delete an account, while restoration remains owner-only. Deletion immediately hides the account from authorized clients and atomically stores `deletedAt` plus an explicit `purgeAfter` deadline exactly 30 days later. Restoration is permitted only before that deadline and clears both fields while advancing the Account Revision.

At or after `purgeAfter`, a bounded server cleanup job permanently deletes the ciphertext record. Its atomic deadline predicate and PostgreSQL row locking make repeated, overlapping, or restore-racing cleanup safe: a successfully restored account cannot then be purged.

Cleanup never reads or logs encrypted payloads. Deleting an account does not revoke a TOTP secret previously learned by another person; that requires resetting 2FA at the original service.
