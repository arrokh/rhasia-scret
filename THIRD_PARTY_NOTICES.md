# Third-party notices and provenance

The original rhasia-scret source, documentation, and maintainer-created
assets in this repository are released under the [MIT License](LICENSE).
Third-party material remains under its own license. This file records the
material that is copied, embedded, generated, or bundled by the repository and
the action required when it is redistributed.

## Web UI, icons, fonts, and generated material

| Material                                        | Location or build path                                       | Provenance and license                                                                                                                                                    | Distribution decision                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shadcn/ui-generated primitives, adapted locally | `apps/web/src/components/ui/` and `apps/web/components.json` | Generated from shadcn/ui patterns, with Radix UI primitives and Lucide icons. The packages are permissively licensed; local source is covered by the project MIT license. | Retain the local source and package notices; review the upstream package notices when changing the generator or component set.                                                                        |
| Font Awesome brand icon paths                   | `react-icons/fa6` imports in `apps/web/src/modules/landing/` | Font Awesome Free brand assets are available under CC BY 4.0 terms; the `react-icons` package is MIT.                                                                     | Retain the icon attribution in this notice and keep only the icons used by the product. Replace an icon if its upstream terms change.                                                                 |
| Manrope and Roboto Mono web fonts               | `next/font/google` imports in `apps/web/src/app/layout.tsx`  | Google Fonts families are distributed under the SIL Open Font License 1.1.                                                                                                | The build bundles the selected fonts; retain the OFL attribution and do not rename or separately relicense the font files.                                                                            |
| Product imagery, PWA icons, and landing pattern | `apps/web/public/`                                           | Maintainer-created or generated project assets. No third-party source or attribution is recorded in repository history.                                                   | Current decision: retain under the project MIT license as project-owned material. If a maintainer later cannot confirm authorship or permission for a specific asset, replace it before distribution. |
| Next.js generated output                        | Build directories and generated files                        | Generated from repository source and dependency packages; build output is not committed.                                                                                  | Do not commit generated build output. Release artifacts must be built from a clean checkout and accompanied by this notice and the dependency-license result.                                         |

## JavaScript dependencies

The pnpm lockfile is the complete JavaScript dependency input for the web,
shared client packages, API test tools, and repository automation. The Go API
runtime uses the separate module graph in `apps/api/go.mod` and
`apps/api/go.sum`, which has its own vulnerability and license checks. The
mise-managed verification command derives its license inventory from the
current lockfile. Observed license families include MIT, Apache-2.0, ISC, 0BSD,
MIT-0, BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0, CC0-1.0, CC-BY-4.0,
EPL-2.0, LGPL-3.0-or-later, MPL-2.0, Python-2.0, Unlicense, and selectable
dual-license expressions. Packages with an `OR` expression are used under the
compatible alternative selected by the package's terms.

The most relevant direct packages include Next.js (MIT), React (MIT), PostHog
(Apache-2.0 and MIT), Radix UI (MIT), Lucide React (ISC), React Icons (MIT),
`@noble/hashes` (MIT), `jsqr` (Apache-2.0), and ZXing (Apache-2.0). The
authoritative current inventory is regenerated from the lockfile by:

```bash
mise exec -- pnpm licenses list --json
mise exec -- pnpm run verify:dependency-licenses
```

The verification script fails closed for AGPL, GPL-only, SSPL, unknown, and
unlicensed dependency identifiers. A license expression that offers a
compatible non-prohibited alternative is not rejected automatically, but the
release owner must review the package terms before shipping.

## Go API dependencies

The Go module graph is checked with pinned `govulncheck` v1.8.0 and
`go-licenses` v2.0.1 during `pnpm run verify:api-go`. The license check ignores
only the first-party Go module and rejects forbidden or unknown dependency
license types. The last verification found no reachable Go vulnerabilities and
no forbidden or unknown licenses. Go 1.27.3's standard-library finding
GO-2026-6859 was fixed by upgrading the pinned toolchain to Go 1.27.4. Review
new or updated module terms and advisories with each dependency change.

## Copied snippets and future additions

Copied code or content must be added to this inventory in the same change,
with its source, version or commit, license, and redistribution decision. A
contributor must either retain the upstream notice, replace the material with
project-owned work, or remove it. Generated files do not erase the provenance
of the source used to create them.

This inventory is a release gate, not legal advice. The maintainer approving a
release must confirm the open provenance item for project imagery and any new
dependency or generated artifact before distribution.
