# Web/PWA is the sole supported client

- **Status:** Accepted

Issue [#243](https://github.com/arrokh/rhasia-scret/issues/243) retires the Expo iOS/Android application and its native-only build, distribution, and support surfaces. The responsive web application remains the sole supported client, including mobile-browser layouts, installable PWA behavior, and the verifier-backed passwordless authentication handoff; native bearer sessions and platform-only authentication paths are removed. Keep platform-neutral client workflows that remain consumed by the web/API, and preserve historical native release and readiness evidence as history rather than current support commitments. This supersedes the native-client applicability described in ADR-0016, ADR-0033, ADR-0037, ADR-0040, ADR-0041, and ADR-0049, and supersedes ADR-0042 in full. This reduces maintenance and release scope without removing the web client’s mobile-browser experience or weakening its security boundaries.
