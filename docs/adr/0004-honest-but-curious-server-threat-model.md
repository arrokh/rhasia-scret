# Honest-but-curious server threat model

The MVP protects encrypted data from server-side storage, logs, backups, and ordinary server access, while assuming the application host correctly serves the client and does not substitute cryptographic code or keys. A web application cannot reliably protect client secrets from an actively malicious host that can deliver arbitrary JavaScript.
