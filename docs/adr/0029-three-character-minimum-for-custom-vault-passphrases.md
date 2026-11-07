# Three-character minimum for custom Vault passphrases

Superseded by ADR-0060. At the time of this decision, a user-created Vault Unlock Secret was accepted when its trimmed value contained at least three characters. Browser-generated Vault Unlock Secrets remained multi-word and recommended. This decision superseded the four-word minimum in ADR-0021 and ADR-0026; ADR-0060 now requires at least twelve trimmed Unicode code points for new or changed user-authored secrets while preserving legacy unlocks.

This deliberately permits substantially weaker user-created secrets. The setup UI must continue recommending a difficult-to-guess, unique passphrase and must not describe a three-character secret as equivalent in strength to the generated option.
