# Rhasia-Scret — Mobile Design System

## 1. Brand Direction

**Rhasia-Scret** is a shared TOTP authenticator for families and trusted small groups.

The visual identity should feel:

- trustworthy, without feeling corporate or intimidating
- friendly and approachable for non-technical family members
- protective and private
- calm and dependable
- slightly playful through the owl mascot
- clear and functional during time-sensitive OTP usage

The latest app icon establishes the primary visual direction:

- a friendly owl representing wisdom and watchfulness
- a dark shield representing protection
- a golden lock representing secure access
- warm neutral surfaces instead of cold security-product gradients
- soft three-dimensional forms with restrained shadows
- rounded geometry and expressive character details

The application UI should use the same emotional language without becoming overly decorative.

## 2. Brand Personality

| Attribute | Meaning in the Product |
|---|---|
| **Trusted** | Security states are explicit, consistent, and understandable. |
| **Friendly** | Language and visuals are approachable for family members. |
| **Protective** | Sensitive actions require clear confirmation and re-authentication. |
| **Calm** | Screens avoid visual noise, excessive warnings, and aggressive colors. |
| **Helpful** | The UI explains sharing, expiration, sync, and access limitations clearly. |
| **Dependable** | OTP codes remain prominent and accessible, including offline. |

## 3. Logo and Mascot Usage

### 3.1 Primary mascot

The owl holding a shield and lock is the primary brand illustration.

Use it for:

- app icon
- login screen
- vault unlock screen
- onboarding
- empty states
- recovery guidance
- trusted-device confirmation
- successful vault creation

Avoid using the full mascot repeatedly inside dense operational screens such as the OTP list.

### 3.2 Simplified brand mark

Create a simplified mark for small surfaces:

```text
Owl eyes + shield
```

or:

```text
Shield + small owl brow silhouette
```

Use it for favicon, navigation logo, loading indicator, notification icon, and 16–32 px usage.

### 3.3 Wordmark

Official product spelling:

```text
rhasia-scret
```

Wordmark treatment:

- `rhasia-` uses the dark ink color
- `scret` uses the warm gold accent
- use rounded lowercase typography
- do not use gradients
- do not stretch or condense the wordmark
- maintain generous clear space

## 4. Core Color Palette

The palette is derived from the latest owl icon.

### 4.1 Brand colors

| Token | Hex | Usage |
|---|---:|---|
| `brand.ink` | `#273039` | Primary text, shield, navigation icons |
| `brand.inkStrong` | `#171D22` | High-emphasis text, lock keyhole, dark states |
| `brand.gold` | `#E5A72E` | Primary brand accent, selected states, highlights |
| `brand.goldStrong` | `#C88717` | Pressed state, stronger emphasis |
| `brand.goldSoft` | `#F5D998` | Soft badge and highlighted surface |
| `brand.taupe` | `#91867E` | Owl wings, secondary illustration details |
| `brand.stone` | `#B9ADA3` | Owl body, neutral visual accents |
| `brand.cream` | `#F8F4ED` | Main app background |
| `brand.surface` | `#FFFDF9` | Cards, dialogs, bottom sheets |
| `brand.border` | `#DED8D0` | Borders and separators |

### 4.2 Neutral scale

| Token | Hex | Recommended usage |
|---|---:|---|
| `neutral.950` | `#171D22` | Maximum emphasis text |
| `neutral.900` | `#273039` | Primary text |
| `neutral.800` | `#3B444C` | Secondary headings |
| `neutral.700` | `#586169` | Secondary text |
| `neutral.600` | `#737B81` | Metadata |
| `neutral.500` | `#90969B` | Placeholder and disabled icon |
| `neutral.400` | `#B1B5B8` | Disabled border |
| `neutral.300` | `#D1D3D4` | Divider |
| `neutral.200` | `#E5E3DF` | Border |
| `neutral.100` | `#F1EEE9` | Subtle background |
| `neutral.50` | `#F8F4ED` | App canvas |
| `neutral.0` | `#FFFDF9` | Elevated surface |

