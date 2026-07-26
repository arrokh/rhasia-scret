# rhasia-scret

A zero-knowledge authenticator application for personal and shared TOTP accounts.

## Language

**Vault**:
A named collection of authenticator accounts controlled by its owner and, when shared, accessible to its members.

**Vault Name**:
The user-visible name of a Vault. It is encrypted vault content rather than server-visible metadata.
_Avoid_: Plaintext vault label

**Personal Vault**:
A Vault with exactly one owner and no members other than that owner. It is Uninitialized until its owner completes secure-vault setup and cannot be deleted by the user.
_Avoid_: Private vault

**Uninitialized Personal Vault**:
A Personal Vault that exists but has no client-created Vault Encryption Key or Vault Unlock Secret yet. It cannot hold authenticator accounts or unlock shared vault access.
_Avoid_: Ready vault, empty vault

**Vault Encryption Key**:
The secret key that protects the encrypted contents of one Vault.
_Avoid_: Vault password, master key

**Vault Unlock Secret**:
An app-specific passphrase known only to the user, from which a client derives the Vault Unlock Key. The client recommends a randomly generated multi-word passphrase but accepts a user-created passphrase whose trimmed value is at least three characters long. It is separate from the authentication credential and recoverable only through previously enrolled Passkey-Assisted Recovery. The Indonesian product label is **Passphrase Brankas**.
_Avoid_: Rahasia Pembuka Brankas, PIN, Vault password, master key

**Vault Unlock Key**:
A client-derived key that unlocks the User Root Key. It is distinct from any Vault Encryption Key.
_Avoid_: Vault password, master key

**User Root Key**:
A random user-held key that protects the user’s Personal Vault Encryption Key and encrypted User Encryption Key Pair. It can be re-wrapped when the Vault Unlock Secret changes without re-encrypting vault content.
_Avoid_: Vault Unlock Key, vault key

**Passkey-Assisted Recovery**:
An optional browser-held recovery path that uses a verified WebAuthn PRF output to open an encrypted User Root Key recovery package. The server stores only credential metadata and opaque ciphertext; it has no recovery key. The same enrolled recovery package can support Passkey-Assisted Unlock without changing the configured Vault Unlock Secret. Detaching recovery deletes the server-held credential metadata and recovery package but cannot delete a passkey entry from the user's operating system or password manager.
_Avoid_: Server reset, passkey-only server decryption

**Passkey-Assisted Unlock**:
An optional alternative way to start an Unlocked Vault Session by verifying the enrolled recovery passkey and opening the User Root Key recovery package entirely in the browser. It does not change or remove the Vault Unlock Secret, is not a second authentication factor, and requires an online server-verified WebAuthn assertion.
_Avoid_: Second factor, passwordless account login, server-side vault unlock

**Destructive Personal Vault Reset**:
An authenticated, explicitly confirmed destruction path for a user who lost their Vault Unlock Secret without enrolling Passkey-Assisted Recovery. It deletes unusable Personal Vault ciphertext and cryptographic material, leaves Viewer memberships, and returns the Personal Vault to Uninitialized; it never recovers encrypted data and is blocked while the user owns an active Shared Vault.
_Avoid_: Recovery, key reset, data restoration

**Remembered Browser**:
A browser profile that holds a versioned, origin/RP-bound local WebAuthn PRF package enabling its authenticated user to recover the User Root Key after Local Verification without re-entering the Vault Unlock Secret. It is enrolled explicitly from an online Unlocked Vault Session, remains separate from server-mediated Passkey-Assisted Unlock, and falls back to the Vault Unlock Secret when PRF is unavailable or fails.
_Avoid_: Trusted device, device-bound browser, assertion-only key gate

**Local Verification**:
A browser-mediated biometric or device-PIN check whose WebAuthn PRF output cryptographically releases a Remembered Browser's encrypted User Root Key package. Generic assertion success without PRF-bound key release is insufficient.
_Avoid_: Vault Unlock Secret, server authentication, UI-only assertion gate

**Unlocked Vault Session**:
The period during which a Vault is available in an authenticated browser after it has been unlocked. It ends when the user explicitly locks the Vault or logs out.
_Avoid_: Timeout, auto-lock interval

**User Encryption Key Pair**:
A user-specific public and private key pair used to wrap Vault Encryption Keys for the user. Its private key is encrypted before server storage.
_Avoid_: Device key pair, vault key

**Honest-but-Curious Server**:
The assumed server behavior: it correctly serves the application and enforces authorization but cannot be trusted with stored encrypted data or plaintext secrets. An actively malicious application host is outside the MVP security boundary.
_Avoid_: Malicious-server-resistant, trusted key custodian

**Pre-registered User**:
A person invited through Supabase Auth by the administrator before they can access the application. A verified session from such an invited user is the application’s access gate.
_Avoid_: Public signup, self-registered user, separate email allowlist

**Key-Wrap Envelope**:
A versioned encrypted package that allows one User Encryption Key Pair to recover a Vault Encryption Key.
_Avoid_: Plaintext vault key, shared password

