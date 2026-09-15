"use client";

import { useMemo, useState } from "react";
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
  issuerFilters,
  onIssuerFiltersChange,
  view,
  onViewChange,
  reorderAccounts,
  onMoveAccount,
  labels,
}: {
  vaults: AccountDirectoryVaultOption[];
  vaultFilters: string[];
  onVaultFiltersChange: (value: string[]) => void;
  issuerFilters: string[];
  onIssuerFiltersChange: (value: string[]) => void;
  view: AccountDirectoryView;
  onViewChange: (value: AccountDirectoryView) => void;
  reorderAccounts: AccountDirectoryReorderItem[];
  onMoveAccount: (sourceKey: string, targetKey: string, placement?: "before" | "after") => void;
  labels: {
    menuLabel: string;
    filterLabel: string;
    filterByVault: string;
    filterByIssuer: string;
    allVaults: string;
    allIssuers: string;
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

  function toggleVault(vaultId: string, checked: boolean) {
    if (checked) {
      if (vaultFilters.includes(vaultId)) return;
      onVaultFiltersChange([...vaultFilters, vaultId]);
      return;
    }
    onVaultFiltersChange(vaultFilters.filter((selectedVaultId) => selectedVaultId !== vaultId));
  }

  function toggleIssuer(issuer: string, checked: boolean) {
    if (checked) {
      if (issuerFilters.includes(issuer)) return;
      onIssuerFiltersChange([...issuerFilters, issuer]);
      return;
    }
    onIssuerFiltersChange(issuerFilters.filter((selectedIssuer) => selectedIssuer !== issuer));
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-1" data-slot="account-directory-controls">
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
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              type="button"
              data-slot="account-directory-filter-menu"
              className="shrink-0"
              aria-label={labels.filterLabel}
              title={labels.filterLabel}
            >
              <ListFilter aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72 rounded-md border-border bg-popover p-2 shadow-card">
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
                onCheckedChange={(checked) => toggleVault(vault.id, checked === true)}
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
                onCheckedChange={(checked) => toggleIssuer(issuer, checked === true)}
              >
                {issuer}
              </DropdownMenuCheckboxItem>
            ))}
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
