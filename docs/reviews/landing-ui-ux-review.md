# Landing consistency review

## Accepted scope

The user rejected the earlier composition changes and requested the original implementation from the latest `main`, with focused consistency fixes rather than a redesign.

Baseline: `origin/main` at `710c76155a6244b6469d857256a562104ecc6098`.

Preserve the original layout, centered phone, device showcase, scroll-driven animation, typography, actions, copy, localization, and synthetic previews. The previously proposed content-first layout and new tour controls are not the accepted direction.

## Confirmed issue and correction

The earlier translucent gradient and blur exposed a strong gray band from dark devices beneath the hero card, so the card was changed back to opaque ivory. After the user approved a glass treatment, the accepted direction is a warm, high-opacity glass-like surface with a 24px backdrop blur where supported; browsers without `backdrop-filter` keep the opaque `--background` fallback. Preserve the original shape, placement, shadow, transition, copy, and readable amber text.

Keep the story environment plain ivory while the shared WebGL floor loads. Make the footer opaque so the grid does not bleed through it.

## Single background implementation

User screenshots exposed a second issue: the initial CSS grid used different spacing and detail from the WebGL floor that replaced it after loading. The user selected one implementation: the shared WebGL floor shown after loading.

`LandingStoryEnvironment` owns one persistent WebGL cyclorama floor for the initial phone, device showcase, journey, and model-failure states. It stays hidden while Three.js initializes; the underlying surface is plain ivory. Reveal the floor only after its first successful render. Both device renderers remain transparent and draw devices and shadows only. There must be no CSS grid fallback or second floor renderer.

The shared floor camera follows the showcase camera's top/side progress and transition duration so the floor recedes in perspective while the devices expand, then returns overhead as they leave. Keep device/camera animation and shadow placement unchanged. No source pixel-regression test was added for this cosmetic invariant.

The phone appeared after model loading during reproduction. A permanent missing-phone failure was not reproduced and is not claimed fixed by the background change.

## Journey card connection

The first desktop card begins beside the phone's visible top edge. Its active state uses the connector's amber color on the border and icon without lifting the card. The active step is exposed to assistive technology. On card changes, both endpoint nodes glide toward their next phone/card anchors while the connector redraws between them. The distance-based ease-out lasts 180–340ms, can retarget from its current position, and keeps the SVG group mounted. The guide node sits just inside the active card's straight left edge, clear of its rounded corners, so it meets the card border without overlapping the note. Desktop selection follows the first card's center beside the phone's top edge, while mobile keeps its lower reading point. A 64px hysteresis prevents small scroll reversals from switching steps back and forth.

Verified on desktop and mobile in Chromium. The phone/card top edges are within 1px at 1769×1072. A focused scroll test covers reversal stability and node travel; reduced-motion snaps directly to the selected anchors.

The hero card uses a warm translucent material with a solid fallback. At widths up to 420px, its Local Vault and Hosted Vault actions stack at equal width with a centered separator, preserving the shared 48px button height and keeping labels on one line. Verified at 1440×960, 390×844, and 320×720 in English and Indonesian; there was no horizontal overflow or browser error.

## Verification scope

Review desktop and mobile renders of the original composition, plus the existing landing model-fallback, keyboard, and locale tests. Run the repository full gate before any new commit or PR update. Cosmetic background colors do not justify new pixel-assertion unit tests.

Evidence stays outside source under `/tmp/rhasia-landing-review/`. The local preview remains at `http://localhost:3207/landing`. This revision does not itself publish or deploy anything.
