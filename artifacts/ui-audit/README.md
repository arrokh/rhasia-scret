# shadcn/ui migration audit

## Rendered evidence

| Artifact | Route/state | Viewport |
|---|---|---|
| `mobile-login.png` | Invite-only sign-in | 390×844 |
| `mobile-vault-preview.png` | Vault/account list fixture | 390×844 |
| `desktop-vault-preview.png` | Vault/account list fixture | 1280×900 |
| `mobile-account-menu.png` | Account dropdown menu | 390×844 |
| `mobile-recovery-preview.png` | Destructive recovery warning/form | 390×844 |
| `mobile-confirmation-dialog.png` | Destructive confirmation dialog | 390×844 |

The fixtures contain no user ciphertext, keys, passphrases, generated OTPs, or account secrets.

## Design-system checks

- `src/app/globals.css` maps the documented cream, surface, ink, gold, taupe, stone, border, success, warning, danger, and info colors to shadcn/Tailwind semantic tokens.
- Manrope is the UI font and Roboto Mono is reserved for OTP/passphrase output.
- Controls use 12 px radii, 48 px primary/input height, restrained warm shadows, gold focus/active states, and reduced-motion handling.
- Mobile Playwright coverage verifies visible primary controls meet the 44×44 px minimum touch target.
- Status feedback pairs semantic color with Lucide icons and text.
- Dialogs, dropdown menus, sheets, selection controls, labels, keyboard dismissal, focus management, and accessible names use shadcn/ui Radix primitives.
- The OTP account card keeps tabular grouped output, explicit copy/manage actions, a text countdown state, and a polite copy-result live region without announcing every countdown tick.

## Automated evidence

`pnpm run test:all` passed after the migration:

- ESLint: pass
- TypeScript: pass
- Vitest unit/integration/contract: 62 files, 134 tests passed
- dependency-cruiser architecture: 258 modules, 836 dependencies, no violations
- Playwright browser tests: 6 passed
- Next.js production build: pass, 23 static/dynamic pages generated

`src/tests/unit/shadcn-ui-boundaries.test.ts` prevents visible native controls or the former indigo palette from re-entering presentation code. The only direct `<input>` exception is the visually hidden file picker required for QR-image upload; its visible interaction is a shadcn `Button` trigger.
