# Retain Vault Audit History for one year after deletion

## Status

Accepted

## Decision

Vault Audit History remains visible only to its owner while the Shared Vault is active and for one calendar year after Vault deletion. Restoring the Vault during its 30-day recovery period clears the audit purge deadline; a later deletion starts a new one-year period.

The Shared Vault's encrypted content, accounts, memberships, invitations, and lifecycle row are permanently removed after 30 days. Audit events therefore retain their opaque Vault ID and owner ID without a database foreign key to the Vault row. Before Vault purge, cleanup backfills those authorization fields for legacy events. Retained events contain only the existing redacted audit metadata and actor relation; they do not preserve encrypted Vault content or account labels.

Owner authorization first uses the Vault row while it exists and then the retained event owner ID after Vault purge. Other users cannot use retained history to regain Vault access. A bounded, retry-safe server job permanently deletes events at their audit deadline.

## Consequences

Incident history remains useful for the promised period without forcing encrypted Vault content or membership lifecycle records to survive for a year. The application must treat opaque owner authorization on retained events as security metadata, populate it atomically during deletion/purge, and test that non-owners cannot read it. Cleanup logs may include opaque event/Vault IDs and counts but never encrypted or decrypted content.
