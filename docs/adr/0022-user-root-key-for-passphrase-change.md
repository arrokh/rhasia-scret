# User root key for passphrase change

A random User Root Key protects the Personal Vault Encryption Key and encrypted User Encryption Key Pair. The Vault Unlock Secret derives a Vault Unlock Key that wraps this root key, so changing the passphrase re-wraps only the root key and does not re-encrypt vault content or invalidate remembered browsers.