### 4.3 Semantic colors

Semantic colors should be muted and used sparingly.

| Token | Hex | Usage |
|---|---:|---|
| `success.default` | `#3D7452` | Synced, completed, active |
| `success.surface` | `#EAF3EC` | Success banner background |
| `warning.default` | `#A5661B` | Expiring OTP, pending sync |
| `warning.surface` | `#FFF2D8` | Warning banner background |
| `danger.default` | `#A4433D` | Remove member, delete vault |
| `danger.surface` | `#F9E9E6` | Destructive warning |
| `info.default` | `#526D82` | General information |
| `info.surface` | `#EAF0F4` | Information banner |

### 4.4 Color usage rules

- Use cream as the default page background.
- Use warm-white surfaces for cards and sheets.
- Use dark ink for all essential reading and OTP content.
- Use gold only for primary actions, selected states, countdown accents, and trusted confirmations.
- Do not use gold for large text paragraphs.
- Do not use gradients in the application UI.
- Do not use saturated blue as the primary brand color.
- Do not rely on color alone to communicate security status.
- Always pair state color with an icon and text label.

## 5. Design Tokens

### 5.1 Background and surface

```css
--color-bg-app: #F8F4ED;
--color-bg-surface: #FFFDF9;
--color-bg-muted: #F1EEE9;
--color-bg-selected: #FFF2D8;
```

### 5.2 Text

```css
--color-text-primary: #273039;
--color-text-strong: #171D22;
--color-text-secondary: #586169;
--color-text-muted: #737B81;
--color-text-disabled: #90969B;
--color-text-on-accent: #171D22;
```

### 5.3 Border

```css
--color-border-default: #DED8D0;
--color-border-subtle: #E5E3DF;
--color-border-strong: #B1B5B8;
--color-border-focus: #C88717;
```

### 5.4 Action

```css
--color-action-primary: #E5A72E;
--color-action-primary-hover: #D49722;
--color-action-primary-pressed: #C88717;
--color-action-secondary: #273039;
```

## 6. Typography

### 6.1 Font direction

Use a rounded but highly readable sans-serif.

Recommended options:

1. Manrope
2. Nunito Sans
3. Inter
4. DM Sans

Recommended pairing:

- UI and content: `Manrope`
- OTP code: the same family with tabular numbers, or `Roboto Mono`

Avoid highly playful fonts in operational screens.

### 6.2 Type scale

| Style | Size | Weight | Line height |
|---|---:|---:|---:|
| Display | 32 px | 700 | 40 px |
| Page title | 24 px | 700 | 32 px |
| Section title | 18 px | 700 | 26 px |
| Card title | 16 px | 650 | 24 px |
| Body | 16 px | 400 | 24 px |
| Body small | 14 px | 400 | 20 px |
| Label | 13 px | 600 | 18 px |
| Caption | 12 px | 500 | 16 px |
| OTP code | 32–36 px | 650 | 40 px |

### 6.3 OTP typography

- use tabular numbers
- use grouped format such as `482 193`
- avoid excessive letter spacing
- maintain sufficient contrast
- minimum size on mobile: `32 px`
- do not place decorative type behind or near the code

## 7. Shape and Elevation

### 7.1 Radius

| Token | Value | Usage |
|---|---:|---|
| `radius.sm` | 8 px | Small controls |
| `radius.md` | 12 px | Inputs and badges |
| `radius.lg` | 16 px | Cards and bottom sheets |
| `radius.xl` | 24 px | Empty-state illustration containers |
| `radius.full` | 999 px | Pills, avatars, countdown circles |

### 7.2 Shadows

```css
--shadow-card:
  0 1px 2px rgba(23, 29, 34, 0.04),
  0 8px 24px rgba(23, 29, 34, 0.06);

--shadow-sheet:
  0 -8px 30px rgba(23, 29, 34, 0.10);
```

Avoid bright colored shadows, glowing effects, and strong skeuomorphic bevels in operational UI.

The mascot illustration may retain soft 3D depth, while the application interface should remain flatter and calmer.

