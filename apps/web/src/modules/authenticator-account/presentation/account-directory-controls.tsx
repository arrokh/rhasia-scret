"use client";

import { useState } from "react";
import { ArrowDownUp, LayoutGrid, List, ListFilter, Rows3 } from "lucide-react";
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

export function AccountDirectoryControls({
  vaults,
  vaultFilters,
  onVaultFiltersChange,
  view,
  onViewChange,
  reorderAccounts,
  onMoveAccount,
  labels,
}: {
  vaults: AccountDirectoryVaultOption[];
  vaultFilters: string[];
  onVaultFiltersChange: (value: string[]) => void;
  view: AccountDirectoryView;
  onViewChange: (value: AccountDirectoryView) => void;
  reorderAccounts: AccountDirectoryReorderItem[];
  onMoveAccount: (sourceKey: string, targetKey: string, placement?: "before" | "after") => void;
  labels: {
    menuLabel: string;
    filterLabel: string;
    allVaults: string;
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
    { value: "compact" as const, label: labels.compact, icon: List },
    { value: "normal" as const, label: labels.normal, icon: LayoutGrid },
    { value: "wide" as const, label: labels.wide, icon: Rows3 },
  ];
  const allVaultsSelected = vaultFilters.length === 0;

  function toggleVault(vaultId: string, checked: boolean) {
    if (checked) {
      if (vaultFilters.includes(vaultId)) return;
      onVaultFiltersChange([...vaultFilters, vaultId]);
      return;
    }
    onVaultFiltersChange(vaultFilters.filter((selectedVaultId) => selectedVaultId !== vaultId));
  }

  return (
    <>
      <div className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              type="button"
              data-slot="account-directory-menu"
              className="min-h-11 min-w-11 px-2 sm:px-3"
              aria-label={labels.menuLabel}
              title={labels.menuLabel}
            >
              <ListFilter aria-hidden="true" />
              <span className="hidden sm:inline">{labels.menuLabel}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 rounded-md border-border bg-popover p-2 shadow-card">
            <DropdownMenuLabel>{labels.filterLabel}</DropdownMenuLabel>
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
                onCheckedChange={(checked) => toggleVault(vault.id, checked === true)}
              >
                {vault.name}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
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
      </div>
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
    </>
  );
}

function isAccountDirectoryView(value: string): value is AccountDirectoryView {
  return value === "compact" || value === "normal" || value === "wide";
}

export type { AccountDirectoryView } from "./account-directory-preferences";
