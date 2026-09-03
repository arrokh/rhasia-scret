# rhasia-scret

A zero-knowledge authenticator application for personal and shared TOTP accounts.

## Product localization

All production and development-preview presentation copy is available in Indonesian (`id`) and English (`en`), with Indonesian as the deterministic default. Locale selection follows ADR-0035: it changes presentation only, never routes, APIs, authorization, encrypted content, cryptographic contracts, or user-provided Vault and Authenticator Account labels. New user-facing copy must update both typed catalogs with exact key parity and preserve the terminology below in each language.

## Language

**Public Landing**:
The unauthenticated root presentation that explains Local and hosted Vault choices and links into their workflows. It owns marketing composition and preview-only demonstrations, not Vault state, authentication, cryptography, or TOTP behavior.
_Avoid_: Landing Vault, public Vault

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
An app-specific passphrase known only to the user, from which a client derives the Vault Unlock Key. The client recommends a randomly generated multi-word passphrase but accepts a user-created passphrase whose trimmed value is at least three characters long. It is separate from the authentication credential and recoverable only through previously enrolled Passkey-Assisted Recovery. The Indonesian product label is **Passphrase Brankas** and the English product label is **Vault Passphrase**.
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

**Workspace Lifecycle**:
The client-only controller that owns an unlocked workspace's reconciliation, cancellation, write gating, replacement cleanup, lock cleanup, and teardown. Browser and native adapters provide platform signals and refresh/storage effects; presentation observes the current workspace and issues commands without creating a second lifecycle policy.
_Avoid_: UI-owned sync state machine, uncancelled refresh, shared plaintext workspace store

**User Encryption Key Pair**:
A user-specific public and private key pair used to wrap Vault Encryption Keys for the user. Its private key is encrypted before server storage.
_Avoid_: Device key pair, vault key

**Honest-but-Curious Server**:
The assumed server behavior: it correctly serves the application and enforces authorization but cannot be trusted with stored encrypted data or plaintext secrets. An actively malicious application host is outside the MVP security boundary. Zero knowledge does not hide permitted ciphertext size/timing or authorization/lifecycle metadata and does not protect secrets after decryption in a client served by an actively malicious host.
_Avoid_: Malicious-server-resistant, trusted key custodian

**Authenticated Crypto Context**:
A canonical, secret-free protocol context authenticated as AES-GCM additional authenticated data and, for ECDH key wraps, included in HKDF domain separation. It binds payload purpose/type, protocol and encryption/key versions, and applicable opaque Vault, account, recipient, or profile identifiers. A context mismatch fails before plaintext is parsed; user labels, secrets, QR data, OTPs, and decrypted content never enter it.
_Avoid_: Plaintext AAD, server-readable label, optional context, context-free compatibility fallback

**Context-Bound Key-Wrap Protocol**:
The platform-neutral client protocol that creates and opens versioned ECDH/HKDF Key-Wrap Envelopes using an Authenticated Crypto Context. It owns portable key representations, strict envelope parsing, legacy migration gates, and client-only identity/Vault-key rotation above browser or native cryptographic primitives.
_Avoid_: Browser-only key wrapping, context-free v2 package, server-held private key, server-held Vault Encryption Key

**Permitted Server Metadata**:
The limited server-visible information allowed by the zero-knowledge contract: opaque identifiers, ciphertext bytes, protocol/encryption/key versions, revisions, lifecycle/deletion deadlines, authorization relationships, permitted invited-email metadata, redacted audit actor/account identifiers, bounded counts, and operational timing/size metadata. It excludes Vault names, account labels, TOTP configuration, OTPs, raw QR data, secrets, keys, decrypted content, and archive/recovery material.
_Avoid_: Harmless metadata, plaintext metadata, server-readable Vault content

**Authentication Provider**:
A replaceable server-side adapter that verifies an external identity and exposes a provider-neutral Verified Principal. Supabase Auth is one supported adapter; OIDC is the preferred interoperability standard. Provider SDKs, OAuth/OIDC protocol types, provider cookies, tokens, and callback mechanics never cross the Identity bounded-context boundary.
_Avoid_: Supabase user in domain code, provider-owned Application User, mandatory Auth.js proxy

**Verified Principal**:
The normalized result of provider verification: immutable issuer and subject, verified email/contact metadata when available, and provider-independent session assurance. It answers who the provider verified, not whether that principal is admitted to the application.
_Avoid_: Email as identity, session cookie as principal, provider-specific session type

**External Identity**:
A durable identity binding unique by `(issuer, subject)` and associated with exactly one Application User. Email is permitted admission/contact metadata but never silently links identities or merges Application Users.
_Avoid_: `supabaseUserId`, automatic email linking, provider account row as Application User

**Application Admission**:
The separate policy decision that determines whether a Verified Principal may use the application. In the Supabase deployment, a verified email principal is admitted to the hosted application; OIDC remains governed by configured admission. Shared Vault membership remains invitation-based and provider-neutral.
_Avoid_: Authentication equals admission, unverified-email access, automatic Shared Vault membership

