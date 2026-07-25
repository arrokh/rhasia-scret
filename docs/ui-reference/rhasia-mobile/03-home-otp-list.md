# 03 — Home / OTP list

![Home OTP list reference](03-home-otp-list.png)

> **Design-system contract:** This screen inherits [`design-system.md`](design-system.md).

## UI and layout
A greeting and notification affordance lead into a full-width search field. The source groups content by `Pinned` and `Shared with you`; the MVP should instead use the locally derived account order and only introduce a pinned grouping after that product decision is approved. Vertically stacked OTP cards dominate the page. Persistent bottom navigation and a raised circular add action support quick movement.

## Style and components
Use a quiet neutral background, 12px rounded white cards with a restrained border or elevation, issuer icon, account label, oversized indigo OTP, circular countdown, Vault context, and explicit copy icon. Components: app header, search input, section heading, OTP card, countdown, copy action, bottom navigation, FAB.

## Expected behaviour
Decrypt names and configurations only on the client after unlock; locally generate and refresh OTPs. Copy only after an explicit user action. Search operates over decrypted local content. Do not implement a pinned ordering in the MVP: account order is locally derived from issuer and account name.

## Flow
Unlock → decrypt and locally sort accounts → browse/search → choose copy → system clipboard receives current OTP → navigate to Vault or add account.
