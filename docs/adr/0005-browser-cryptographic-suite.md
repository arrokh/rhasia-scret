# Browser cryptographic suite

The MVP uses AES-256-GCM for payload and backup encryption, and P-256 ECDH with HKDF-SHA-256 and AES-256-GCM to create each Key-Wrap Envelope. This keeps the cryptographic operations within broadly supported Web Crypto APIs while using versioned envelopes to permit future migration.
