# Third-party notices and provenance

The original rhasia-scret source, documentation, and maintainer-created
assets in this repository are released under the [MIT License](LICENSE).
Third-party material remains under its own license. This file records the
material that is copied, embedded, generated, or bundled by the repository and
the action required when it is redistributed.

## Native Argon2 implementation

| Material                                     | Location                                                   | License and notice                                                                                                                                                                     | Distribution decision                                                                 |
| -------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| rhasia-scret native wrapper and Expo adapter | `apps/mobile/modules/native-argon2id/` outside `c-argon2/` | MIT; the wrapper notice is retained in [`LICENSE.wrapper-MIT`](apps/mobile/modules/native-argon2id/LICENSE.wrapper-MIT).                                                               | Retain and redistribute the notice with the wrapper.                                  |
| Argon2 reference C implementation            | `apps/mobile/modules/native-argon2id/c-argon2/`            | Dual-licensed CC0 1.0 or Apache License 2.0; the complete upstream notice and license text are retained in [`c-argon2/LICENSE`](apps/mobile/modules/native-argon2id/c-argon2/LICENSE). | Retain the source and both upstream license options; do not remove the source notice. |

The native module's podspec records `MIT AND Apache-2.0` because the wrapper
and embedded implementation have separate terms. Changes to either component
must preserve the corresponding notice and be rechecked before a native
release.

## Web UI, icons, fonts, and generated material

| Material                                                      | Location or build path                                       | Provenance and license                                                                                                                                                    | Distribution decision                                                                                                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shadcn/ui-generated primitives, adapted locally               | `apps/web/src/components/ui/` and `apps/web/components.json` | Generated from shadcn/ui patterns, with Radix UI primitives and Lucide icons. The packages are permissively licensed; local source is covered by the project MIT license. | Retain the local source and package notices; review the upstream package notices when changing the generator or component set.                                                                        |
| Font Awesome brand icon paths                                 | `react-icons/fa6` imports in `apps/web/src/modules/landing/` | Font Awesome Free brand assets are available under CC BY 4.0 terms; the `react-icons` package is MIT.                                                                     | Retain the icon attribution in this notice and keep only the icons used by the product. Replace an icon if its upstream terms change.                                                                 |
| Manrope and Roboto Mono web fonts                             | `next/font/google` imports in `apps/web/src/app/layout.tsx`  | Google Fonts families are distributed under the SIL Open Font License 1.1.                                                                                                | The build bundles the selected fonts; retain the OFL attribution and do not rename or separately relicense the font files.                                                                            |
| Product imagery, PWA icons, landing pattern, and mobile icons | `apps/web/public/` and `apps/mobile/assets/`                 | Maintainer-created or generated project assets. No third-party source or attribution is recorded in repository history.                                                   | Current decision: retain under the project MIT license as project-owned material. If a maintainer later cannot confirm authorship or permission for a specific asset, replace it before distribution. |
| Next.js/Prisma/Expo generated output                          | Build directories and generated clients                      | Generated from repository source and dependency packages; build output is not committed.                                                                                  | Do not commit generated build output. Release artifacts must be built from a clean checkout and accompanied by this notice and the dependency-license result.                                         |

## JavaScript and native dependencies

The lockfile is the complete dependency input for the web, mobile, and shared
client packages. At the current lockfile revision, the mise-managed command
reviews 1,282 dependency entries across 23 license expressions. The observed
license families include MIT, Apache-2.0, ISC, BSD-2-Clause, BSD-3-Clause,
BlueOak-1.0.0, CC0-1.0, CC-BY-4.0, EPL-2.0, LGPL-3.0-or-later, MPL-2.0,
Unlicense, and selectable dual-license expressions. Packages with an `OR`
expression are used under the compatible alternative selected by the package's
terms.

The most relevant direct packages include Next.js (MIT), React (MIT), Prisma
(Apache-2.0), Supabase clients (MIT), PostHog (Apache-2.0 and MIT), Radix UI
(MIT), Lucide React (ISC), React Icons (MIT), Expo (MIT), the Noble crypto
packages (MIT), `jsqr` (Apache-2.0), ZXing (Apache-2.0), `openid-client` (MIT),
and `pg` (MIT). The authoritative current inventory is regenerated from the
lockfile by:

```bash
mise exec -- pnpm licenses list --json
mise exec -- pnpm run verify:dependency-licenses
```

The verification script fails closed for AGPL, GPL-only, SSPL, unknown, and
unlicensed dependency identifiers. A license expression that offers a
compatible non-prohibited alternative is not rejected automatically, but the
release owner must review the package terms before shipping.

## Copied snippets and future additions

Copied code or content must be added to this inventory in the same change,
with its source, version or commit, license, and redistribution decision. A
contributor must either retain the upstream notice, replace the material with
project-owned work, or remove it. Generated files do not erase the provenance
of the source used to create them.

This inventory is a release gate, not legal advice. The maintainer approving a
release must confirm the open provenance item for project imagery and any new
dependency or generated artifact before distribution.
