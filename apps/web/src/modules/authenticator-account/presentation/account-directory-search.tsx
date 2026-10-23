"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AccountDirectorySearch({
  query,
  inputId,
  panelId,
  autoFocus = false,
  onQueryChange,
}: {
  query: string;
  inputId: string;
  panelId: string;
  autoFocus?: boolean;
  onQueryChange: (query: string) => void;
}) {
  const t = useTranslations("AuthenticatorAccount.accounts");

  return (
    <div id={panelId} className="grid min-w-0 gap-2" role="search" aria-label={t("searchLabel")}>
      <div className="flex min-w-0 items-end gap-2">
        <div className="grid min-w-0 flex-1 gap-2">
          <Label htmlFor={inputId}>{t("searchLabel")}</Label>
          <Input
            id={inputId}
            type="search"
            autoFocus={autoFocus}
            value={query}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t("searchPlaceholder")}
            aria-describedby={`${inputId}-help`}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label={t("clearSearch")}
          title={t("clearSearch")}
          disabled={query.length === 0}
          onClick={() => onQueryChange("")}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <p id={`${inputId}-help`} className="text-xs leading-5 text-muted-foreground">
        {t("searchDescription")}
      </p>
    </div>
  );
}

export function AccountSearchEmptyState({
  onClearSearch,
  onClearFilters,
}: {
  onClearSearch: () => void;
  onClearFilters?: () => void;
}) {
  const t = useTranslations("AuthenticatorAccount.accounts");

  return (
    <div
      className="grid justify-items-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 p-6 text-center"
      role="status"
      data-slot="account-search-empty-state"
    >
      <p className="font-bold text-foreground">{t("emptySearch")}</p>
      <p className="text-sm text-muted-foreground">{t("emptySearchDescription")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" variant="outline" onClick={onClearSearch}>
          {t("clearSearch")}
        </Button>
        {onClearFilters && (
          <Button type="button" variant="outline" onClick={onClearFilters}>
            {t("clearFilters")}
          </Button>
        )}
      </div>
    </div>
  );
}
