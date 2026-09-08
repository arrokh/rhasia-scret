# 02 — Vault unlock

![Vault unlock reference](02-vault-unlock.png)

> **Design-system contract:** This screen inherits [`design-system.md`](design-system.md).

## UI and layout
The title and supporting prompt are centered above a credential-progress indicator. Preserve the source's focused, single-purpose credential area, but replace its numeric keypad with a masked multiword Vault Unlock Secret entry; a Local Verification fallback sits at the bottom.

## Style and components
Minimal white surface, restrained black typography, deep-indigo focus/selection state, and an inline Local Verification action. Components: heading, helper text, progress indicators, masked multiword secure-entry control, show/hide affordance that does not persist values, recovery guidance, and Local Verification action.

## Expected behaviour
Use this composition for the unlock decision, but **not** the pictured PIN. Recommend a generated multi-word Vault Unlock Secret; a user-created value is accepted at a minimum of three trimmed characters under ADR-0029. A Remembered Browser may use WebAuthn Local Verification on the web; the native client currently uses the Vault Passphrase and does not claim WebAuthn PRF-equivalent recovery. Keep secret input client-only, reveal no secret in logs, and end an Unlocked Vault Session only on explicit lock, logout, or native AppState backgrounding.

## Flow
Web: authenticated user → determine Remembered Browser eligibility → Local Verification **or** Vault Unlock Secret entry → derive/unlock client keys → decrypt locally → home or selected Vault. Native: authenticated user → Vault Passphrase entry → native Argon2id/key unwrap → decrypt locally → home or selected Vault; AppState backgrounding returns to the lock ceremony.
