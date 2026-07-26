# Three-character minimum for custom Vault passphrases

A user-created Vault Unlock Secret is accepted when its trimmed value contains at least three characters. Browser-generated Vault Unlock Secrets remain multi-word and recommended. This decision supersedes the four-word minimum in ADR 0021 and ADR 0026 only for user-created passphrases; all secrets continue to use the same client-only Argon2id derivation and encrypted storage protocol.

This deliberately permits substantially weaker user-created secrets. The setup UI must continue recommending a difficult-to-guess, unique passphrase and must not describe a three-character secret as equivalent in strength to the generated option.