## 8. Spacing and Layout

Use a 4 px spacing grid.

| Token | Value |
|---|---:|
| `space.1` | 4 px |
| `space.2` | 8 px |
| `space.3` | 12 px |
| `space.4` | 16 px |
| `space.5` | 20 px |
| `space.6` | 24 px |
| `space.8` | 32 px |
| `space.10` | 40 px |
| `space.12` | 48 px |

Mobile layout:

- horizontal page padding: `16 px`
- card gap: `12 px`
- section gap: `24 px`
- minimum touch target: `44 × 44 px`
- bottom-navigation safe-area padding required
- avoid content touching screen edges

## 9. Iconography

Use rounded outline icons with consistent stroke weight.

Recommended characteristics:

- 1.75–2 px stroke
- rounded terminals
- simple geometry
- no filled icons except selected navigation state
- dark ink by default
- gold for selected or active states

Important icon concepts:

- shield: protected vault
- owl eyes: watchfulness
- lock: locked state
- clock: TOTP timing
- people: shared members
- cloud: sync state
- key: setup key and recovery
- copy: copy OTP
- scan: QR scanner

## 10. Mobile Information Architecture

Recommended bottom navigation:

```text
Home
Vaults
Activity
Settings
```

For a smaller MVP:

```text
Home
Vaults
Settings
```

The add-account action should be a floating action button or a prominent button inside vault detail.

Do not make add-account a permanent bottom-navigation item.

## 11. Adjusted Mobile Screen Design

### 11.1 Login

Visual direction:

- cream background
- owl mascot centered in the upper area
- `rhasia-scret` wordmark beneath the mascot
- simple email or magic-link form
- dark ink text
- gold primary button
- friendly invite-only explanation

Suggested copy:

```text
Your family’s shared codes,
kept safe and easy to reach.
```

Primary action:

```text
Continue
```

Supporting text:

```text
Access is available by invitation only.
```

### 11.2 Vault unlock

Use the owl as a protective guide, but smaller than on login.

```text
[Small owl and shield illustration]

Your vault is locked

Unlock to access your authenticator codes.

[PIN or biometric control]

Unlock vault
```

Use gold for the active PIN indicator and primary action. Do not use technical cryptography terms here.

### 11.3 Home / OTP list

The home screen is the most functional screen and should be visually restrained.

```text
Good morning, Alvin
[lock status] [profile]

Search accounts

Pinned
Recently used
Shared with you
```

OTP card:

```text
[Service icon] GitHub
               alvin@example.com

482 193                         18s

Family Vault                 [Copy]
```

Adjusted styling:

- warm-white card
- dark ink OTP
- gold countdown ring
- subtle border
- no colored gradients
- shared-vault label in muted taupe

### 11.4 Vault list

Personal vault card:

```text
[Shield icon] Personal Vault
8 accounts
Only you
```

Shared vault card:

```text
[People icon] Family Vault
5 accounts · 4 members
Owner
```

Selected vault:

- gold-soft surface
- dark ink border
- small gold indicator

Do not fill every shared vault card with different colors.

### 11.5 Vault detail

```text
Family Vault
Owner · 4 members

Accounts | Members | Activity
```

Active tab:

- dark ink text
- gold underline
- no blue indicator

Owner action:

```text
Add account
```

Use a gold button or compact floating button.

### 11.6 Add authenticator

Bottom-sheet options:

```text
Scan QR code
Upload QR image
Enter setup key
```

Each option uses a neutral icon container, dark ink title, secondary description, and subtle border.

### 11.7 QR scanner

Use a mostly dark camera view with warm-neutral controls.

Scanner frame:

- warm-white corners
- gold active scanning line
- cream instruction text
- dark translucent controls

```text
Position the QR code inside the frame
```

Fallback:

```text
Enter setup key instead
```

Never use mascot art over the live camera preview.

### 11.8 Account review

```text
Review account

GitHub
alvin@example.com

Type
TOTP

Save to
Family Vault
```

Shared-vault notice:

