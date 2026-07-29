# Expire Secure Share Links after seven days and allow re-invitation

## Status

Accepted

## Context

ADR-0019 introduced one-time Secure Share Links, ADR-0031 prevented duplicate pending Invitations for one recipient and Shared Vault, and ADR-0032 allowed owner cancellation but explicitly excluded automatic expiry and reissue. A pending Invitation whose link is no longer usable blocks the owner from creating a replacement, even though it has not created a Membership Grant. Owners need a bounded link lifetime and a safe way to create fresh client-generated link material for the same intended recipient.

Expiry must not reveal a Secure Share Link secret, Vault Encryption Key, Vault name, account content, or OTP to the server. Re-invitation must not reactivate an active member or bypass active-owner authorization.

## Decision

Each Invitation receives an immutable `expires_at` exactly seven days after creation. The server treats a pending Invitation as redeemable only before that instant. Expiry invalidates lookup and redemption but does not create a Membership Grant or change any existing membership.

The owner participant view retains expired Invitations and identifies them as expired. An owner may re-invite that recipient. The client generates a fresh random Secure Share Link secret, verifier, and encrypted key-handoff package. Under the existing per-Vault and normalized-email transaction lock, the server deletes matching expired pending Invitations and creates one replacement Invitation. A matching unexpired pending Invitation or active Membership Grant remains a conflict. Owner cancellation remains available for both unexpired and expired pending Invitations.

The original Secure Share Link remains unrecoverable because the server stores only its one-way verifier. Re-invitation returns only the new opaque Invitation identifier and expiry; the complete new link exists only in the owner's browser and must be delivered out of band.

Existing Invitations receive a seven-day transition window from migration time through the generated database default. New application writes set expiry from their creation instant explicitly.

## Consequences

Secure Share Links have a predictable bounded lifetime and stale Invitations no longer permanently block the intended recipient. Re-invitation invalidates the expired verifier by deleting its row and never reuses its secret or encrypted package. Owners must deliver the replacement link, and links still cannot be recovered after the browser loses them. This decision supersedes only ADR-0032's statement that pending links cannot expire or be reissued; its owner-only cancellation rules remain in force.
