# No MVP key rotation emergency procedure

> **Status:** Partially superseded by the advanced-security protocol implementation; complete user-facing rotation ceremonies remain unshipped.

The repository now contains client-only rotation protocols and server persistence seams, but not the complete browser/native orchestration, recovery-device enrollment, or product UX required to make rotation generally available. Until those flows are delivered, if a key is believed compromised the owner creates a new vault, resets and re-adds affected TOTP secrets at their original services, re-grants members, and deletes the old vault; removal or deletion alone is not remediation.
