import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Plus, ShieldKeyhole, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LogoutForm } from "@/modules/identity";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export const dynamic = "force-dynamic";

/** Fixture khusus pengembangan tanpa ciphertext untuk memeriksa tata letak seluler. */
export default async function MobilePreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const t = await getTranslations("Preview.mobile");
  const accounts = [{ issuer: t("sampleService"), name: "example@local.invalid", vault: t("personalVault") }, { issuer: t("workAccount"), name: "work@local.invalid", vault: t("operations") }];
  return <AppPage>
    <PageHeader title={t("title")} description={t("description")} action={<LogoutForm email="preview@local.invalid" />} />
    <SurfaceCard className="grid gap-5 p-4 sm:p-5" aria-label={t("listLabel")}>
      <div className="flex items-center gap-2"><Button variant="outline" asChild><Link href="/vaults/manage" aria-label={t("vaults")} title={t("vaults")}><UsersRound aria-hidden="true" /><span className="hidden sm:inline">{t("vaults")}</span></Link></Button><Button variant="outline" size="icon" aria-label={t("security")}><ShieldKeyhole /></Button><Button asChild className="ml-auto"><Link href="/vaults/accounts/new" aria-label={t("addLabel")}><Plus /><span className="hidden sm:inline">{t("add")}</span></Link></Button></div>
      <div className="flex items-end justify-between"><div><p className="text-xs font-bold tracking-wider text-muted-foreground uppercase">{t("allVaults")}</p><h2 className="mt-1 text-lg font-bold text-ink-strong">{t("accounts")}</h2></div><Badge className="bg-gold-soft text-ink-strong">2</Badge></div>
      <ul className="grid list-none gap-3 p-0">{accounts.map((account) => <li key={account.name} className="grid min-h-24 grid-cols-[2.5rem_1fr] items-center gap-3 rounded-lg border bg-card p-4 shadow-card"><span className="grid size-10 place-items-center rounded-md bg-muted font-bold">{account.issuer[0]}</span><span className="grid min-w-0"><strong>{account.issuer}</strong><span className="truncate text-sm text-muted-foreground">{account.name}</span><Badge variant="secondary" className="mt-2 w-fit bg-muted text-taupe">{account.vault}</Badge></span></li>)}</ul>
    </SurfaceCard>
  </AppPage>;
}