```text
Members of Family Vault will be able to generate codes for this account.
```

Use warning-surface cream/gold styling, not red.

### 11.9 Members

```text
[Avatar] Alvin
         Owner

[Avatar] Mega
         Can view and copy
```

Role badge colors:

- owner: gold-soft
- editor: neutral ink-soft
- viewer: neutral surface

Do not assign random colors per person.

### 11.10 Invite member

Permission wording:

```text
Can view and copy OTP
```

Do not expose raw role enum values such as `VIEWER`.

Primary action:

```text
Send invitation
```

Supporting note:

```text
This member can view codes in this vault but cannot manage accounts.
```

### 11.11 Activity

```text
Alvin added GitHub
10:42

Mega joined Family Vault
09:18
```

Use small semantic icons. Never include OTP codes in activity history.

### 11.12 Settings

#### Security

- Auto-lock
- Hide codes in app switcher
- Require unlock for sensitive actions

#### Account

- Email
- Trusted devices
- Sign out

#### Data

- Sync status
- Encrypted backup
- Recovery

#### Appearance

- Theme
- Reduce motion

Use neutral switch controls with gold active states.

## 12. Component System

### 12.1 Primary button

```text
Background: brand.gold
Text: brand.inkStrong
Radius: 12 px
Height: 48 px
```

States:

- default: `#E5A72E`
- hover: `#D49722`
- pressed: `#C88717`
- disabled: neutral surface and muted text

### 12.2 Secondary button

```text
Background: transparent
Border: brand.border
Text: brand.ink
```

### 12.3 Destructive button

Use danger text and light danger surface. Avoid solid red unless the action is irreversible and immediately destructive.

### 12.4 Input

```text
Background: brand.surface
Border: brand.border
Text: brand.ink
Focus border: brand.goldStrong
Radius: 12 px
Height: 48 px
```

### 12.5 OTP card

Required content:

- service icon
- issuer
- account identifier
- OTP code
- countdown
- vault source
- copy action

States:

- normal
- copied
- nearly expired
- expired/recalculating
- offline
- access revoked

### 12.6 Vault card

Required content:

- vault icon
- name
- account count
- member count
- role
- sync status when abnormal

### 12.7 Role badge

```text
Owner
Can manage
Can view
```

Avoid uppercase technical role names.

### 12.8 Security banner

Variants:

- info
- warning
- danger
- success

Always include an icon, concise message, optional action, and accessible text.

## 13. Motion

- 150–200 ms for button and control transitions
- 200–250 ms for bottom sheets
- soft scale or fade for copy confirmation
- countdown ring updates smoothly
- no bouncing OTP cards
- no playful mascot animation during urgent OTP interaction

Mascot animation is acceptable during onboarding, successful unlock, empty vault, and completed invitation.

Support reduced motion.

## 14. Accessibility

Required:

- WCAG AA contrast
- 44 px minimum touch targets
- keyboard navigation for web/PWA
- clear focus ring using goldStrong plus outer neutral contrast
- screen-reader labels for countdown
- copy confirmation announced through a live region
- status communicated through text and icons, not color alone
- OTP readable at 200% zoom
- reduced-motion support
- no secret exposed in accessible labels unintentionally

Suggested OTP announcement:

```text
GitHub code 482193. Expires in 18 seconds.
```

Avoid announcing every countdown second automatically.

## 15. Content Guidelines

Tone:

- calm
- direct
- supportive
- non-technical
- honest about limitations

Prefer:

```text
Your vault is locked.
```

Instead of:

```text
Cryptographic session unavailable.
```

Prefer:

```text
You no longer have access to this vault.
```

Instead of:

```text
Authorization failed.
```

Prefer:

```text
Codes are generated on this device.
```

Instead of:

```text
TOTP derivation occurs client-side.
```

## 16. Important Product States

### Locked

```text
Your vault is locked.
Unlock to access your codes.
```

### Offline

```text
You’re offline.
Your saved codes still work. Changes will sync when you reconnect.
```

### Syncing

```text
Syncing changes…
```

### Sync failed