**Invitation**:
A no-acceptance request by a Shared Vault owner to give a pre-registered user access. It includes a one-time Secure Share Link so the recipient can complete key delivery after cryptographic enrollment. Before the recipient first signs in, the server may bind the pending Invitation to the normalized invited email as permitted authorization metadata; redemption additionally requires an authenticated session whose verified email matches, and then binds the Invitation to the provisioned Application User.
_Avoid_: Pending membership

**Secure Share Link**:
A one-time secret link delivered by the owner through a secure out-of-band channel. It is bound to the intended invited user and lets them obtain an encrypted Vault Encryption Key package without giving that key to the server. The owner may cancel a pending Invitation, which permanently invalidates its Secure Share Link; the MVP has no expiry or reissue flow.
_Avoid_: Server-visible key link, reusable sharing URL

**Membership Grant**:
An active authorization for an enrolled user to access a Shared Vault, created when the invited user redeems a Secure Share Link and receives a Key-Wrap Envelope. It does not require recipient acceptance in the MVP.
_Avoid_: Invitation, pending membership

**Membership Revocation**:
The immediate denial of all future application access for a Vault member. It cannot erase vault information that member obtained before revocation.
_Avoid_: Retroactive deletion, secret invalidation

**Vault Audit History**:
The non-sensitive record of a Vault’s security-relevant activity. It is visible only to that Vault’s owner and remains independently addressable by opaque Vault and owner identifiers after encrypted Vault content is purged. It is retained for one calendar year after Vault deletion, unless restoration clears that deadline; a later deletion starts a new retention period. It may identify the acting member by account email and an Authenticator Account only by its opaque identifier; it never stores account names, issuers, TOTP configuration, generated OTPs, or decrypted Vault content. Opening or copying a Shared Vault Authenticator Account records an Account Access event.
_Avoid_: Public activity feed, secret log, plaintext account activity

**Vault Owner**:
The sole member responsible for a Shared Vault’s membership and authenticator-account changes. The owner is also entitled to read its accounts.
_Avoid_: Admin, editor

**Vault Viewer**:
A Shared Vault member who may read accounts and generate or copy OTPs but may not change accounts or membership. A Viewer may revoke their own membership by leaving the Vault and cannot see other members, invitations, or Secure Share Links.
_Avoid_: Editor, collaborator

**Deleted Vault**:
A Vault hidden from all users and denied all application access during its 30-day recovery window, after which its encrypted content, accounts, memberships, invitations, and lifecycle row are permanently purged. Its redacted Vault Audit History remains owner-only until the separate one-year audit deadline. Only its owner may restore it before the recovery deadline.
_Avoid_: Active vault, permanent archive

**Authenticator Account**:
A TOTP configuration stored in a Vault whose secret is only available on authorized client devices. A deleted account receives an explicit purge deadline exactly 30 days after deletion, remains recoverable by its owner before that deadline, and is then permanently purged by bounded server cleanup.
_Avoid_: Token, credential

**Account Revision**:
The version of an Authenticator Account used to reject a stale change rather than silently overwrite newer encrypted content.
_Avoid_: Last-write-wins, auto-merge

**Duplicate Authenticator Account**:
An Authenticator Account whose decrypted TOTP configuration matches another account in the same Vault. It is a client-side warning, not a server-side restriction.
_Avoid_: Server-side secret fingerprint, invalid account

**Account Order**:
The presentation order of Authenticator Accounts within a Vault. The MVP derives it locally from decrypted issuer and account name rather than persisting a custom order.
_Avoid_: Server-side sort metadata, manual ordering

**OTP Copy**:
An explicit user action that writes the current OTP to the operating system clipboard. The application does not subsequently overwrite or clear that clipboard value.
_Avoid_: Automatic clipboard clearing, background copy

**TOTP Configuration**:
A supported time-based one-time-password configuration: SHA-1, SHA-256, or SHA-512; 6 or 8 digits; and a positive period. It is a normalized encrypted representation, not a stored raw URI or QR image. The MVP excludes HOTP and proprietary OTP formats.
_Avoid_: HOTP, Steam code, unsupported URI

**Clock Drift Warning**:
A client warning that its device time differs from an online server time by more than 30 seconds, so generated OTPs may fail. It does not change the device clock.
_Avoid_: Silent time correction

**Supported Browser**:
The current or previous major release of Chrome, Edge, Firefox, or Safari with Web Crypto, IndexedDB, service workers, Clipboard API, and WebAuthn user verification. Private browsing and embedded webviews are unsupported for Remembered Browser or offline behavior. PWA installation is optional.
_Avoid_: Best-effort webview support, private-mode persistence

**Local Vault Snapshot**:
An encrypted browser-stored copy of a previously synchronized Vault used for read-only offline OTP generation. On a later successful contact, it is deleted if the server reports the user no longer has access.
_Avoid_: Plaintext offline cache, offline write queue

**Encrypted Vault Archive**:
A portable, explicitly user-created versioned archive whose authenticated ciphertext contains one plaintext Vault Name and normalized TOTP configurations only while opened in client memory. Import requires user-supplied 32-byte archive key material, validates and previews all content locally, then atomically stores newly encrypted account ciphertext in an owned destination Vault or a newly created Shared Vault. It is never an unencrypted backup or server-readable export.
_Avoid_: Plaintext backup, server-side archive, recovery package
