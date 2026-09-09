## Issue / Task

<!-- Link every GitHub issue addressed by this pull request. -->

## Summary

<!-- Explain the user/operator outcome and any security, provenance, or domain decision. -->

## Test Plan

- [ ] Focused tests and checks for the changed bounded context pass.
- [ ] `mise exec -- pnpm run format:check` passes.
- [ ] `mise exec -- pnpm run lint` passes.
- [ ] `mise exec -- pnpm run typecheck` passes.
- [ ] `mise exec -- pnpm test` passes.
- [ ] `mise exec -- pnpm run test:architecture` passes.
- [ ] `mise exec -- pnpm run build` passes.
- [ ] `mise exec -- pnpm run test:full` passes, or the blocked phase and exact evidence are documented.
- [ ] User-facing copy is complete in Indonesian and English where applicable.
- [ ] No secrets, Vault content, OTPs, keys, credentials, or sensitive fixtures are included.
- [ ] Every commit has a DCO `Signed-off-by` trailer (`git commit -s`).

## Review checklist

- [ ] The change preserves bounded-context and client/server boundaries.
- [ ] Security-sensitive behavior has focused tests and an ADR when needed.
- [ ] Database changes use Prisma-generated migrations only.
- [ ] Required CODEOWNERS review and maintainer approval are present.
