import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Bot, CheckCircle2, Cloud, Ellipsis, EyeOff, FileLock2, Laptop, LockKeyhole, Monitor, Server, ShieldCheck, Smartphone, UserRoundCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FaDiscord, FaFacebook, FaGithub, FaGoogle, FaInstagram, FaLinkedin, FaMicrosoft, FaReddit, FaSlack, FaSpotify, FaTiktok, FaXTwitter } from "react-icons/fa6";
import { LandingHeader } from "@/app/landing-header";
import { LandingMobileCta } from "@/app/landing-mobile-cta";
import { LandingVaultPreviews } from "@/app/landing-vault-previews";

const flowIcons = [Laptop, FileLock2, UserRoundCheck, Smartphone] as const;
const browserIcons = [LockKeyhole, EyeOff] as const;
const serviceIcons = [FileLock2, Server] as const;
const principleIcons = [UserRoundCheck, EyeOff, CheckCircle2] as const;
type LandingTranslator = Awaited<ReturnType<typeof getTranslations<"Home.landing">>>;

export default async function LandingPage() {
  const t = await getTranslations("Home.landing");
  const common = await getTranslations("Common");
  const flowSteps = ["client", "encrypted", "authorized", "mobilePwa"] as const;
  const browserItems = ["authenticatorMaterial", "decryptedContent"] as const;
  const serviceItems = ["encryptedContent", "accessMetadata"] as const;
  const principles = ["control", "privacy", "collaboration"] as const;
  const comparisonRows = ["codes", "ownership", "moving", "sharing"] as const;

  return (
    <main className="landing-page pb-20 sm:pb-0">
      <LandingHeader localVaultLabel={t("localVault")} hostedVaultLabel={t("hostedVault")} githubLabel={t("github")} githubDialogTitle={t("githubDialogTitle")} githubDialogDescription={t("githubDialogDescription")} githubDialogClose={t("githubDialogClose")} />

      <section className="landing-shell grid items-center gap-8 pb-16 pt-6 sm:gap-12 sm:pb-24 sm:pt-12 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-8 md:pb-20 md:pt-10 lg:min-h-[calc(100dvh-6.25rem)] lg:gap-12 lg:pb-24 lg:pt-12" aria-labelledby="page-title">
        <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/65 p-5 shadow-card md:overflow-visible md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none">
          <div className="absolute inset-0 md:hidden" aria-hidden="true">
            <Image src="/landing/private-handoff-hero.png" alt={t("heroImageAlt")} fill sizes="(max-width: 767px) calc(100vw - 2rem), 1px" className="object-cover object-center opacity-30" />
            <div className="absolute inset-0 bg-background/75" />
          </div>
          <div className="relative max-w-xl">
            <p className="mb-4 text-sm font-bold tracking-[0.12em] text-primary uppercase">{t("eyebrow")}</p>
            <h1 id="page-title" className="max-w-2xl text-4xl leading-[1.08] font-bold tracking-tight text-ink-strong sm:text-5xl lg:text-6xl">{t("title")}</h1>
            <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground sm:text-lg">{t("description")}</p>
            <div id="landing-hero-actions" className="mt-8 flex flex-col items-stretch gap-3 sm:items-start">
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center md:flex-col md:items-stretch lg:flex-row lg:items-center">
                <Button asChild size="lg" className="min-h-12 px-7 text-base"><Link href="/local?from=landing"><Laptop aria-hidden="true" />{t("localVault")}</Link></Button>
                <span className="text-center text-sm font-bold text-muted-foreground sm:px-1 md:px-0 lg:px-1" aria-hidden="true">{t("choiceSeparator")}</span>
                <Button asChild size="lg" className="min-h-12 bg-[#1b252c] px-7 text-base text-card hover:bg-[#2b3a44] active:bg-[#11181d]"><Link href="/sign-in"><Cloud aria-hidden="true" />{t("hostedVault")}</Link></Button>
              </div>
              <p className="max-w-sm self-start text-left text-xs leading-5 text-muted-foreground italic">{t("inviteOnly")}</p>
            </div>
          </div>
        </div>
        <div className="landing-hero-art relative mx-auto hidden w-full max-w-2xl overflow-hidden rounded-[2rem] md:block">
          <Image src="/landing/private-handoff-hero.png" alt={t("heroImageAlt")} width={1000} height={900} priority className="landing-hero-art-image h-auto w-full object-cover" />
        </div>
      </section>
      <div id="landing-hero-end" className="h-px" aria-hidden="true" />

      <section className="landing-shell pb-14 sm:pb-20" aria-labelledby="comparison-title">
        <div className="rounded-2xl border border-border bg-card p-5 shadow-card sm:p-8 lg:p-10">
          <div className="max-w-2xl">
            <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">{t("comparison.eyebrow")}</p>
            <h2 id="comparison-title" className="mt-3 text-2xl font-bold tracking-tight text-ink-strong sm:text-3xl">{t("comparison.title")}</h2>
            <p className="mt-3 leading-7 text-muted-foreground">{t("comparison.description")}</p>
          </div>
          <Tabs defaultValue="flow" className="mt-7">
            <TabsList className="w-full grid-cols-2 sm:w-auto">
              <TabsTrigger value="flow">{t("comparison.tabs.flow")}</TabsTrigger>
              <TabsTrigger value="compare">{t("comparison.tabs.compare")}</TabsTrigger>
            </TabsList>
            <TabsContent value="compare" className="overflow-hidden rounded-xl border border-border">
              <div className="hidden grid-cols-[minmax(7rem,0.6fr)_repeat(3,minmax(0,1fr))] gap-5 bg-muted/50 px-5 py-3 sm:grid">
                <span className="text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">{t("comparison.aspect")}</span>
                <span className="font-bold text-foreground">{t("comparison.googleAuthenticator")}</span>
                <span className="font-bold text-foreground">{t("comparison.otherAuthenticatorApps")}</span>
                <ProductName prefix={t("footerProductPrefix")} suffix={t("footerProductSuffix")} showIcon />
              </div>
              {comparisonRows.map((row) => (
                <div key={row} className="grid gap-3 border-t border-border p-5 first:border-t-0 sm:grid-cols-[minmax(7rem,0.6fr)_repeat(3,minmax(0,1fr))] sm:gap-5">
                  <h3 className="text-sm font-bold text-ink-strong">{t(`comparison.rows.${row}.label`)}</h3>
                  <p className="text-sm leading-6 text-muted-foreground"><span className="mb-1 block font-bold text-foreground sm:hidden">{t("comparison.googleAuthenticator")}</span>{t(`comparison.rows.${row}.googleAuthenticator`)}</p>
                  <p className="text-sm leading-6 text-muted-foreground"><span className="mb-1 block font-bold text-foreground sm:hidden">{t("comparison.otherAuthenticatorApps")}</span>{t(`comparison.rows.${row}.otherAuthenticatorApps`)}</p>
                  <p className="rounded-lg bg-primary/10 p-3 text-sm leading-6 text-foreground sm:rounded-none sm:bg-transparent sm:p-0"><span className="mb-1 block sm:hidden"><ProductName prefix={t("footerProductPrefix")} suffix={t("footerProductSuffix")} showIcon /></span>{t(`comparison.rows.${row}.rhasiaScret`)}</p>
                </div>
              ))}
            </TabsContent>
            <TabsContent value="flow" className="overflow-visible"><ConnectionFlow t={t} /></TabsContent>
          </Tabs>
        </div>
      </section>

      <section className="landing-shell scroll-mt-6 pb-14 sm:pb-20" aria-labelledby="flow-title">
        <div className="rounded-2xl bg-[#1b252c] px-5 py-7 text-card sm:px-9 sm:py-10 lg:px-12">
          <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">{t("flow.eyebrow")}</p>
          <h2 id="flow-title" className="mt-3 max-w-2xl text-2xl font-bold tracking-tight sm:text-3xl">{t("flow.title")}</h2>
          <p className="mt-3 max-w-2xl leading-6 text-stone">{t("flow.description")}</p>
          <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
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
          <p className="mt-7 border-t border-border pt-5 text-center text-sm leading-6 text-muted-foreground"><ShieldCheck className="mr-2 inline size-4 text-primary" aria-hidden="true" />{t("boundary.note")}</p>
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

function ProductName({ prefix, suffix, showIcon = false }: { prefix: string; suffix: string; showIcon?: boolean }) {
  return <span className="inline-flex items-center gap-2 font-bold tracking-tight">{showIcon && <Image src="/pwa/icon512_rounded.png" alt="" aria-hidden="true" width={24} height={24} className="size-6 rounded-md" />}<span><span className="text-foreground">{prefix}</span><span className="text-primary">{suffix}</span></span></span>;
}

function ConnectionFlow({ t }: { t: LandingTranslator }) {
  const devices = [[Laptop, "browser"], [Smartphone, "phone"], [Monitor, "desktop"]] as const;
  const services = [[Bot, "openai"], [FaInstagram, "instagram"], [FaXTwitter, "x"], [FaGithub, "github"], [FaGoogle, "google"], [FaMicrosoft, "microsoft"], [FaDiscord, "discord"], [FaSlack, "slack"], [FaFacebook, "facebook"], [FaLinkedin, "linkedin"], [FaReddit, "reddit"], [FaSpotify, "spotify"], [FaTiktok, "tiktok"]] as const;
  const featuredServices = services.slice(0, 2);
  const remainingServices = services.slice(2);
  const vaults = ["local", "personal", "shared"] as const;
  return <div className="overflow-visible rounded-xl border border-border bg-muted/25 p-3 sm:p-6">
    <div className="max-w-2xl"><h3 className="text-lg font-bold text-ink-strong">{t("comparison.flow.title")}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{t("comparison.flow.description")}</p></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="rounded-lg border border-border bg-card p-3"><h4 className="text-sm font-bold text-ink-strong">{t("comparison.flow.localFirst.title")}</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("comparison.flow.localFirst.description")}</p></div><div className="rounded-lg border border-border bg-card p-3"><h4 className="text-sm font-bold text-ink-strong">{t("comparison.flow.zeroKnowledge.title")}</h4><p className="mt-1 text-xs leading-5 text-muted-foreground">{t("comparison.flow.zeroKnowledge.description")}</p></div></div>
    <div className="comparison-flow-layout mt-5 grid min-w-0 overflow-visible grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)] gap-2 min-[360px]:grid-cols-[minmax(0,1fr)_7.5rem_minmax(0,1fr)] min-[400px]:grid-cols-[minmax(0,1fr)_6.5rem_minmax(0,1fr)] min-[400px]:gap-3 min-[640px]:grid-cols-[minmax(0,1fr)_8.5rem_minmax(0,1fr)] min-[640px]:gap-4 lg:mt-6 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,0.75fr)_minmax(0,1fr)] lg:items-center lg:gap-10">
      <div className="grid min-w-0 overflow-visible justify-items-center self-center gap-2 lg:relative lg:flex lg:self-stretch lg:items-center lg:justify-stretch"><p className="whitespace-nowrap text-center text-[0.48rem] font-bold tracking-[0.08em] text-muted-foreground uppercase lg:hidden">{t("comparison.flow.devices")}</p><div className="comparison-flow-devices-grid grid min-w-0 w-full overflow-visible justify-items-center gap-2 lg:flex lg:flex-col lg:justify-items-stretch lg:gap-3">{devices.map(([Icon, device]) => <div key={device} className="comparison-flow-device relative max-lg:size-12 max-lg:justify-self-center lg:w-full"><span className="comparison-flow-device-connector" aria-hidden="true" /><div className="relative z-10 grid h-full w-full justify-items-center gap-1 rounded-lg border border-border bg-card p-2 text-center text-[0.65rem] font-bold leading-4 text-ink-strong max-lg:place-items-center max-lg:p-0 lg:flex lg:items-center lg:gap-3 lg:p-3 lg:text-sm lg:text-left"><span className="grid size-7 place-items-center rounded-md bg-primary/10 text-primary lg:size-9"><Icon className="size-4 lg:size-5" aria-hidden="true" /></span><span className="max-lg:hidden">{t(`comparison.flow.device.${device}`)}</span></div><span className="comparison-flow-branch-dot" aria-hidden="true" /></div>)}</div></div>
      <div className="comparison-flow-vault relative z-10 grid justify-items-center gap-2 self-center rounded-xl border border-primary/40 bg-card p-3 text-center shadow-sm lg:gap-3 lg:p-5"><Image src="/pwa/icon512_rounded.png" alt="" aria-hidden="true" width={72} height={72} className="size-12 rounded-xl lg:size-18 lg:rounded-2xl" /><ProductName prefix={t("footerProductPrefix")} suffix={t("footerProductSuffix")} /><p className="text-[0.65rem] leading-4 text-muted-foreground lg:text-sm lg:leading-5">{t("comparison.flow.vault")}</p></div>
      <div className="comparison-flow-services grid min-w-0 overflow-visible justify-items-center self-center gap-2 lg:relative lg:flex lg:self-stretch lg:items-center lg:justify-stretch"><p className="text-center text-[0.6rem] leading-3 font-bold tracking-[0.1em] text-muted-foreground uppercase lg:absolute lg:top-0 lg:left-0 lg:text-left lg:text-xs lg:leading-normal lg:tracking-[0.12em]">{t("comparison.flow.services")}</p><div className="comparison-flow-services-grid grid min-w-0 w-full overflow-visible justify-items-center gap-2 lg:flex lg:flex-col">{featuredServices.map(([Icon, service]) => <div key={service} className="comparison-flow-service relative max-lg:size-12 max-lg:justify-self-center lg:w-full"><span className="comparison-flow-service-connector" aria-hidden="true" /><div className="relative z-10 grid h-full w-full justify-items-center gap-1 rounded-lg border border-border bg-card p-2 text-center text-[0.65rem] font-bold leading-4 text-ink-strong max-lg:place-items-center max-lg:p-0 lg:inline-flex lg:items-center lg:gap-2 lg:px-3 lg:py-2 lg:text-sm lg:text-left"><span className="grid size-7 place-items-center rounded-md bg-muted text-ink-strong"><Icon className="size-4" aria-hidden="true" /></span><span className="max-lg:hidden">{t(`comparison.flow.service.${service}`)}</span></div><span className="comparison-flow-branch-dot" aria-hidden="true" /></div>)}<div className="comparison-flow-service comparison-flow-service-summary relative max-lg:size-12 max-lg:justify-self-center lg:w-full" aria-label={remainingServices.map(([, service]) => t(`comparison.flow.service.${service}`)).join(", ")}><span className="comparison-flow-service-connector" aria-hidden="true" /><div className="relative z-10 grid h-full w-full justify-items-center gap-1 rounded-lg border border-border bg-card p-2 text-center text-[0.65rem] font-bold leading-4 text-ink-strong max-lg:place-items-center max-lg:p-0 lg:flex lg:items-center lg:gap-2 lg:px-3 lg:py-2 lg:text-left"><span className="comparison-flow-summary-icons hidden gap-1 lg:flex">{remainingServices.slice(0, 6).map(([Icon, service]) => <span key={service} className="grid size-6 place-items-center rounded-md bg-muted text-ink-strong"><Icon className="size-3.5" aria-hidden="true" /></span>)}</span><span className="grid size-7 place-items-center rounded-md bg-muted text-ink-strong"><Ellipsis className="size-4" aria-hidden="true" /></span></div><span className="comparison-flow-branch-dot" aria-hidden="true" /></div></div></div>
    </div>
    <div className="mt-5 border-t border-border pt-4"><div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="text-sm font-bold text-ink-strong">{t("comparison.flow.accountsTitle")}</h4><p className="text-xs text-muted-foreground">{t("comparison.flow.accountsDescription")}</p></div><LandingVaultPreviews entries={vaults.map((vault) => ({ vault: t(`comparison.flow.account.${vault}.vault`), account: t(`comparison.flow.account.${vault}.label`), detail: t(`comparison.flow.account.${vault}.detail`), access: t(`comparison.flow.account.${vault}.access`), copyValue: "https://alvin.vercel.app", copiedLabel: t("comparison.flow.copied") }))} /></div>
    <p className="mt-5 text-center text-xs leading-5 text-muted-foreground"><ShieldCheck className="mr-1 inline size-4 text-primary" aria-hidden="true" />{t("comparison.flow.note")}</p>
  </div>;
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
