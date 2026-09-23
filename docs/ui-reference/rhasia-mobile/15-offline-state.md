# 15 — Offline state

![Offline state reference](15-offline-state.png)

> **Design-system contract:** This screen inherits [`design-system.md`](design-system.md).

## UI and layout

A pale warm/offline canvas distinguishes this global state from normal operation. A centered cloud-off illustration, direct status title, explanatory copy, outlined amber retry button, and persistent navigation make recovery discoverable.

## Style and components

Use amber/orange only as a warning role; preserve the white/neutral mobile shell and compact bottom navigation. Components: offline illustration, status heading, consequence copy, retry/reconnect button, connection-status indicator, disabled mutation controls, navigation.

## Expected behaviour

This represents read-only offline access from an encrypted Personal-only Local Vault Snapshot. Shared Vaults are online-only and must not appear in the offline picker or account list. Locally generated Personal Vault OTPs may remain available after unlock, but all writes—account changes, invitations, membership changes, deletion, and settings that mutate server state—must be blocked and never queued. On reconnection, synchronize revisions; reject and clear any legacy snapshot that may contain Shared Vault data, without touching the independent writable Local Vault.

## Flow

Connectivity loss → evict transient Shared Vault material → detect Personal-only snapshot availability → unlock Personal Vault locally → show read-only OTP access and offline warning → retry/reconnect → synchronize or clear legacy/revoked hosted data according to server authorization.
