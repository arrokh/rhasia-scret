# Allow owners to cancel pending invitations

## Status

Accepted

## Context

ADR-0019 originally excluded cancellation from the MVP. Vault owners now need to manage the people shown in the Undangan view and invalidate a Secure Share Link that was sent to the wrong person or is no longer needed.

A pending Invitation contains only permitted recipient identity metadata, a one-way link verifier, and an encrypted key-handoff package. It has not created a Membership Grant.

## Decision

The owner of an active Shared Vault may delete a pending Invitation. Deletion removes its verifier and encrypted package, so subsequent lookup or redemption returns unavailable. The operation requires active owner authorization and an exact Vault and Invitation identifier match.

Active Viewer access is not an Invitation and continues to use Membership Revocation rather than Invitation deletion. Owners cannot remove themselves through either operation.

## Consequences

Pending Secure Share Links can now be cancelled but still cannot expire automatically or be reissued. Cancellation does not expose the link secret or plaintext Vault content. The UI describes active Viewer removal as access revocation and pending Invitation removal as Invitation deletion.
