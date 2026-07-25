# Argon2id vault unlock-key derivation

The client derives a Vault Unlock Key from the Vault Unlock Secret with Argon2id, using a random per-user salt and calibrated parameters. This makes offline guessing of stolen encrypted backups more expensive than a browser-native PBKDF2 design, accepting a vetted browser-compatible implementation and device-performance testing.
