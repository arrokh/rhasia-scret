# API contract fixtures

`route-manifest.json` freezes the pre-migration 70-operation method/path inventory as synthetic contract metadata, not customer data. The Go API contract tests use it as an expected inventory; it is not generated from or backed by an active TypeScript server.

`http-golden.json` captures safe examples for health/time, the empty 204 session-revoke response, rejected proxy assertions, and implicit `HEAD` behavior.

`operation-boundaries.json` freezes anonymous request outcomes from the pre-cutover implementation for all 70 operations, including status, error body, and stable transport headers. Go runtime-composition tests use it as a compatibility baseline, not an active runtime comparison. These vectors complement (but do not replace) operation-specific success, authorization, persistence, and security tests.

`email-golden.json` freezes English magic-link, account-deletion OTP, and completion-email subject, text, and HTML using only dummy values and `example.test` addresses. Go tests compare their renderers with this fixture; separate Go locale tests cover Indonesian output. Keep fixture values synthetic and update them only with reviewed compatibility evidence.
