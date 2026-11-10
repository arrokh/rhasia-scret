# Landing consistency review

## Accepted scope

The user rejected the earlier composition changes and requested the original implementation from the latest `main`, with focused consistency fixes rather than a redesign.

Baseline: `origin/main` at `710c76155a6244b6469d857256a562104ecc6098`.

Preserve the original layout, centered phone, device showcase, scroll-driven animation, typography, actions, copy, localization, and synthetic previews. The previously proposed content-first layout and new tour controls are not the accepted direction.

## Confirmed issue and correction

The hero overlay used a translucent gradient and backdrop blur. Dark devices behind it produced a visible gray band across the card, so its ivory surface changed with the scene beneath it.

Use the existing `--background` token as an opaque hero surface. Keep the original shape, placement, shadow, and transition. Preserve readable amber text through the existing warning token.

Keep the story environment plain ivory while the shared WebGL floor loads. Make the footer opaque so the grid does not bleed through it.

## Single background implementation

User screenshots exposed a second issue: the initial CSS grid used different spacing and detail from the WebGL floor that replaced it after loading. The user selected one implementation: the shared WebGL floor shown after loading.

`LandingStoryEnvironment` owns one persistent WebGL cyclorama floor for the initial phone, device showcase, journey, and model-failure states. It stays hidden while Three.js initializes; the underlying surface is plain ivory. Reveal the floor only after its first successful render. Both device renderers remain transparent and draw devices and shadows only. There must be no CSS grid fallback or second floor renderer.

The shared floor camera follows the showcase camera's top/side progress and transition duration so the floor recedes in perspective while the devices expand, then returns overhead as they leave. Keep device/camera animation and shadow placement unchanged. No source pixel-regression test was added for this cosmetic invariant.

The phone appeared after model loading during reproduction. A permanent missing-phone failure was not reproduced and is not claimed fixed by the background change.

## Verification scope

Review desktop and mobile renders of the original composition, plus the existing landing model-fallback, keyboard, and locale tests. Run the repository full gate before any new commit or PR update. Cosmetic background colors do not justify new pixel-assertion unit tests.

Evidence stays outside source under `/tmp/rhasia-landing-review/`. The local preview remains at `http://localhost:3207/landing`. This revision does not itself publish or deploy anything.
