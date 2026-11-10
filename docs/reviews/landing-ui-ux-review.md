# Landing page UI/UX review and implementation brief

## Scope and evidence

Reviewed `/landing` on the hosted site and in this worktree, starting from commit `710c76155a6244b6469d857256a562104ecc6098`.

This is a scoped refinement, not a rebrand. Preserve the warm ivory background, amber accents, dark ink, grid backdrop, Manrope typography, and synthetic product previews. Do not change authentication, encryption, persistence, or Local/Hosted Vault behavior.

Feedback comes from direct browser inspection and an independent code investigation, not customer interviews or conversion measurements. Initial captures at 1440 × 1000 and 390 × 844 showed a locked phone and a scroll hint, with no visible product heading or Vault entry actions.

## Assessment

**Visual identity:** coherent and distinctive. The real application screens communicate the product more honestly than generic security artwork. Keep them.

**Main weakness:** the animation introduces the interface before explaining the product. A first-time visitor must discover two scroll steps before finding out what the product does or how to try it. On a phone, the locked preview can also look like a form the visitor is expected to complete.

**Hierarchy:** Local Vault is the no-sign-in starting point, while Hosted Vault supports optional sharing. That distinction needs to remain visible at entry and at the closing call to action.

**Interaction:** document-wide capture listeners block unrelated navigation during transitions. The tour lacks an explicit next or skip control. Animation must not hold the product entry paths hostage.

## Prioritized action items and acceptance criteria

| Priority | Finding                                                            | Required improvement                                                                                                                                                  | Acceptance                                                                                                                                            |
| -------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Product proposition and entry links are initially hidden/inert.    | Show the heading, explanation, and Local/Hosted links immediately. Use a text-and-phone composition on desktop and readable content-first composition on mobile.      | Both entry paths work without starting or completing the tour, including when models fail.                                                            |
| P1       | Processing captures clicks and pointer events across the document. | Remove document-wide pointer/click suppression and keep navigation, locale controls, and skip usable during transitions.                                              | A visitor can use the language menu or leave for a Vault while the demo is running.                                                                   |
| P2       | The tour has only an implicit scroll cue.                          | Add localized Explore/Continue and Skip intro controls. Skip must reveal the unlocked sample journey, cancel pending phase timing, and transfer focus to its heading. | Skip works before model readiness and during processing; late callbacks do not restart the intro.                                                     |
| P2       | Mobile hierarchy and supporting text need refinement.              | Retain shared 48px action sizing; avoid crowded labels; make synthetic-preview context explicit; improve landing-specific text contrast and heading structure.        | Indonesian and English remain usable at narrow widths, by keyboard, and with reduced motion. Review appearance directly rather than asserting pixels. |
| P2       | The final CTA omits the Local Vault path.                          | Offer Local Vault first, Hosted Vault second, and self-hosting as the tertiary action; retain a persistent sign-in action in navigation.                              | Entry and closing actions describe the same product choices and retain their existing destinations.                                                   |

All five action items are implemented in the landing context and both message catalogs. Existing scroll-driven scenes remain available; visitors can bypass the intro rather than wait for them. The full hosted journey still uses its existing scroll timeline.

## Implementation details

- Reuse shared Button variants and existing color/focus tokens. Keep shared app-shell and preview components unchanged.
- Preserve the `scene` renderer layout and the PhoneStoryProvider DOM-anchor contract. Skipping bypasses only the unlock preview, not the renderer sizing integration.
- Keep the mobile journey's sticky-stage spacing consistent with its new heading so the first explanation remains reachable.
- Keep transition feedback local to the tour control. Remove the old floating spinner and animated scroll-arrow styles that no longer have a rendered owner.
- Correct contrast locally for the landing brand, journey annotations, and closing actions. Do not redefine the shared primary color.
- `/` still redirects to `/landing`. The `ui-preview` routes do not compose the landing header or experience; no shared primitive or preview harness behavior changes.

## Implementation review follow-up

- **Spec review, P2 — delayed showcase readiness:** the Local/Hosted overlay could become hidden while the device showcase was still loading. Keep the overview available until readiness arrives. A regression test reproduces the stalled-readiness case and verifies both entry paths remain available before and after the callback.
- **Standards review — narrow-button hypothesis withdrawn:** computed styles and Chromium text-range measurements at 320 × 568 confirmed wrapping labels stay inside both 48px buttons. Do not treat a source-only overflow hypothesis as a confirmed defect.
- **Direct accessibility review:** correct the landing-specific low-contrast brand/annotations and the closing Hosted action's inherited foreground. Keep these corrections local rather than changing shared app tokens.

## Verification and review policy

Preserve the existing landing fallback and locale tests. Extend them only for functional entry, skip, focus, and navigation safety. No tests or CI gates are removed.

Verification includes targeted landing/app-shell unit tests, targeted Chromium landing/locale tests, desktop and mobile browser inspection in both locales, accessibility scans, independent standards/spec review, and the fresh root `pnpm run test:full` gate before committing.

Browser evidence is held outside the repository in `/tmp/rhasia-landing-review/`. Automated accessibility scans are supporting evidence, not a claim of complete WCAG compliance: canvas-backed content can require manual contrast review, and inert device previews can produce duplicate-ID review warnings. Physical-device testing and customer validation are not claimed.
