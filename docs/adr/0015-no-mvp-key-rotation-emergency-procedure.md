# No MVP key rotation emergency procedure

Normal Vault Encryption Key and User Encryption Key Pair rotation are deferred to the advanced-security milestone. If a key is believed compromised in the MVP, the owner creates a new vault, resets and re-adds affected TOTP secrets at their original services, re-grants members, and deletes the old vault; removal or deletion alone is not remediation.
