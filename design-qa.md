# Design QA

- Source visual truth: the user's annotated landing-page screenshots, including the intermediate-width reference at `/var/folders/m8/m04n524j7535kmgr9ll1wry40000gn/T/TemporaryItems/NSIRD_screencaptureui_2TQB71/Screenshot 2026-07-30 at 15.21.19.png`
- Responsive contact sheet: `/Users/arrokh/.codex/worktrees/790b/rhsia-scret/qa-responsive-contact-sheet.jpg`
- Focused smallest-viewport screenshot: `/Users/arrokh/.codex/worktrees/790b/rhsia-scret/qa-responsive-320x568-after.jpg`
- Focused 481 px screenshot: `/Users/arrokh/.codex/worktrees/790b/rhsia-scret/qa-mobile-481-after.png`
- Focused 732 px hero screenshot: `/Users/arrokh/.codex/worktrees/790b/rhsia-scret/qa-hero-732-after.png`
- State: English landing page at the top of the page

## Viewport matrix

| CSS viewport | Layout mode | Horizontal overflow | Result |
| --- | --- | ---: | --- |
| 320 × 568 | compact mobile | 0 px | passed |
| 375 × 812 | mobile | 0 px | passed |
| 481 × 1199 | large mobile | 0 px | passed |
| 640 × 900 | compact tablet | 0 px | passed |
| 732 × 1199 | compact tablet | 0 px | passed |
| 767 × 1024 | tablet boundary | 0 px | passed |
| 768 × 1024 | tablet, two-column hero | 0 px | passed |
| 910 × 1300 | intermediate desktop, two-column hero | 0 px | passed |
| 1024 × 768 | compact desktop | 0 px | passed |

## Full-view comparison evidence

The matrix covers the narrowest supported mobile presentation through desktop, including both sides of the 768 px hero breakpoint. The hero keeps its compact image-backed card through 767 px and switches to the contained two-column composition at 768 px. The comparison flow, Vault examples, deliberate-path section, header, and sticky mobile CTA remain inside their containers at every tested width.

## Focused findings

- At 320 px the flow now uses compact icon-only device cards around a narrower Vault card, preserving the requested left-device, center-Vault, right-service composition without crushing either side.
- At 481 px the device column receives more room, the center Vault card is less dominant, and the three protected-service icons remain legible.
- Vault preview cards use 16 px horizontal padding on mobile; the copy target remains `https://alvin.vercel.app` and the `Copied!` feedback is still available.
- At 640 px, 732 px, and 767 px the hero remains one contained image-backed card instead of revealing a separate oversized illustration.
- At 768 px and 910 px the hero text and artwork remain side by side, with the artwork contained and CTA labels unclipped.
- At 1024 px the hero, comparison flow, and fixed header preserve their established desktop proportions.
- The responsive flow uses the compact three-column mobile arrangement and the full three-column desktop arrangement without clipped service icons or offset connectors.

## Required fidelity surfaces

- Fonts and typography: Manrope hierarchy, weight, tracking, and localized copy are preserved.
- Spacing and rhythm: mobile, tablet, intermediate desktop, and wide desktop all retain consistent section spacing.
- Colors and tokens: no palette, border, shadow, or background-token changes.
- Image quality: the existing owl/envelope artwork remains proportional and sharp.
- Localization: both language controls fit the header at the tested widths.
- Interaction: primary landing tabs and links remain available; the sticky mobile CTA does not cause horizontal overflow.

## Findings history

- Fixed the intermediate-width oversized hero by moving the two-column transition to the medium breakpoint.
- Fixed the 320 px brand wrap with a non-shrinking, no-wrap brand link.
- Kept the compact hero treatment through 767 px so the standalone artwork cannot create a giant one-column block at 732 px.
- Rebalanced the flow at 320 px and 481 px, and increased mobile Vault-preview horizontal padding.
- Removed the standalone animated dot at the right edge of the central Vault card.
- Matched the mobile and tablet device controls to the protected-service controls: both sides now use centered 48 × 48 px icon cards with hidden labels, while desktop retains the full labeled cards.
- Verified the rendered 655 px layout after the final adjustment: both side columns use three 48 × 48 px controls, the flow has 0 px horizontal overflow, and the removed Vault anchor is absent from the DOM.
- Added the same connector-line and moving-dot treatment to the compact 655 px flow. Computed styles confirm visible 78.59 px connectors, active 1.1 s animations on both sides, and 0 px horizontal overflow.
- Raised the center Vault card above the connector layer. Live hit testing across its left edge, center, and right edge now resolves to the Vault card while the underlying lines and dots remain animated.
- Verified the desktop summary at 1236 px and 1280 px: the ellipsis sits 8 px after the final visible service icon instead of being pushed to the far edge.
- Removed the protected-services trunk and the separate Vault stem. At 1384 px, all three service connectors now converge directly on the same right-center point of the Vault card; the computed endpoints are within 2 px of that shared point, the dots follow each direct line, and horizontal overflow remains 0 px.
- Mirrored the converging connector geometry on the device side so all three left lines and their animated dots meet the Vault card at one shared left-center point.
- Made the desktop hero consume the viewport height remaining below the 100 px landing header with dynamic viewport units, keeping the following section below the initial fold across desktop heights.
- Re-ran the full responsive matrix after the final fix; no actionable P0, P1, or P2 layout issue remains.

final result: passed
