# Security policy

## Scope and security model

rhasia-scret is a zero-knowledge TOTP application with an honest-but-curious
server model. The server enforces authorization but must not receive plaintext
Vault content or client-held secrets. An actively malicious hosted client or
native application supply chain is outside the current MVP guarantee. Read the
[threat model](docs/adr/0004-honest-but-curious-server-threat-model.md) and
[security documentation](docs/README.md#security) before relying on a
deployment.

## Reporting a vulnerability

Do not report a vulnerability in a public issue, pull request, discussion, or
support request. Use the private [GitHub Security Advisory form](https://github.com/arrokh/rhasia-scret/security/advisories/new).
If the form is unavailable, contact the repository owner privately through
GitHub and include only redacted details.

Please include:

- a short description and affected component or release;
- a reproducible proof of concept using synthetic data only;
- impact, preconditions, and whether confidentiality, integrity, or
  availability is affected; and
- a safe contact channel for clarification.

Never include passwords, passphrases, TOTP secrets, OTPs, QR data, Secure
Share Link fragments, cookies, authorization headers, provider tokens,
database URLs, archive keys, private keys, or decrypted Vault content.

## Response and embargo

The maintainer acknowledges a report when practical, validates it with
synthetic data, assigns a severity and owner, and coordinates a fix or risk
acceptance. The report remains private while affected users and downstream
operators need time to update. Disclosure timing is agreed with the reporter
where possible; an imminent active exploit may require an accelerated public
notice.

Security fixes must preserve authorization, client-only key boundaries, audit
redaction, retention semantics, and bilingual copy. A release owner records
the affected versions, fix commit, tests, deployment/rollback plan, and any
operator action without publishing sensitive evidence.

## Out of scope

Provider-side account compromise, a self-hosting operator's infrastructure,
lost client-held secrets, secrets already opened by a malicious host, and
ordinary support questions are outside the repository's vulnerability
response boundary. They should still be reported to the responsible provider
or deployment operator through a private channel.
