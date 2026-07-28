"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useVaultAuditQuery } from "./hooks/use-vault-audit-query";
import { VaultAccountManagementList, type ManagedVaultAccountSummary } from "./vault-account-management-list";
import { VaultAuditHistory } from "./vault-audit-history";

export type PersonalVaultSummary = { id: string; name: string; accounts: ManagedVaultAccountSummary[] };

export function PersonalVaultDetails({ vault, ownerEmail, onAccountDeleted }: { vault: PersonalVaultSummary; ownerEmail: string; onAccountDeleted: (vaultId: string, accountId: string, expectedRevision: number) => Promise<void> }) {
  const t = useTranslations("VaultManagement.personal");
  const [activeTab, setActiveTab] = useState("details");
  const audit = useVaultAuditQuery(vault.id, {}, activeTab === "audit");
  return <div className="p-5 sm:p-6"><Tabs value={activeTab} onValueChange={setActiveTab}><TabsList className="grid-cols-2"><TabsTrigger value="details">{t("detailTab")}</TabsTrigger><TabsTrigger value="audit">{t("auditTab")}</TabsTrigger></TabsList><TabsContent value="details" className="grid gap-6"><dl className="grid gap-4 sm:grid-cols-2 sm:gap-6"><div className="grid content-start gap-1"><dt className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{t("owner")}</dt><dd className="break-all text-sm font-bold text-foreground">{ownerEmail}</dd></div><div className="grid content-start gap-1"><dt className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{t("vaultName")}</dt><dd className="text-sm font-bold text-foreground">{vault.name}</dd></div></dl><VaultAccountManagementList vaultId={vault.id} vaultName={vault.name} accounts={vault.accounts} onAccountDeleted={onAccountDeleted} /></TabsContent><TabsContent value="audit"><VaultAuditHistory audit={audit} accounts={vault.accounts} /></TabsContent></Tabs></div>;
}
