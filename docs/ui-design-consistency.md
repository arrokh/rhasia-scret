# UI design consistency

This document is the maintenance contract for production UI and development previews. `AGENTS.md` requires repository agents to follow it for every presentation change.

## Reuse before adding

- Inspect the requested screen, its sibling routes, and relevant `apps/web/src/app/ui-preview/**` compositions before changing layout or controls.
- Reuse shared components, Button variants, and established spacing, typography, color, and focus tokens. Do not introduce one-off dimensions or visual patterns when an existing shared token can express the intent.
- When a shared component changes, check every affected production and preview surface. Keep previews composed from the same production implementation and update matching tests when needed.

## Action sizing

`apps/web/src/components/ui/button.tsx` owns the shared size tokens:

| Button size      | Geometry                | Intended use                                              |
| ---------------- | ----------------------- | --------------------------------------------------------- |
| `default`        | 48px tall (`h-12`)      | Standard labeled actions                                  |
| `icon`           | 48px square (`size-12`) | Standard icon-only action; matches `default` in a toolbar |
| `icon-lg`        | 48px square (`size-12`) | Prominent icon-only action                                |
| `lg`             | 48px tall (`h-12`)      | Prominent labeled action                                  |
| `sm`             | 40px tall (`h-10`)      | Compact contextual action                                 |
| `icon-sm`        | 40px square (`size-10`) | Compact contextual icon action                            |
| `xs` / `icon-xs` | 32px high/square        | Dense, secondary controls only                            |

Within one section header, toolbar, or action group, all peer actions must use the same size tier and align on the same center line. Prefer `default` with `icon` for standard section actions; use compact sizes only when the entire peer group has a deliberate compact treatment. Icon-only controls require an accessible name and tooltip/title where appropriate. Do not override dimensions ad hoc in a page to hide a mismatch—change or add a shared Button token and review the affected surfaces.

## Card surfaces and content spacing

- Use the shared `SurfaceCard` for equivalent card shells instead of styling parallel routes independently.
- The standard inset for paired primary-card content is `SURFACE_CARD_CONTENT_PADDING_CLASS` from `apps/web/src/shared/presentation/app-ui.tsx`: 20px on narrow layouts and 24px from the `sm` breakpoint. Keep grid gaps and internal section spacing separate from this outer content inset.
- If comparable pages need different card surfaces or padding for a deliberate reason, document the distinction. Otherwise, review the surfaces and responsive content paddings directly; computed-style equality alone does not justify a browser test.

## Responsive and accessibility review

- Check desktop and narrow/mobile layouts, including long Indonesian labels and English copy. Standard section actions should retain their token geometry (48px) across breakpoints; fit copy by adapting the layout, spacing, or text wrapping within that height rather than using `h-auto` or extra vertical padding that enlarges the row. Do not truncate labels. If a design genuinely requires taller actions, document the exception and keep the full peer group and equivalent section actions consistent.
- Preserve visible keyboard focus, sufficient contrast, accessible names, touch targets, and reduced-motion behavior.
- Keep interaction hierarchy consistent: primary actions, secondary actions, and destructive actions must remain visually distinct and use the established Button variants.

## Loading and layout stability

- Loading placeholders should reserve the same header slots and geometry as the resolved route, including back actions and right-side controls. Use a route-specific skeleton option when those slots differ.
- Match placeholder action dimensions to the shared Button tokens and keep skeleton card surfaces/content insets consistent with the loaded card.
- Approximate the resolved content's main responsive heights and wrapping. Prefer modest, deliberate reserved space over a skeleton whose replacement causes a large vertical jump.
- Test the loading boundary when it affects core-action availability or sensitive-state visibility; review skeleton dimensions directly.

## Regression coverage

Follow [core-flow testing policy](core-flow-testing.md). Visual rules above guide implementation and direct review; cosmetic fidelity alone is not an automated acceptance criterion.

When a shared visual token or component changes:

1. Inspect affected production and preview routes and verify that previews still represent production UI.
2. Preserve core-action reachability, accessible names, keyboard/touch use, and safety warnings.
3. Add/update focused tests only for changed functional behavior. Use Chromium when actual browser layout or focus/touch behavior is necessary to prove a core action remains usable.
4. Review appearance directly rather than asserting exact token classes, dimensions, surfaces, or animation geometry. Run the existing required gates; changes to their selection await the test-pruning review.
