# API contract fixtures

`route-manifest.json` freezes the pre-migration 70-operation method/path inventory from the TypeScript API. It is synthetic contract metadata, not customer data.

`http-golden.json` captures safe examples from existing API tests for health/time, the empty 204 session-revoke response, rejected proxy assertions, and implicit `HEAD` behavior.

`operation-boundaries.json` freezes the TypeScript reference runtime's anonymous request outcomes for all 70 operations, including status, error body, and stable transport headers. TypeScript route tests and Go runtime-composition tests consume the same fixture. These boundary vectors complement (but do not replace) operation-specific success, authorization, persistence, and security tests.

`email-golden.json` freezes the English magic-link, account-deletion OTP, and completion-email subject, text, and HTML using only dummy values and `example.test` addresses. TypeScript and Go tests both compare their renderers with this fixture. Keep fixture values synthetic and update them only with reviewed compatibility evidence.
