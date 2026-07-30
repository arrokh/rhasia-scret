import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, CheckCircle2, Cloud, EyeOff, FileLock2, Laptop, LockKeyhole, Server, ShieldCheck, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LandingHeader } from "@/app/landing-header";
import { LandingMobileCta } from "@/app/landing-mobile-cta";

const flowIcons = [Laptop, FileLock2, UserRoundCheck] as const;
const browserIcons = [LockKeyhole, EyeOff] as const;
const serviceIcons = [FileLock2, Server] as const;
const principleIcons = [UserRoundCheck, EyeOff, CheckCircle2] as const;

export default async function LandingPage() {
  const t = await getTranslations("Home.landing");
  const common = await getTranslations("Common");
  const flowSteps = ["client", "encrypted", "authorized"] as const;
  const browserItems = ["authenticatorMaterial", "decryptedContent"] as const;
  const serviceItems = ["encryptedContent", "accessMetadata"] as const;
  const principles = ["control", "privacy", "collaboration"] as const;

  return (
    <main className="landing-page pb-20 sm:pb-0">
      <LandingHeader signInLabel={t("signIn")} githubLabel={t("github")} />

      <section className="landing-shell grid items-center gap-8 pb-16 pt-6 sm:gap-12 sm:pb-24 sm:pt-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" aria-labelledby="page-title">
        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/65 p-5 shadow-card sm:overflow-visible sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
          <div className="absolute inset-0 sm:hidden" aria-hidden="true">
            <Image src="/landing/private-handoff-hero.png" alt={t("heroImageAlt")} fill sizes="100vw" className="object-cover object-center opacity-30" />
            <div className="absolute inset-0 bg-background/75" />
          </div>
          <div className="relative max-w-xl">
            <p className="mb-4 text-sm font-bold tracking-[0.12em] text-primary uppercase">{t("eyebrow")}</p>
            <h1 id="page-title" className="max-w-2xl text-4xl leading-[1.08] font-bold tracking-tight text-ink-strong sm:text-5xl lg:text-6xl">{t("title")}</h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">{t("description")}</p>
            <div id="landing-hero-actions" className="mt-8 flex flex-col items-stretch gap-3 sm:items-start">
              <div className="flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="min-h-12 px-7 text-base"><Link href="/local"><Laptop aria-hidden="true" />{t("localVault")}</Link></Button>
                <Button asChild size="lg" className="min-h-12 px-7 text-base"><Link href="/sign-in"><Cloud aria-hidden="true" />{t("hostedVault")}</Link></Button>
              </div>
              <p className="max-w-sm text-sm leading-6 text-muted-foreground">{t("inviteOnly")}</p>
            </div>
          </div>
        </div>
        <div className="landing-hero-art relative mx-auto hidden w-full max-w-2xl overflow-hidden rounded-[2rem] sm:block">
          <Image src="/landing/private-handoff-hero.png" alt={t("heroImageAlt")} width={1000} height={900} priority className="h-auto w-full object-cover" />
        </div>
      </section>
      <div id="landing-hero-end" className="h-px" aria-hidden="true" />

      <section className="landing-shell scroll-mt-6 pb-14 sm:pb-20" aria-labelledby="flow-title">
        <div className="rounded-2xl bg-[#1b252c] px-5 py-7 text-card sm:px-9 sm:py-10 lg:px-12">
          <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">{t("flow.eyebrow")}</p>
          <h2 id="flow-title" className="mt-3 max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">{t("flow.title")}</h2>
          <p className="mt-3 max-w-2xl leading-6 text-stone">{t("flow.description")}</p>
          <ol className="mt-8 grid gap-3 lg:grid-cols-3 lg:gap-4">
            {flowSteps.map((step, index) => {
              const Icon = flowIcons[index];
              return (
                <li key={step} className="landing-flow-step rounded-xl border border-white/15 bg-white/5 p-4 sm:p-5" style={{ animationDelay: `${index * 700}ms` }}>
                  <div className="flex items-start gap-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-full border border-primary/70 font-mono text-sm font-bold text-primary">0{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <Icon className="mb-3 size-5 text-primary" aria-hidden="true" />
                      <h3 className="font-bold text-card">{t(`flow.${step}.title`)}</h3>
                      <p className="mt-1.5 text-sm leading-6 text-stone">{t(`flow.${step}.description`)}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      <section className="landing-shell pb-14 sm:pb-20" aria-labelledby="boundary-title">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-8 lg:p-10">
          <div className="max-w-2xl">
            <p className="text-xs font-bold tracking-[0.16em] text-muted-foreground uppercase">{t("boundary.eyebrow")}</p>
            <h2 id="boundary-title" className="mt-3 text-2xl font-bold tracking-tight text-ink-strong sm:text-3xl">{t("boundary.title")}</h2>
            <p className="mt-3 leading-7 text-muted-foreground">{t("boundary.description")}</p>
          </div>
          <div className="mt-8 grid gap-5 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch lg:gap-8">
            <BoundaryPanel title={t("boundary.browser.title")} items={browserItems.map((item, index) => ({ icon: browserIcons[index], title: t(`boundary.browser.${item}.title`), description: t(`boundary.browser.${item}.description`) }))} />
            <div className="flex items-center justify-center lg:flex-col" aria-hidden="true"><span className="h-px w-12 bg-primary/70 lg:h-12 lg:w-px" /><ArrowRight className="mx-2 size-5 text-primary lg:my-2 lg:rotate-90" /><span className="h-px w-12 bg-primary/70 lg:h-12 lg:w-px" /></div>
            <BoundaryPanel title={t("boundary.service.title")} items={serviceItems.map((item, index) => ({ icon: serviceIcons[index], title: t(`boundary.service.${item}.title`), description: t(`boundary.service.${item}.description`) }))} />
          </div>
          <p className="mt-7 border-t border-border pt-5 text-sm leading-6 text-muted-foreground"><ShieldCheck className="mr-2 inline size-4 text-primary" aria-hidden="true" />{t("boundary.note")}</p>
        </div>
      </section>

      <section className="landing-shell pb-8" aria-label={t("principles.label")}>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-7">
          <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">{t("principles.label")}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {principles.map((principle, index) => {
            const Icon = principleIcons[index];
            return (
              <article key={principle} className="relative rounded-xl border border-border bg-muted/35 p-5">
                <span className="absolute right-4 top-4 font-mono text-xs font-bold tracking-[0.14em] text-primary/80">0{index + 1}</span>
                <span className="grid size-10 place-items-center rounded-lg border border-primary/20 bg-primary/10 text-primary"><Icon className="size-5" aria-hidden="true" /></span>
                <h2 className="mt-5 pr-8 font-bold text-ink-strong">{t(`principles.${principle}.title`)}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{t(`principles.${principle}.description`)}</p>
              </article>
            );
          })}
          </div>
        </div>
      </section>

      <footer className="border-t border-border/80 bg-background/95 px-4 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex min-h-14 max-w-3xl items-center justify-center py-2 text-center">
          <p className="flex items-baseline gap-1.5 whitespace-nowrap text-sm text-muted-foreground"><a href="https://rhasia-scret.vercel.app/sign-in" target="_blank" rel="noopener noreferrer" className="text-base font-bold tracking-tight underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="text-foreground">{t("footerProductPrefix")}</span><span className="text-primary">{t("footerProductSuffix")}</span></a><span>{common("by")}</span><a href="https://github.com/arrokh" target="_blank" rel="noopener noreferrer" className="font-bold text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t("footerAuthor")}</a></p>
        </div>
      </footer>

      <LandingMobileCta localVaultLabel={t("localVault")} hostedVaultLabel={t("hostedVault")} />
    </main>
  );
}

function BoundaryPanel({ title, items }: { title: string; items: Array<{ icon: typeof LockKeyhole; title: string; description: string }> }) {
  return (
    <div className="rounded-xl bg-muted/60 p-5 sm:p-6">
      <h3 className="text-xs font-bold tracking-[0.14em] text-ink-strong uppercase">{title}</h3>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
        {items.map(({ icon: Icon, title: itemTitle, description }) => (
          <div key={itemTitle} className="flex gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-card text-primary shadow-sm"><Icon className="size-4" aria-hidden="true" /></span>
            <div><h4 className="text-sm font-bold text-ink-strong">{itemTitle}</h4><p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p></div>
          </div>
        ))}
      </div>
    </div>
  );
}
