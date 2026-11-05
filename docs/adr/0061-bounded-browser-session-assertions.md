# Bounded browser session assertions

The browser session assertion is a signed, HttpOnly cookie used by the web proxy and API to identify an application session. It previously expired with the 30-day refresh session. Database revocation checks limited its authority at the API but did not limit how long a copied assertion could be replayed at the web proxy.

New browser assertions expire at the earlier of the owning session expiry or seven days after issuance. A same-origin, no-store session keepalive renews an assertion only after the API verifies its active database session. The browser sends a keepalive on page load, when a tab regains focus, and every 24 hours while open. A revoked or expired session cannot renew its assertion. If the browser is inactive until the assertion expires, the user must sign in again even if the server-side session has not yet reached its own expiry.

The API remains the authorization boundary for protected data. The assertion only enables the web proxy to gate pages and route requests; it contains no user content, Vault data, or key material.