```text
Some changes haven’t synced.
Your saved codes are still available.
```

### Access revoked

```text
You no longer have access to this vault.
```

### Empty personal vault

```text
No authenticator accounts yet.
Add your first account by scanning a QR code.
```

### Empty shared vault

```text
This shared vault has no accounts yet.
Only owners can add an account.
```

### OTP nearly expired

```text
Code expires in 3 seconds.
```

Do not prevent copying, but clearly communicate expiry.

## 17. Design Do and Don’t

### Do

- prioritize OTP readability
- use warm neutral surfaces
- use gold as a restrained accent
- use mascot illustrations for emotional moments
- keep operational screens clean
- clearly distinguish personal and shared vaults
- use human-readable permissions
- show offline and sync states clearly

### Don’t

- use gradients
- turn every screen into a mascot showcase
- use bright blue as the primary brand color
- hide all OTP codes behind repeated reveal actions
- use red for normal expiration
- place raw secrets in ordinary screens
- make vault selection mandatory before every OTP copy
- use technical cryptography terminology in family-facing UI
- use decorative shadows around OTP numbers

## 18. Suggested Tailwind Theme Mapping

```ts
const colors = {
  brand: {
    ink: "#273039",
    inkStrong: "#171D22",
    gold: "#E5A72E",
    goldStrong: "#C88717",
    goldSoft: "#F5D998",
    taupe: "#91867E",
    stone: "#B9ADA3",
    cream: "#F8F4ED",
    surface: "#FFFDF9",
    border: "#DED8D0",
  },
  success: {
    DEFAULT: "#3D7452",
    surface: "#EAF3EC",
  },
  warning: {
    DEFAULT: "#A5661B",
    surface: "#FFF2D8",
  },
  danger: {
    DEFAULT: "#A4433D",
    surface: "#F9E9E6",
  },
  info: {
    DEFAULT: "#526D82",
    surface: "#EAF0F4",
  },
};
```

## 19. Recommended Design Implementation Order

### Phase 1 — Foundations

- color tokens
- typography
- spacing
- iconography
- buttons
- inputs
- cards
- sheets
- banners
- navigation

### Phase 2 — Core OTP Experience

- locked screen
- home
- OTP card
- countdown
- copy feedback
- vault list
- vault detail

### Phase 3 — Account Management

- add account
- QR scanner
- account review
- account details
- delete confirmation

### Phase 4 — Sharing

- member list
- invite member
- permission badge
- revoke access warning
- activity history

### Phase 5 — Reliability

- offline state
- sync state
- conflict state
- trusted devices
- recovery
- encrypted backup

## 20. Shared Page Navigation

- Every application page uses a clear title and supporting subtitle on the left.
- Authenticated pages place the account settings action on the right, vertically centered against the title block.
- A subpage uses one icon-only back action with an accessible label. Do not repeat that navigation as a `Kembali` or `Batal` button in page content.
- `Batal` remains appropriate inside a confirmation or reversible inline decision where it cancels an action rather than navigates away.
- A fixed bottom footer consistently shows the application icon and the attribution `dev by arrokh`, with `arrokh` linking to the developer's GitHub profile. Content reserves enough bottom space to remain unobscured.
- Vault navigation is page-based: the directory lists Brankas Pribadi first and then every accessible Brankas Bersama; Shared Vault details expose separate Detail, Undangan, and Audit tabs.

## 21. Final Design Direction

The product should visually communicate:

```text
A wise and friendly guardian
that keeps shared family access safe.
```

The mascot creates friendliness and recognizability. The dark shield and lock communicate trust. The cream, stone, taupe, and gold palette prevents the application from feeling cold or overly technical.

The app icon may remain expressive and three-dimensional, but the product interface should use a flatter, calmer, and more systematic interpretation of the same colors and shapes.

The main UX hierarchy remains:

```text
Home = quickly view and copy OTP
Vaults = organize accounts and permissions
Activity = understand important changes
Settings = manage security and devices
```

Security should feel present through clear states and predictable behavior—not through visual intimidation.
