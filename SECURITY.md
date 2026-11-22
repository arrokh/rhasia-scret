# Security policy

## Scope and security model

rhasia-scret is a zero-knowledge TOTP application with an honest-but-curious
server model. The server enforces authorization but must not receive plaintext
Vault content or client-held secrets. An actively malicious hosted client or
its delivery infrastructure is outside the current MVP guarantee. Read the
[threat model](docs/adr/0004-honest-but-curious-server-threat-model.md) and
[security documentation](docs/README.md#security) before relying on a
deployment.

## Threat model for reviewers and scanners

- **Browser → API:** Treat requests from signed-in users as untrusted. Check
  membership and role on each Vault read or mutation, including after removal.
  Authentication alone must not grant access to another user's ciphertext.
- **Client → storage and telemetry:** Vault names, account labels, TOTP seeds,
  codes and decryption keys must not reach the API, logs, analytics, Query
  caches or service-worker caches. Check error and offline paths as well as
  successful requests. A Secure Share Link fragment belongs only in client
  memory after opening; it must not travel with the request.
- **Source → delivered client:** A modified client could read unlocked secrets.
  Review dependency changes, build inputs and release permissions. Untrusted
  contributions must not gain publishing authority or access to deploy keys.

## Dependency patches

Enable the dependency graph, Dependabot alerts and Dependabot security updates
in GitHub repository settings. These generate security PRs independently of
scheduled version updates. The release owner should triage a reachable high
or critical advisory within one day and target a tested release within three
days of a fix. If blocked, record the mitigation, owner and next review date
privately. A merged dependency PR is not evidence of deployment.

## Provider credential rotation

Inventory credentials by provider, project, environment, owner and consuming
service; record identifiers, never values. Use separate identities for CI,
runtime and administration. For AI tools, restrict keys to the intended
project, endpoints and models where supported; set usage alerts and quotas.
Do not give a browser bundle or a pull-request build a provider secret.

For routine rotation, create a least-privilege replacement in the provider
console, put it in the consumer's secret store, reload the consumer and verify
one expected operation. Revoke the old key, verify revocation in the provider
console and check usage for unexpected activity. If theft is suspected,
contain immediately rather than waiting for a routine cutover. These steps
apply to service credentials, not client-held Vault encryption keys.

## Reporting a vulnerability

Do not report a vulnerability in a public issue, pull request, discussion, or
support request. Use the private [GitHub Security Advisory form](https://github.com/arrokh/rhasia-scret/security/advisories/new).
If the form is unavailable, contact the repository owner privately through
GitHub and include only redacted details.

Please include:

- a short description and affected component or release;
- a reproducible proof of concept using synthetic, non-PII data only;
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
