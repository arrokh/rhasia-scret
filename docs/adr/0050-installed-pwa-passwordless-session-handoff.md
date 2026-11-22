# ADR-0050: Installed PWA passwordless session handoff

- **Status:** Accepted
- **Date:** 2026-09-15
- **Related:** ADR-0035, ADR-0039, ADR-0049

> The native sign-in statements in this record describe the former client and were retired under ADR-0054; the installed-PWA handoff remains supported.

## Context

An installed web PWA can use a browser storage and cookie partition that is separate from the browser opened by an email application. A passwordless link that is redeemed only in that browser therefore authenticates the browser while the already-open PWA remains anonymous. The PWA cannot receive an HttpOnly cookie by navigating the browser response.

## Decision

A passwordless request made from an installed PWA is classified as `pwa` and receives a random handoff identifier plus a verifier. The server stores only keyed digests of both values plus the normalized request email in a short-lived `PwaAuthenticationHandoff` row. Its email link targets the HTTPS `/auth/pwa-confirm` callback and keeps the one-time magic-link token, return path, and handoff identifier in the URL fragment. The fragment is cleared before client processing; the PWA keeps the verifier in session-scoped client state.

Before the API request begins, the PWA stores the new verifier in an in-memory and session-scoped provisional record with a maximum lifetime of 3,600 seconds, matching the server's maximum magic-link lifetime. It polls this provisional handoff while awaiting the callback, so it can receive a session even if the email request's response is lost. Active and provisional handoffs poll independently, backing off from one second to a ten-second maximum and pausing while the document is hidden; a visible, online, or restored page polls immediately. A successful request replaces the provisional record with an expiry derived from the server-reported challenge lifetime and the request start time. A rate limit or definitive HTTP 4xx rejection clears only the provisional record; an uncertain network failure retains it until expiry. The previous accepted handoff remains available unless the new request succeeds. Because server responses intentionally do not distinguish unknown, expired, consumed, and mismatched handoffs, a client that misses the completion broadcast may continue polling until its local expiry.

When the link opens in a browser, the callback redeems the one-time challenge without setting browser cookies and sends the resulting refresh credential and handoff identifier to the same-origin `POST /api/auth/pwa/session` publisher. The server rotates that credential and binds the resulting session to the matching, still-unpublished handoff row only when the redeemed session belongs to the normalized request email. The open PWA polls the endpoint with its handoff identifier and verifier; the server atomically consumes the handoff, creates a fresh session, and sets ordinary HttpOnly browser session cookies in the PWA context. Refresh rotation, one-time consumption, expiry, and existing session-family reuse detection remain server-authoritative. If the operating system opens the callback directly in the installed PWA, the callback first reads the verifier from its own session-scoped state or requests it from the still-open sign-in window over a same-origin, handoff-ID- and request-ID-matched `BroadcastChannel` exchange, then publishes and redeems the handoff.

The ordinary browser flow and the installed-PWA handoff remain supported. The former native flow and its `/auth/mobile` links and secure token storage are retired under ADR-0054. The service worker continues to bypass all `/auth/` and `/api/` requests.

## Security and compatibility

The handoff identifier and verifier are bounded and validated; only their keyed digests, normalized request email, and permitted lifecycle metadata are persisted. Publishing also requires the redeemed session email to match the handoff email, preventing a different account from claiming a known handoff identifier. The refresh credential is never placed in a URL, persistent browser storage, Query cache, service-worker cache, analytics payload, application log, or database; it exists only in the callback memory and the same-origin publisher request body. The verifier remains in session-scoped client state and may cross between same-origin PWA windows only through a handoff-ID- and request-ID-matched `BroadcastChannel` response; the source sign-in tab may answer repeated matching requests while it remains open. The channel exchange is not the one-time authorization boundary: server-side handoff consumption enforces one-use. The verifier is never included in the email URL or persisted server-side. The publisher rotates the refresh credential before binding a session, and the receiver consumes the verifier-backed handoff before issuing cookies. Missing, malformed, mismatched, expired, or already-consumed handoffs fail closed.

The bridge requires the intended installed PWA to remain available for polling when the email link opens outside the PWA. The client backs off polling and pauses while hidden. The API also enforces a 15-minute HMAC-bucketed limit of 300 polls per handoff and 10,000 per trusted client IP, with a shared 10,000-request fallback when client IP is unavailable. This bounds repeated calls but adds two rate-limit counter writes per poll; hosted edge limits and database capacity remain operational checks. The sign-in screen keeps the accepted or provisional handoff identifier and verifier in session-scoped client state so a reload can resume polling; it never stores a session credential. If the PWA is not available to receive the handoff, the user must request a new link from the intended client.

## Consequences

Installed PWA sign-in no longer depends on browser/PWA cookie sharing. It adds a web-only passwordless client classification, a callback route, and a narrow session exchange endpoint, plus bilingual UI and contract coverage. PWA authentication links remain HTTPS links, so deployments must still configure normal TLS and the existing application origin correctly.
