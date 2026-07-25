# No MVP vault unlock-secret recovery

The MVP cannot reset or recover a lost Vault Unlock Secret. Secure-vault setup must clearly warn users and require acknowledgement because a recovery path that silently bypasses encryption would violate the server zero-knowledge boundary; recovery is deferred to a separate threat-modelled design.
