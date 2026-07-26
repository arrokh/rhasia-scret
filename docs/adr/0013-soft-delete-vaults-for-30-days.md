# Soft-delete Vaults for 30 days

## Status

Accepted

## Decision

Only an owner may delete a Shared Vault. Deletion immediately hides the Vault and denies all application access while retaining encrypted records for a 30-day recovery window. The delete transaction stores both `deletedAt` and an explicit `purgeAfter` deadline. The owner may restore only before that deadline; restoration atomically clears both fields.

At or after `purgeAfter`, bounded server cleanup permanently removes the Shared Vault's encrypted content, Authenticator Accounts, memberships, invitations, and lifecycle row. PostgreSQL row locks and deadline predicates make cleanup safe under concurrent restore and overlapping workers: a restore that commits first cannot subsequently be purged, while a purge that commits first makes restore unavailable.

Redacted Vault Audit History follows its independent one-year policy in ADR 0017. Deletion cannot erase information members obtained before deletion.
