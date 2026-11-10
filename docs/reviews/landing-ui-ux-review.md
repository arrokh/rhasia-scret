# Landing consistency review

## Accepted scope

The user rejected the earlier composition changes and requested the original implementation from the latest `main`, with focused consistency fixes rather than a redesign.

Baseline: `origin/main` at `710c76155a6244b6469d857256a562104ecc6098`.

Preserve the original layout, centered phone, device showcase, scroll-driven animation, typography, actions, copy, localization, and synthetic previews. The previously proposed content-first layout and new tour controls are not the accepted direction.

## Confirmed issue and correction

The hero overlay used a translucent gradient and backdrop blur. Dark devices behind it produced a visible gray band across the card, so its ivory surface changed with the scene beneath it.

Use the existing `--background` token as an opaque hero surface. Keep the original shape, placement, shadow, and transition. Preserve readable amber text through the existing warning token.

Use the same background token for the CSS story environment, model-failure fallback, and landing footer. Make the footer opaque so the grid does not bleed through it.

## Single background implementation

User screenshots exposed a second issue: the initial CSS grid used different spacing and detail from the WebGL floor that replaced it after loading. The user explicitly requested one implementation, not separate initial, fallback, and showcase backgrounds.

`LandingStoryEnvironment` now owns one persistent CSS background for the initial phone, device showcase, journey, and model-failure states. Both device renderers have transparent clears and no scene background. Remove the redundant background renderer, floor texture, cyclorama geometry, and obsolete resource cleanup. Keep device/camera animation and shadow placement; retain the existing floor-height constant only for positioning devices and their shadows.

The grid is visible without waiting for JavaScript imports or model readiness and is never replaced by a canvas. In a desktop browser check, the same background node and grid size survived the initial-to-showcase transition, both device canvases reported alpha-enabled contexts, and an unobstructed background crop had zero changed pixels between phases. No source pixel-regression test was added for this cosmetic invariant.

The phone appeared after model loading during reproduction. A permanent missing-phone failure was not reproduced and is not claimed fixed by the background change.

## Verification scope

Review desktop and mobile renders of the original composition, plus the existing landing model-fallback, keyboard, and locale tests. Run the repository full gate before any new commit or PR update. Cosmetic background colors do not justify new pixel-assertion unit tests.

Evidence stays outside source under `/tmp/rhasia-landing-review/`. The local preview remains at `http://localhost:3207/landing`. This revision does not itself publish or deploy anything.
