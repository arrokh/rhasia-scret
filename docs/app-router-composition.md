# App Router composition

`apps/web/src/app` is the Next.js composition layer, not an implementation owner. Its directory tree contains only recognized App Router convention files and file-based metadata assets.

## Allowed files

Route segments may contain Next.js conventions such as `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `global-error.tsx`, `not-found.tsx`, `template.tsx`, `default.tsx`, and `route.ts`. Framework-generated metadata conventions such as `manifest.ts`, `robots.ts`, `sitemap.ts`, `opengraph-image.*`, and `twitter-image.*` may remain under `app`. Prefer static icon, favicon, image, and other media files under `public/assets` (or a capability-specific `public` directory such as `public/pwa`) and reference them explicitly through Next metadata. Use an `app` file-based metadata asset only when its framework-generated behavior is required.

Do not add arbitrary support modules, route-local component directories, infrastructure adapters, fixtures, clients, loaders, stylesheets, or ordinary static assets under `app`, including `_components` or `components` directories.

## Ownership

| Concern | Location |
| --- | --- |
| Domain or use-case presentation | `src/modules/<context>/presentation/` |
| Context preview harnesses | Owning context presentation, exposed through `modules/<context>/preview.ts` |
| Next page composition shared by one context | Owning context presentation, exposed through a context entry point such as `modules/<context>/page.ts` |
| Shared presentation mechanics and global styles | `src/shared/presentation/` |
| Reusable UI primitives | `src/components/ui/` |
| Server adapter composition for route handlers | `modules/<context>/server.ts` |
| Static favicon, icon, image, and media assets | `public/assets/` or a capability-specific `public` directory |
| Next route, layout, loading, error, and generated-metadata conventions | `src/app/` |

App Router convention files resolve framework concerns such as route parameters, localization, redirects, streaming boundaries, and HTTP request/response mapping, then compose behavior through owning module entry points. They must not become an alternate home for domain behavior or presentation implementations.

Development-preview routes follow the same rule. Their `page.tsx` files remain under `app/ui-preview`, while preview implementations and fixtures live with the context they demonstrate.

## Enforcement

`src/tests/unit/architecture/architecture-review-boundaries.test.ts` inventories every file under `src/app` and rejects basenames that are not recognized Next.js conventions or file-based metadata assets. When Next.js introduces a new convention, update the inventory deliberately instead of adding a blanket exception.
