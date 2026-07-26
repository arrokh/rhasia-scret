# Bind invitations by verified email before application-user provisioning

## Status

Accepted

## Context

A pre-registered user exists first in Supabase Auth, while `application_users` is provisioned only after that user completes their first verified sign-in. Requiring a recipient Application User row when an owner creates an Invitation prevents the owner from creating the Secure Share Link before the recipient first signs in, contradicting the one-time link workflow in ADR-0019.

The server must bind an Invitation to the intended identity without receiving a Vault Encryption Key, Secure Share Link secret, or decrypted Vault content. Public signup remains disabled.

## Decision

A pending Invitation may store the normalized invited email as authorization metadata before `recipient_user_id` exists. The server stores only the email, the one-way Secure Share Link verifier, and the encrypted key-handoff package.

The owner cannot invite their own email, a user with active membership, or an identity that already has a pending Invitation for the Vault. Creation is serialized per Vault and normalized email to prevent duplicate concurrent pending Invitations.

Lookup and redemption require an active authenticated Application User whose verified session email matches the pending Invitation. Successful one-time redemption binds `recipient_user_id`, activates Viewer membership, and marks the Invitation redeemed in one serialized database transaction. Existing Invitations already bound by user identifier remain redeemable.

## Consequences

Owners can create Invitations for administrator-pre-registered users before those users first sign in or complete cryptographic enrollment. The database learns the invited email as permitted authorization metadata, but it never receives the Secure Share Link secret, usable Vault Encryption Key, plaintext Vault name, Authenticator Account content, or OTP. An arbitrary email cannot redeem unless Supabase Auth admits and verifies a session for that address.
