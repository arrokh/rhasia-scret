import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

export function AccountDeletionCompletePage({
  receiptId,
  cleanupWarning,
}: {
  receiptId?: string;
  cleanupWarning: boolean;
}) {
  const t = useTranslations("AccountDeletion.complete");
  return (
    <AppPage>
      <PageHeader title={t("title")} description={t("description")} />
      <SurfaceCard className="grid gap-5 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-6 text-success" aria-hidden="true" />
          <div className="grid gap-2">
            <h2 className="font-bold text-ink-strong">{t("serverComplete")}</h2>
            {receiptId && <p className="text-sm text-muted-foreground">{t("receipt", { receiptId })}</p>}
          </div>
        </div>
        {cleanupWarning && (
          <p className="rounded-md bg-warning-surface p-3 text-sm text-warning">{t("cleanupWarning")}</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Button asChild>
            <Link href="/sign-in">{t("signIn")}</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/">{t("home")}</Link>
          </Button>
        </div>
      </SurfaceCard>
    </AppPage>
  );
}
