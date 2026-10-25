"use client";

import { useMemo, useState } from "react";
import { ArrowDownUp, FilterX, LayoutGrid, List, ListFilter, Rows3, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AccountDirectoryReorderDialog, type AccountDirectoryReorderItem } from "./account-directory-reorder-dialog";
import type { AccountDirectoryView } from "./account-directory-preferences";

export type AccountDirectoryVaultOption = { id: string; name: string };

function updateSelectedValues(current: string[], value: string, checked: boolean, update: (values: string[]) => void) {
  if (checked) {
    if (current.includes(value)) return;
    update([...current, value]);
    return;
  }
  update(current.filter((selected) => selected !== value));
}

export function AccountDirectoryControls({
  vaults,
  vaultFilters,
  onVaultFiltersChange,
  issuerFilters,
  onIssuerFiltersChange,
  tagOptions,
  tagFilters,
  onTagFiltersChange,
  view,
  onViewChange,
  directoryActionsEnabled,
  searchOpen,
  searchActive,
  searchPanelId,
  onSearchOpenChange,
  reorderAccounts,
  onMoveAccount,
  labels,
}: {
  vaults: AccountDirectoryVaultOption[];
  vaultFilters: string[];
  onVaultFiltersChange: (value: string[]) => void;
  issuerFilters: string[];
  onIssuerFiltersChange: (value: string[]) => void;
  tagOptions: string[];
  tagFilters: string[];
  onTagFiltersChange: (value: string[]) => void;
  view: AccountDirectoryView;
  onViewChange: (value: AccountDirectoryView) => void;
  directoryActionsEnabled: boolean;
  searchOpen: boolean;
  searchActive: boolean;
  searchPanelId: string;
  onSearchOpenChange: (open: boolean) => void;
  reorderAccounts: AccountDirectoryReorderItem[];
  onMoveAccount: (sourceKey: string, targetKey: string, placement?: "before" | "after") => void;
  labels: {
    menuLabel: string;
    filterLabel: string;
    filterByVault: string;
    filterByIssuer: string;
    filterByTag: string;
    filtersApplied: string;
    clearFilters: string;
    showSearch: string;
    hideSearch: string;
    searchApplied: string;
    allVaults: string;
    allIssuers: string;
    allTags: string;
    viewLabel: string;
    compact: string;
    normal: string;
    wide: string;
    reorder: string;
    reorderTitle: string;
    reorderDescription: string;
    close: string;
    dragAccount: (account: string) => string;
    moveUp: (account: string) => string;
    moveDown: (account: string) => string;
  };
}) {
  const [reorderOpen, setReorderOpen] = useState(false);
  const viewOptions = [
    { value: "compact" as const, label: labels.compact, icon: LayoutGrid },
    { value: "normal" as const, label: labels.normal, icon: List },
    { value: "wide" as const, label: labels.wide, icon: Rows3 },
  ];
  const ViewIcon = viewOptions.find((option) => option.value === view)?.icon ?? List;
  const issuerOptions = useMemo(
    () => [...new Set(reorderAccounts.map((account) => account.issuer))],
    [reorderAccounts],
  );
  const allVaultsSelected = vaultFilters.length === 0;
  const allIssuersSelected = issuerFilters.length === 0;
  const allTagsSelected = tagFilters.length === 0;
  const hasActiveFilters = !allVaultsSelected || !allIssuersSelected || !allTagsSelected;
  const clearFilters = () => {
    onVaultFiltersChange([]);
    onIssuerFiltersChange([]);
    onTagFiltersChange([]);
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-1" data-slot="account-directory-controls">
        {directoryActionsEnabled && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                type="button"
                data-slot="account-directory-menu"
                className="shrink-0"
                aria-label={labels.menuLabel}
                title={labels.menuLabel}
              >
                <ViewIcon aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-md border-border bg-popover p-2 shadow-card">
              <DropdownMenuLabel>{labels.viewLabel}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={view}
                onValueChange={(value) => {
                  if (isAccountDirectoryView(value)) onViewChange(value);
                }}
              >
                {viewOptions.map(({ value, label, icon: Icon }) => (
                  <DropdownMenuRadioItem
                    key={value}
                    value={value}
                    onSelect={(event) => event.preventDefault()}
                    className="min-h-11"
                  >
                    <Icon aria-hidden="true" />
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={reorderAccounts.length < 2} onSelect={() => setReorderOpen(true)}>
                <ArrowDownUp aria-hidden="true" />
                {labels.reorder}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {directoryActionsEnabled && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                type="button"
                data-slot="account-directory-filter-menu"
                className={
                  hasActiveFilters ? "relative shrink-0 border-primary bg-primary/10 text-foreground" : "shrink-0"
                }
                aria-label={labels.filterLabel}
                aria-description={hasActiveFilters ? labels.filtersApplied : undefined}
                data-active={hasActiveFilters}
                title={labels.filterLabel}
              >
                <ListFilter aria-hidden="true" />
                {hasActiveFilters && (
                  <span
                    data-slot="account-directory-filter-indicator"
                    aria-hidden="true"
                    className="absolute top-2 right-2 size-2.5 rounded-full bg-primary ring-2 ring-background"
                  />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 rounded-md border-border bg-popover p-2 shadow-card">
              <div className="flex items-center justify-between gap-2">
                <DropdownMenuLabel className="text-sm font-semibold text-foreground">
                  {labels.filterLabel}
                </DropdownMenuLabel>
                {hasActiveFilters && (
                  <Button
                    variant="outline"
                    size="icon"
                    type="button"
                    className="shrink-0"
                    aria-label={labels.clearFilters}
                    title={labels.clearFilters}
                    data-slot="account-directory-clear-filters"
                    onClick={clearFilters}
                  >
                    <FilterX aria-hidden="true" />
                  </Button>
                )}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{labels.filterByVault}</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={allVaultsSelected}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) => {
                  if (checked) onVaultFiltersChange([]);
                }}
              >
                {labels.allVaults}
              </DropdownMenuCheckboxItem>
              {vaults.map((vault) => (
                <DropdownMenuCheckboxItem
                  key={vault.id}
                  checked={vaultFilters.includes(vault.id)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    updateSelectedValues(vaultFilters, vault.id, checked === true, onVaultFiltersChange)
                  }
                >
                  {vault.name}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{labels.filterByIssuer}</DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={allIssuersSelected}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) => {
                  if (checked) onIssuerFiltersChange([]);
                }}
              >
                {labels.allIssuers}
              </DropdownMenuCheckboxItem>
              {issuerOptions.map((issuer) => (
                <DropdownMenuCheckboxItem
                  key={issuer}
                  checked={issuerFilters.includes(issuer)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    updateSelectedValues(issuerFilters, issuer, checked === true, onIssuerFiltersChange)
                  }
                >
                  {issuer}
                </DropdownMenuCheckboxItem>
              ))}
              {tagOptions.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{labels.filterByTag}</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem
                    checked={allTagsSelected}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) => {
                      if (checked) onTagFiltersChange([]);
                    }}
                  >
                    {labels.allTags}
                  </DropdownMenuCheckboxItem>
                  {tagOptions.map((tag) => (
                    <DropdownMenuCheckboxItem
                      key={tag}
                      checked={tagFilters.includes(tag)}
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={(checked) =>
                        updateSelectedValues(tagFilters, tag, checked === true, onTagFiltersChange)
                      }
                    >
                      {tag}
                    </DropdownMenuCheckboxItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="outline"
          size="icon"
          type="button"
          className={searchActive ? "relative shrink-0 border-primary bg-primary/10 text-foreground" : "shrink-0"}
          aria-label={searchOpen ? labels.hideSearch : labels.showSearch}
          aria-description={searchActive ? labels.searchApplied : undefined}
          aria-expanded={searchOpen}
          aria-controls={searchOpen ? searchPanelId : undefined}
          data-slot="account-directory-search-toggle"
          data-active={searchActive}
          title={searchOpen ? labels.hideSearch : labels.showSearch}
          onClick={() => onSearchOpenChange(!searchOpen)}
        >
          <Search aria-hidden="true" />
          {searchActive && (
            <span
              data-slot="account-directory-search-indicator"
              aria-hidden="true"
              className="absolute top-2 right-2 size-2.5 rounded-full bg-primary ring-2 ring-background"
            />
          )}
        </Button>
      </div>
      {directoryActionsEnabled && (
        <AccountDirectoryReorderDialog
          open={reorderOpen}
          onOpenChange={setReorderOpen}
          accounts={reorderAccounts}
          onMove={onMoveAccount}
          labels={{
            title: labels.reorderTitle,
            description: labels.reorderDescription,
            dragAccount: labels.dragAccount,
            moveUp: labels.moveUp,
            moveDown: labels.moveDown,
            close: labels.close,
          }}
        />
      )}
    </>
  );
}

function isAccountDirectoryView(value: string): value is AccountDirectoryView {
  return value === "compact" || value === "normal" || value === "wide";
}

export type { AccountDirectoryView } from "./account-directory-preferences";
