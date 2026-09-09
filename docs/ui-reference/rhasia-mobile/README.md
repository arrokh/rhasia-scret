# Rhasia mobile UI reference

This directory is the development reference extracted from `/Users/arrokh/Downloads/rhasiaimage.png`. Each numbered PNG is a standalone mobile-screen slice with a same-named Markdown analysis covering UI, style, layout, components, expected behaviour, and flow. [`design-system.md`](design-system.md) is the canonical shared styling and component contract; `design-system-footer.png` and `design-system-footer.md` preserve the source image's design notes and component specimens. Use these assets for visual hierarchy, layout, states, and component composition—not as a source of product or security requirements.

## Screens

| Asset                          | Reference screen                     | Analysis                                                   | MVP-plan coverage                                                       |
| ------------------------------ | ------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `01-login.png`                 | Login                                | [01-login.md](01-login.md)                                 | Slice 1 — verified-email authentication                                 |
| `02-vault-unlock.png`          | Vault unlock                         | [02-vault-unlock.md](02-vault-unlock.md)                   | Slices 2 and 4 — secure setup and unlock                                |
| `03-home-otp-list.png`         | Home / OTP list                      | [03-home-otp-list.md](03-home-otp-list.md)                 | Slices 3, 5, and 10 — local OTP display and vault access                |
| `04-vaults.png`                | Vault list                           | [04-vaults.md](04-vaults.md)                               | Slices 2, 7, and 10 — Personal and Shared Vault navigation              |
| `05-vault-detail-accounts.png` | Shared Vault account list            | [05-vault-detail-accounts.md](05-vault-detail-accounts.md) | Slices 10 and 11 — role-aware Shared Vault accounts                     |
| `06-add-account.png`           | Add authenticator method picker      | [06-add-account.md](06-add-account.md)                     | Slices 5 and 6 — encrypted account creation and QR import               |
| `07-scan-qr-code.png`          | QR scanner                           | [07-scan-qr-code.md](07-scan-qr-code.md)                   | Slice 6 — client-only QR import                                         |
| `08-account-review.png`        | Account review                       | [08-account-review.md](08-account-review.md)               | Slices 5, 6, and 11 — local preview and confirmation before save        |
| `09-members.png`               | Members                              | [09-members.md](09-members.md)                             | Slice 9 — owner-only membership management                              |
| `10-invite-member.png`         | Invite member                        | [10-invite-member.md](10-invite-member.md)                 | Slice 9 — invitation and Secure Share Link delivery                     |
| `11-account-details.png`       | Account details                      | [11-account-details.md](11-account-details.md)             | Slices 5, 11, and 13 — account inspection, edit, deletion, and recovery |
| `12-settings.png`              | Settings                             | [12-settings.md](12-settings.md)                           | Slice 4 — unlock, Remembered Browser, and logout controls               |
| `13-activity.png`              | Activity                             | [13-activity.md](13-activity.md)                           | Slice 15 — owner-only redacted Vault Audit History                      |
| `14-empty-vault.png`           | Empty Vault                          | [14-empty-vault.md](14-empty-vault.md)                     | Slices 5 and 11 — no-account empty state                                |
| `15-offline-state.png`         | Offline                              | [15-offline-state.md](15-offline-state.md)                 | Slice 14 — read-only offline status and reconnection                    |
| `design-system-footer.png`     | Design notes and component specimens | [design-system-footer.md](design-system-footer.md)         | Cross-cutting UI system                                                 |
| —                              | Canonical design-system contract     | [design-system.md](design-system.md)                       | Cross-cutting UI system                                                 |

## Design system captured in the footer

All screen analyses inherit [`design-system.md`](design-system.md). It standardizes tokens, spacing, typography, reusable components, state treatment, accessibility, and security/authorization visual boundaries.

`design-system-footer.png` records these source notes and specimens:

- OTPs are the primary visual focus: large, clear, and easy to copy.
- The circular countdown communicates the remaining period interval.
- Use cards with subtle elevation and rounded corners.
- Color roles: deep indigo (primary), green (success), amber (warning), red (danger), and slate (neutral).
- Reusable specimens: OTP card, countdown, vault card, role badge, synchronization status, and icon set.

## Authoritative-product adjustments

The source is a visual reference only. Implementations must follow `CONTEXT.md`, `docs/mvp-plan.md`, and the ADRs when this reference differs:

- Call the product **rhasia-scret** and use the glossary terms: **Vault**, **Authenticator Account**, **Vault Unlock Secret** (labelled **Passphrase Brankas** in Indonesian UI), **Vault Owner**, and **Vault Viewer**.
- Do **not** implement the pictured numeric “Vault PIN,” PIN change, or one-minute auto-lock. A generated Vault Unlock Secret is a recommended difficult multi-word secret; a user-created value may contain at least three trimmed characters under ADR-0029. Web sessions end through explicit lock or logout; the native workspace also locks when AppState leaves the active state. See ADR-0001, ADR-0002, ADR-0007, ADR-0021, and ADR-0029.
- The only Shared Vault roles are Owner and Viewer. Do not add the pictured “Can edit” role. A Viewer is read/copy-capable and may receive independent account add/edit/delete capabilities through Vault-wide defaults and per-member overrides; member management and audit history remain owner-only.
- The client may scan or manually enter an `otpauth://totp` URI, but raw QR data, raw URIs, TOTP secrets, and generated OTPs must never reach or persist on the server.
- Offline UI must make all mutations unavailable and never queue writes. It may present cached OTPs only from an encrypted Local Vault Snapshot.
- The Activity view must contain redacted, opaque-ID-only audit events, never account or Vault labels.

## Asset maintenance

Keep the slices stable so UI work can cite a file directly. If the upstream composite changes, replace the affected image(s), preserve the numbered filenames, and update this index and the UI-reference section in `docs/mvp-plan.md` together.
