"use client";

import { useEffect, useMemo, useState } from "react";

export type AccountDirectoryView = "compact" | "normal" | "wide";

export type AccountDirectoryPreferences = {
  view: AccountDirectoryView;
  vaultFilters: string[];
  order: string[];
};

const DEFAULT_PREFERENCES: AccountDirectoryPreferences = {
  view: "normal",
  vaultFilters: [],
  order: [],
};

const STORAGE_PREFIX = "rhasia-scret:account-directory:v1";

export function accountDirectoryStorageKey(profileId: string): string {
  return `${STORAGE_PREFIX}:${profileId}`;
}

export function clearAccountDirectoryPreferences(): void {
  if (typeof window === "undefined") return;
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(`${STORAGE_PREFIX}:`)) window.localStorage.removeItem(key);
    }
  } catch {
    // Local preference storage is best effort and never blocks account cleanup.
  }
}

export function accountDirectoryAccountKey(account: { vaultId: string; id: string }): string {
  return `${account.vaultId}:${account.id}`;
}

export function orderDirectoryAccounts<T extends { vaultId: string; id: string }>(
  accounts: T[],
  savedOrder: string[],
): T[] {
  const accountsByKey = new Map(accounts.map((account) => [accountDirectoryAccountKey(account), account]));
  const ordered: T[] = [];
  const included = new Set<string>();
  for (const key of savedOrder) {
    const account = accountsByKey.get(key);
    if (!account || included.has(key)) continue;
    ordered.push(account);
    included.add(key);
  }
  for (const account of accounts) {
    const key = accountDirectoryAccountKey(account);
    if (included.has(key)) continue;
    ordered.push(account);
    included.add(key);
  }
  return ordered;
}

export function moveDirectoryAccount(
  order: string[],
  sourceKey: string,
  targetKey: string,
  placement: "before" | "after" = "before",
): string[] {
  if (sourceKey === targetKey || !order.includes(sourceKey)) return order;
  const next = order.filter((key) => key !== sourceKey);
  const targetIndex = next.indexOf(targetKey);
  if (targetIndex < 0) return order;
  next.splice(targetIndex + (placement === "after" ? 1 : 0), 0, sourceKey);
  return next;
}

export function useAccountDirectoryPreferences(profileId: string | null) {
  const storageKey = useMemo(() => (profileId ? accountDirectoryStorageKey(profileId) : null), [profileId]);
  const [preferences, setPreferences] = useState<AccountDirectoryPreferences>(DEFAULT_PREFERENCES);
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>(null);

  useEffect(() => {
    let next = DEFAULT_PREFERENCES;
    if (storageKey) {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) next = parseAccountDirectoryPreferences(raw);
      } catch {
        // Local preference storage is best effort; the in-memory default remains usable.
      }
    }

    const hydration = window.setTimeout(() => {
      setPreferences(next);
      setHydratedStorageKey(storageKey);
    }, 0);
    return () => window.clearTimeout(hydration);
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || hydratedStorageKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(preferences));
    } catch {
      // Private browsing and exhausted storage must not block account access.
    }
  }, [hydratedStorageKey, preferences, storageKey]);

  return { preferences, setPreferences };
}

export function parseAccountDirectoryPreferences(raw: string): AccountDirectoryPreferences {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT_PREFERENCES;
    const record = value as { view?: unknown; vaultFilter?: unknown; vaultFilters?: unknown; order?: unknown };
    return {
      view: isAccountDirectoryView(record.view) ? record.view : DEFAULT_PREFERENCES.view,
      vaultFilters: parseVaultFilters(record),
      order: Array.isArray(record.order)
        ? record.order.filter((key): key is string => typeof key === "string")
        : DEFAULT_PREFERENCES.order,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function parseVaultFilters(record: { vaultFilter?: unknown; vaultFilters?: unknown }): string[] {
  const values = Array.isArray(record.vaultFilters)
    ? record.vaultFilters
    : typeof record.vaultFilter === "string"
      ? [record.vaultFilter]
      : [];
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value !== "ALL"))];
}

function isAccountDirectoryView(value: unknown): value is AccountDirectoryView {
  return value === "compact" || value === "normal" || value === "wide";
}
