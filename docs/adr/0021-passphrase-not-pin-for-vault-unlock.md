# Passphrase, not PIN, for vault unlock

The Vault Unlock Secret is a passphrase, not a short PIN. A generated secret remains a difficult multi-word recommendation; a user-created secret is accepted when its trimmed value contains at least three characters under ADR-0029. It protects server-backed encrypted material from offline guessing. Device PINs and biometrics remain Local Verification for a Remembered Browser rather than replacements for the passphrase, and native mobile device authentication is not a declared WebAuthn PRF equivalent.
