# 05 — Vault detail — accounts

![Vault detail accounts reference](05-vault-detail-accounts.png)

> **Design-system contract:** This screen inherits [`design-system.md`](design-system.md).

## UI and layout
The Vault header pairs an identity icon, name, role, member avatars/summary, and settings action. Tabs place Accounts first, with Members and Activity alongside. The Accounts tab presents a dense scrolling OTP-card list; a wide floating `Add account` action overlays the lower content.

## Style and components
Maintain the home screen's OTP-card language: issuer mark, labels, large code, countdown ring, copy affordance, and light elevation. Components: Vault header, role label, tab bar, OTP card, countdown, copy action, owner settings action, floating add button.

## Expected behaviour
For an Owner, accounts, Members, Activity, add, and configuration routes may be available according to authorization. For a Viewer, show only encrypted-account content after local decryption and OTP copy; do not render member list, invitations, audit history, account mutations, or add controls. Generated codes never traverse the server.

## Flow
Open Shared Vault → authorize role → client decrypts account payloads → generate/copy OTP; Owner may add/edit accounts or open member/audit views.