**Identity Linking**:
An explicit reauthentication ceremony proving control of an existing and proposed External Identity before associating them with one Application User. It creates a redacted security event and never changes Vault key material or encrypted content.
_Avoid_: Automatic email linking, silent account merge, key re-encryption during login

**Provider Migration**:
An auditable, rollback-safe change from one Authentication Provider to another that preserves the Application User identifier, ownership, memberships, audit history, rate limits, recovery enrollment, crypto profiles, and ciphertext. A partial migration leaves the old identity active.
_Avoid_: Provider account migration by email, new Application User on provider change, key rotation during migration

**Admitted User**:
A person admitted by the configured Application Admission policy before they can access the application. In the Supabase deployment, verified-email signup admits a person to the hosted application; an Invitation separately grants access to a Shared Vault after one-time client-side key delivery.
_Avoid_: Authentication equals Shared Vault membership, unverified signup, separate email allowlist

**Application Mutation Rate Limit**:
A PostgreSQL-backed operation-class budget applied after authentication to state-changing application routes. It is keyed only by opaque Application User and operation identifiers, is shared across alternate routes for the same use case, and never replaces authorization, revision checks, one-time-link semantics, or Supabase Auth limits.
_Avoid_: Authentication rate limit, per-instance counter, request-body fingerprint

**Key-Wrap Envelope**:
A versioned encrypted package that allows one User Encryption Key Pair to recover a Vault Encryption Key.
_Avoid_: Plaintext vault key, shared password

**Invitation**:
A no-acceptance request by a Shared Vault owner to give one exact recipient access. It includes a one-time Secure Share Link that expires exactly seven days after creation so the recipient can complete key delivery after cryptographic enrollment. Before the recipient first signs in, the server may bind the pending Invitation to the normalized invited email as permitted authorization metadata; redemption additionally requires an authenticated session whose verified email matches, and then binds the Invitation to the provisioned Application User. An expired Invitation creates no Membership Grant and may be replaced through owner-initiated Re-invitation.
_Avoid_: Pending membership

**Re-invitation**:
The owner-only replacement of an expired Invitation for the same intended recipient. The client creates a fresh Secure Share Link secret, verifier, and encrypted key-handoff package; the server atomically removes matching expired pending Invitations and stores the replacement without receiving the secret or a usable Vault Encryption Key. An unexpired pending Invitation or active Membership Grant still blocks replacement.
_Avoid_: Link recovery, link extension, verifier reuse

**Secure Share Link**:
A one-time secret link delivered by the owner through a secure out-of-band channel. It is bound to the intended invited user, expires exactly seven days after its Invitation is created, and lets them obtain an encrypted Vault Encryption Key package without giving that key to the server. The owner may cancel a pending Invitation, which permanently invalidates its Secure Share Link, or create a Re-invitation after expiry; the original link is never recovered or reused.
_Avoid_: Server-visible key link, reusable sharing URL

**Secure Share Link Creation Workflow**:
The client-only workflow that prepares link material, stores only its verifier and encrypted key package through the authorized transport, delivers the secret through a platform-specific effect, revokes an invitation when delivery fails or is dismissed, and clears temporary verifier/package bytes. The workflow never sends the secret or usable Vault Encryption Key to the server.
_Avoid_: Platform-duplicated cancellation, server-held link secret, reusable link delivery

**Membership Grant**:
An active authorization for an enrolled user to access a Shared Vault, created when the invited user redeems a Secure Share Link and receives a Key-Wrap Envelope. It does not require recipient acceptance in the MVP.
_Avoid_: Invitation, pending membership

**Membership Revocation**:
The immediate denial of all future application access for a Vault member. It cannot erase vault information that member obtained before revocation.
_Avoid_: Retroactive deletion, secret invalidation

**Vault Audit History**:
The non-sensitive record of a Vault’s security-relevant activity. It is visible only to that Vault’s owner and remains independently addressable by opaque Vault and owner identifiers after encrypted Vault content is purged. It is retained for one calendar year after Vault deletion, unless restoration clears that deadline; a later deletion starts a new retention period. It may identify the acting member by account email and an Authenticator Account only by its opaque identifier; it never stores account names, issuers, TOTP configuration, generated OTPs, Local Profile or Local account identifiers, or decrypted Vault content. Opening or copying a Shared Vault Authenticator Account records an Account Access event. Copying between a Local Vault and Personal Vault records the direction against only the applicable opaque Personal Vault account identifier.
_Avoid_: Public activity feed, secret log, plaintext account activity

**Vault-wide Member Permissions**:
The Shared Vault owner’s server-visible default authorization for member creation, editing, and deletion of Authenticator Accounts. Each capability defaults to denied and applies only when that member has no corresponding Member Permission Override.
_Avoid_: Editor role, client-only permission

