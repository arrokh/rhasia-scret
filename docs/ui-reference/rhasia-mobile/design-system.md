# Mobile design-system contract

This is the canonical UI system for every screen in this directory. `design-system-footer.png` is the visual source; its companion analysis explains the original specimens. Screen documents describe composition and flow, while this file resolves shared styling and component rules.

## Foundations

| Token | Value / rule | Use |
| --- | --- | --- |
| Canvas | `#F8FAFC` (very light slate) | App/page background |
| Surface | `#FFFFFF` | Cards, grouped lists, inputs, sheets |
| Primary | `#102A83` (deep indigo) | Primary actions, active navigation, OTP emphasis, selected controls |
| Text | `#101828` | Headings and primary labels |
| Muted text | `#667085` | Supporting copy, metadata, timestamps |
| Border | `#E4E7EC` | Inputs, cards, dividers, secondary controls |
| Success | `#12B76A` | Synced/success status, always with text or icon |
| Warning | `#F79009` | Syncing/warning; use amber rather than primary color |
| Offline | `#F97316` | Offline state and reconnect action |
| Danger | `#D92D20` | Destructive actions/errors |
| Focus | `#84ADFF` | Visible keyboard focus ring; never rely only on color |

Use a 4px spacing grid: 8px for compact gaps, 12px within a component, 16px default card/control padding, 24px between sections, and 32px+ for empty-state and hero separation. Use 12px radius for cards and grouped surfaces, 8px for inputs and ordinary buttons, and full radius only for avatars, countdowns, pills, and the circular primary add action. Use a 1px border or a restrained shadow—never both heavily.

## Typography and layout

- Use a single sans-serif family with normal text at 14–16px and metadata at 12px.
- Page titles are 22–24px semibold; card titles are 14px semibold; section labels are 12px semibold.
- OTPs are 24–28px semibold/tabular figures with modest letter spacing. They are the primary visual focus within an OTP card.
- Target a 390px mobile logical viewport with 16px horizontal page padding, safe-area-aware fixed bottom navigation, and 44px minimum pointer targets.
- Use sentence case for labels and actions. Keep one unambiguous primary action per page or modal.

## Shared components

### App shell and navigation
Use the light canvas, a 16px page gutter, and persistent five-item bottom navigation where the reference shows it. The active item is primary indigo and includes both icon and label. The centered add action is circular, elevated, and reserved for an authorized account-add entry point. It must be absent or disabled with an explanation when the user cannot write.

### Buttons, inputs, and choice cards
Primary buttons are deep-indigo filled, white-label, 44px minimum height controls. Secondary actions are outlined/surface controls; text actions use primary indigo. Destructive actions use danger styling and confirmation where impact is material. Inputs have label, value/placeholder, border, focus ring, validation text, and no secret value disclosure. Method cards are fully tappable 12px-radius surfaces with leading content, title/supporting copy, and trailing icon.

### OTP card and countdown
An OTP card uses a 12px surface with 16px padding: issuer icon, issuer/account text, large tabular OTP, countdown, Vault context, and an explicit copy button. The countdown communicates only the current local TOTP period. Copy is never automatic and must announce success without retaining the code in application state longer than necessary.

### Vault, list, and status patterns
Vault cards and grouped-list rows use the same surface, 12px radius, 16px inset, title/metadata hierarchy, and a 44px hit target. Role badges only represent **Vault Owner** and **Vault Viewer**. Status pairs a semantic color with an icon and text (`Synced`, `Syncing`, `Offline`, `Error`); do not communicate status by color alone.

### States and feedback
Provide loading, empty, success, validation-error, authorization-denied, and offline variants for every data-bearing screen. Empty states use the centered illustration → title → helper copy → one primary action pattern. Offline uses the Offline token, clearly states read-only limits, disables every mutation, and offers retry. Error and destructive actions use danger, are text-explicit, and never expose sensitive data.

## Security and authorization invariants

Visual consistency cannot override product requirements:

- Client decryption and OTP generation occur only after unlock; secrets, raw QR/URI data, OTPs, and keys never reach the server.
- The unlock control represents Vault Unlock Secret entry or Local Verification—not a numeric PIN. There is no automatic lock timer.
- Owners always manage Shared Vault accounts and alone manage members, invitations, Secure Share Links, recovery, or Vault Audit History. Viewers may read/copy accounts and may add/edit/soft-delete them only through Effective Shared Vault Account Permissions.
- Audit rows are redacted and opaque-ID-only. Offline mode is encrypted-snapshot, read-only access with no offline mutation queue.

## Screen-document rule

Each `NN-*.md` file must inherit this contract. If a screen-specific description conflicts with this file, this file controls styling/components and `CONTEXT.md`, `docs/mvp-plan.md`, and ADRs control product behaviour.
