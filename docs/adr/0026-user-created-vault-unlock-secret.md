# User-created vault unlock secret

During Personal Vault setup, the client offers both a randomly generated Vault Unlock Secret (recommended) and a user-created Vault Unlock Secret. A generated secret remains multi-word; a user-created secret must contain at least three trimmed characters under ADR-0029 and receives guidance to be unique and difficult to guess. Both options remain client-only and use the same Argon2id derivation and encrypted storage protocol; the server never receives either secret.