**Member Permission Override**:
An optional server-visible allow or deny for one member and one Shared Vault account capability. Add, edit, and delete overrides fall back independently: an unset value inherits the corresponding Vault-wide Member Permission, while explicit allow or deny takes precedence.
_Avoid_: Role, all-or-nothing permission profile

**Effective Shared Vault Account Permissions**:
The add, edit, and delete authorization resolved for the current member. A Vault Owner always has all three capabilities; each Vault Viewer capability resolves from its Member Permission Override when set and otherwise from the Vault-wide Member Permission.
_Avoid_: UI visibility, cached authorization decision

**Vault Owner**:
The sole member responsible for a Shared Vault’s membership, permissions, Vault lifecycle, recovery, and key administration. The owner is entitled to read its accounts and always has authority to add, edit, soft-delete, and restore them regardless of member defaults or overrides.
_Avoid_: Admin, editor

**Vault Viewer**:
A non-owner Shared Vault member who may read accounts and generate or copy OTPs. A Viewer may add, replace the complete encrypted payload of, or soft-delete Authenticator Accounts only when the corresponding Effective Shared Vault Account Permission allows it. A Viewer may leave the Vault but cannot restore accounts, manage the Vault or membership, see other members/invitations/Secure Share Links, or view Vault Audit History.
_Avoid_: Editor, collaborator

**Deleted Vault**:
A Vault hidden from all users and denied all application access during its 30-day recovery window, after which its encrypted content, accounts, memberships, invitations, and lifecycle row are permanently purged. Its redacted Vault Audit History remains owner-only until the separate one-year audit deadline. Only its owner may restore it before the recovery deadline.
_Avoid_: Active vault, permanent archive

**Authenticator Account**:
A TOTP configuration stored in a Vault whose secret is only available on authorized client devices. A Shared Vault member may create, replace, or soft-delete it only through the corresponding Effective Shared Vault Account Permission. A deleted account receives an explicit purge deadline exactly 30 days after deletion, remains recoverable only by its owner before that deadline, and is then permanently purged by bounded server cleanup.
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

**Local Profile**:
A device/browser-installation-scoped client-owned container that exists without a Supabase session or Application User and owns exactly one writable Local Vault. It is not identified by email, server user ID, or provider identity. A browser installation may have at most one Local Profile, and creating another requires explicitly clearing the existing one.
_Avoid_: Device account, browser user, server profile, Personal Vault

**Local Vault**:
The one writable encrypted Vault owned by a Local Profile. It exists only in application-owned browser storage, remains independent from server Personal and Shared Vaults, and supports explicit offline account management without automatic synchronization, account linking, background upload, merge, or deletion propagation. Its labels and account content are decrypted only in client memory.
_Avoid_: Personal Vault, Shared Vault, Local Vault Snapshot, offline cache

**Local Vault Session**:
A direct client-only lifecycle owner for one consuming surface's unlocked Local Vault. It serializes state-changing operations and owns discovery, explicit migration, refresh replacement, lock, destructive clearing, and teardown zeroization. Each surface creates an independent session; a Local Vault Session is never global, persisted, placed in TanStack Query, or shared automatically between routes.
_Avoid_: Global Local Vault store, Query cache, server session, synchronization session

**Local Vault Passphrase**:
The client-only passphrase that derives the Local Unlock Key for a Local Vault. It is separate from the server-backed Vault Unlock Secret and authentication credential, never reaches a server, and is not recoverable by logout, sign-in, or an identity provider. The Indonesian product label is **Passphrase Brankas Lokal** and the English product label is **Local Vault Passphrase**.
_Avoid_: PIN, authentication password, Vault Unlock Secret, recovery secret

**Local Vault Snapshot**:
An encrypted browser-stored copy of a previously synchronized server Vault used for read-only offline OTP generation. It is not a Local Vault, cannot queue or replay mutations, and on a later successful contact is deleted if the server reports the user no longer has access.
_Avoid_: Plaintext offline cache, writable local vault, offline write queue

**Encrypted Vault Archive**:
A portable, explicitly user-created versioned archive whose authenticated ciphertext contains one plaintext Vault Name and normalized TOTP configurations only while opened in client memory. Its owner-only export generates a separate random 32-byte archive key in the browser and releases the archive and key only after the server records a redacted Archive Exported event. Import requires user-supplied 32-byte archive key material, validates and previews all content locally, then atomically stores newly encrypted account ciphertext and one redacted Archive Imported event in an owned destination Vault or a newly created Shared Vault. Personal and Shared Vault owners can view these events in Vault Audit History. Export-audit requests contain only opaque Vault/user identifiers and reveal no archive bytes, keys, names, account counts, or TOTP content. Import requests contain opaque destination/account identifiers, envelope versions, and re-encrypted account ciphertext, so the server can observe the imported record count but cannot read archive or TOTP content.
_Avoid_: Plaintext backup, server-side archive, recovery package
