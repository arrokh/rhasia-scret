# Passphrase, not PIN, for vault unlock

Superseded for custom-passphrase requirements by ADR-0060. The Vault Unlock Secret is a passphrase, not a short PIN. A generated secret remains a difficult multi-word recommendation; new user-authored secrets require at least twelve trimmed Unicode code points, while legacy secrets remain unlockable. It protects server-backed encrypted material from offline guessing. Device PINs and biometrics remain Local Verification for a Remembered Browser rather than replacements for the passphrase; this capability is browser-only under ADR-0054.
