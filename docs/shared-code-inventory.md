# Platform-neutral client-code inventory

See [`monorepo.md`](./monorepo.md) for pnpm workspace ownership and command contracts.

This inventory records the package-boundary decisions made for issue #102 and reviewed after issue #243 retired the Expo client. `apps/web` is now the sole supported client; both `apps/web` and `apps/api` continue to consume `packages/client-vault-core`. The platform-neutral workflows remain in that package because its public protocols and authorization policies are shared by both applications and remain independent of browser presentation and server infrastructure; no native application or native-only adapter is part of the current product.

## Decisions

| Capability                                                                                                               | Owner                             | Boundary                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TOTP URI parsing, normalization, validation, clock-drift policy, and injected HMAC calculation                           | `@rhasia-scret/client-vault-core` | Pure client policy and protocol logic; no browser, React, server, or persistence imports.                                                                               |
| Encrypted account payloads, workspace models/ports, and workspace lifecycle                                              | `@rhasia-scret/client-vault-core` | Headless client workflows; decrypted content and key material remain in caller-owned memory.                                                                            |
| Context-bound crypto envelopes, ECDH key-wrap/identity/rotation protocols, unlock parameters, and archive protocol       | `@rhasia-scret/client-vault-core` | Portable orchestration over injected crypto primitives; no crypto secrets or plaintext are logged or persisted by the package.                                          |
| Hosted Authenticator Account and conditional offline-bundle transport contracts                                          | `@rhasia-scret/client-vault-core` | HTTP semantics operate above injected `AuthenticatedTransport`; the package does not own endpoints or credentials.                                                      |
| Secure Share Link creation/redemption workflows and Shared Vault account-permission policy                               | `@rhasia-scret/client-vault-core` | Headless workflow and deterministic policy APIs; browser navigation and delivery effects remain in web presentation.                                                    |
| Base64, protocol constants, and platform-port types                                                                      | `@rhasia-scret/client-vault-core` | Capability-owned primitives; no generic cross-context utility package is introduced.                                                                                    |
| Browser crypto primitives, WebAuthn/PRF, IndexedDB, service worker, clipboard, QR camera, browser HTTP, and presentation | `apps/web`                        | Browser APIs and web experience stay in the web composition; mobile-browser layouts remain web behavior.                                                                |
| Local Profile and writable Local Vault workflows                                                                         | `apps/web` Local Vault context    | Browser-only workflows are not duplicated in a shared package.                                                                                                          |
| Prisma repositories, Hono route handlers, server session/auth adapters, audit, and retention                             | `apps/api`                        | The API owns server-side access, authorization, canonical `/v1/**` routes, persistence, and retention. The web app contains only the same-origin proxy and SSR gateway. |
| Message catalogs, `next-intl`, DOM presentation, and responsive UI                                                       | `apps/web`                        | Presentation copy and accessible web semantics remain web-owned; protocol and error contracts stay locale-independent.                                                  |

Native-only Expo composition, bearer transport, native cryptography/storage, camera/clipboard/document adapters, localization, and native build/release tooling were removed for issue #243. Historical implementation and release evidence remains in its original records and is not a current support commitment.

## Package contract

`packages/client-vault-core` exports its supported API through `src/index.ts`; `apps/web` and `apps/api` consume its public API through `workspace:*` dependencies and must not reach into package internals. The package has no Next.js, React, Prisma, filesystem, browser API, or platform-storage imports. Client-only workflows accept cryptographic primitives, transport, time, storage, download, and UI effects through injected ports; API consumers use only permitted platform-neutral policies and encrypted contracts.

The package boundary is covered by its typecheck/unit suite and the web/API consumer suites. API and web architecture tests enforce import boundaries and one-way workspace dependencies. Retired `apps/mobile` paths remain classified as unknown by CI change detection so historical paths conservatively select all checks.

## Sensitive-data review

The package handles encrypted bytes and caller-owned plaintext only for immediate client-side transformations. It has no module-level cache, query integration, service-worker integration, logging, or persistence. TOTP secrets, generated OTPs, Vault keys, unlock secrets, private keys, decrypted labels, and archive key material are not package constants, message-catalog values, or CI artifacts.
