import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AppPage, PageHeader, SurfaceCard } from "@/shared/presentation/app-ui";

type PublicInformationKind = "privacy" | "support";

const sections = {
  privacy: [
    { key: "scope", items: ["local", "hosted"] },
    { key: "server", items: ["allowed", "excluded"] },
    { key: "providers", items: ["auth", "hosting", "database", "analytics"] },
    { key: "retention", items: ["vault", "audit", "limits"] },
    { key: "responsibility", items: ["hosted", "selfHosted"] },
    { key: "contact", items: ["support", "security"] }
  ],
  support: [
    { key: "channels", items: ["docs", "bug", "feature", "security"] },
    { key: "safe", items: ["include", "exclude"] },
    { key: "triage", items: ["triage", "escalate"] },
    { key: "operator", items: ["hosted", "selfHosted"] }
  ]
} as const;

const documentLinks: Record<PublicInformationKind, string> = {
  privacy: "https://github.com/arrokh/rhasia-scret/blob/main/docs/privacy.md",
  support: "https://github.com/arrokh/rhasia-scret/blob/main/docs/support.md"
};

export async function PublicInformationPage({ kind }: { kind: PublicInformationKind }) {
  const t = await getTranslations(kind === "privacy" ? "Privacy" : "Support");
  const translate = (key: string) => t(key as never);
  const pageSections = sections[kind];

  return (
    <AppPage>
      <PageHeader title={t("title")} description={t("description")} backHref="/" />
      <div className="grid gap-4">
        {pageSections.map((section) => (
          <SurfaceCard key={section.key} className="p-5 sm:p-6">
            <h2 className="text-lg font-bold text-ink-strong">{translate(`sections.${section.key}.title`)}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{translate(`sections.${section.key}.description`)}</p>
            <ul className="mt-4 grid gap-3 pl-5 text-sm leading-6 text-foreground">
              {section.items.map((item) => <li key={item} className="pl-1">{translate(`sections.${section.key}.items.${item}`)}</li>)}
            </ul>
          </SurfaceCard>
        ))}
        <p className="text-center text-sm text-muted-foreground">
          <Link href={documentLinks[kind]} target="_blank" rel="noopener noreferrer" className="font-bold text-primary underline-offset-4 hover:underline">{t("fullDocument")}</Link>
        </p>
      </div>
    </AppPage>
  );
}
