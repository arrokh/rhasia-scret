# Encrypted user private-key backup

The client encrypts each User Encryption Key Pair's private key with the User Root Key before backing it up to the server. This lets a newly enrolled browser recover the private key after a user supplies the Vault Unlock Secret and unlocks the User Root Key, so it can access shared vaults without the server receiving a usable private key.
