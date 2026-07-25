# Soft-delete authenticator accounts for 30 days

Owners soft-delete Authenticator Accounts: they immediately disappear from all authorized clients, remain recoverable for 30 days, and are then purged. Deleting an account does not revoke a TOTP secret previously learned by another person; that requires resetting 2FA at the original service.
