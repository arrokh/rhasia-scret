# Minimum strength for new Vault Passphrases

The three-character minimum allowed custom Vault Passphrases that were practical to guess offline from copied encrypted Vault data. Argon2id increases the cost of guesses but does not make a predictable passphrase strong.

New or changed user-authored Vault Passphrases must contain at least twelve Unicode code points after trimming. Browser-generated multi-word passphrases remain the recommended option. This rule is enforced by client workflows before derivation or storage; the server continues to receive only encrypted material. Unlock accepts the existing three-character minimum so users can continue opening Vaults created under the former policy. Local Vault Passphrase policy is unchanged.

This decision supersedes ADR-0029 and the custom-passphrase minimums in ADR-0021 and ADR-0026. It does not change encrypted formats or require an immediate passphrase change.
