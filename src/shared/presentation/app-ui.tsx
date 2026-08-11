import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, ArrowLeft, CheckCircle2, Info, LockKeyhole, ShieldAlert, WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AppFooterLocaleSwitcher } from "@/shared/presentation/app-footer-locale-switcher";

export function AppPage({ children, centered = false, className }: { children: ReactNode; centered?: boolean; className?: string }) {
  return (
    <main className={cn(
      "mx-auto min-h-dvh w-full max-w-3xl px-4 pt-7 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-12",
      centered && "grid max-w-none place-items-center pt-8 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pt-12",
      className
    )}>
      {children}
    </main>
  );
}

export function PageHeader({ eyebrow, title, description, action, backHref, backLabel, backPrefetch, className }: { eyebrow?: string; title: string; description?: ReactNode; action?: ReactNode; backHref?: string; backLabel?: string; backPrefetch?: boolean; className?: string }) {
  const t = useTranslations("Common");
  const resolvedBackLabel = backLabel ?? t("back");
  return (
    <header className={cn("mb-6 flex items-center justify-between gap-3 sm:gap-4", className)}>
      <div className="flex min-w-0 items-start gap-2 sm:gap-3">
        {backHref && <Button variant="ghost" size="icon" asChild className="shrink-0 self-start" title={resolvedBackLabel}><Link href={backHref} prefetch={backPrefetch} aria-label={resolvedBackLabel}><ArrowLeft aria-hidden="true" /></Link></Button>}
        <div className="min-w-0">
          {eyebrow && <p className="mb-1.5 text-xs font-bold tracking-[0.12em] text-muted-foreground uppercase">{eyebrow}</p>}
          <h1 className="text-xl leading-7 font-bold tracking-tight text-ink-strong first-letter:uppercase sm:text-2xl sm:leading-8">{title}</h1>
          {description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground sm:mt-2">{description}</p>}
        </div>
      </div>
      {action && <div className="shrink-0 self-start">{action}</div>}
    </header>
  );
}

export function SurfaceCard({ children, className, ...props }: React.ComponentProps<typeof Card>) {
  return <Card className={cn("gap-0 rounded-lg border border-border bg-card py-0 shadow-card ring-0", className)} {...props}>{children}</Card>;
}

export function AppFooter() {
  const t = useTranslations("Common");
  return (
    <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/95 px-4 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex min-h-14 max-w-3xl flex-col items-center justify-center gap-1 py-2 text-center min-[360px]:has-[[data-slot=app-footer-locale-switcher]]:flex-row min-[360px]:has-[[data-slot=app-footer-locale-switcher]]:justify-between min-[360px]:has-[[data-slot=app-footer-locale-switcher]]:gap-3 min-[360px]:has-[[data-slot=app-footer-locale-switcher]]:py-0">
        <p className="flex items-baseline gap-1.5 whitespace-nowrap text-sm text-muted-foreground"><Link href="/" className="text-base font-bold tracking-tight underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="text-foreground">rhasia-</span><span className="text-primary">scret</span></Link><span>{t("by")}</span><a href="https://github.com/arrokh" target="_blank" rel="noopener noreferrer" className="font-bold text-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">arrokh</a></p>
        <AppFooterLocaleSwitcher />
      </div>
    </footer>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-3", compact ? "gap-2" : "flex-col text-center")}>
      <div className={cn("relative overflow-hidden rounded-xl", compact ? "size-10" : "size-24 rounded-xl")}>
        <Image src="/pwa/icon512_rounded.png" alt="" fill sizes={compact ? "40px" : "96px"} className="object-cover" priority={!compact} />
      </div>
      <span className={cn("font-bold tracking-tight", compact ? "text-base" : "text-2xl")}>
        <span className="text-foreground">rhasia-</span><span className="text-primary">scret</span>
      </span>
    </div>
  );
}

export type StatusTone = "info" | "success" | "warning" | "danger" | "offline";

const statusStyles: Record<StatusTone, string> = {
  info: "border-info/20 bg-info-surface text-info",
  success: "border-success/20 bg-success-surface text-success",
  warning: "border-warning/25 bg-warning-surface text-warning",
  danger: "border-destructive/20 bg-danger-surface text-destructive",
  offline: "border-warning/25 bg-warning-surface text-warning"
};

const statusIcons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertCircle,
  danger: ShieldAlert,
  offline: WifiOff
};

export function StatusBanner({ tone = "info", title, children, role }: { tone?: StatusTone; title?: string; children: ReactNode; role?: "alert" | "status" }) {
  const Icon = statusIcons[tone];
  return (
    <Alert role={role ?? (tone === "danger" ? "alert" : "status")} className={cn("rounded-md px-3 py-3", statusStyles[tone])}>
      <Icon className="mt-0.5 size-4" aria-hidden="true" />
      {title && <AlertTitle role="heading" aria-level={2} className="font-bold text-current">{title}</AlertTitle>}
      <AlertDescription className="leading-5 text-current/90">{children}</AlertDescription>
    </Alert>
  );
}

export function SectionHeading({ icon: Icon = LockKeyhole, eyebrow, title, description, action }: { icon?: typeof LockKeyhole; eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-foreground" aria-hidden="true"><Icon className="size-5" /></span>
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="mb-0.5 text-xs font-bold tracking-[0.1em] text-muted-foreground uppercase">{eyebrow}</p>}
        <h2 className="text-lg leading-6 font-bold text-ink-strong">{title}</h2>
        {description && <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
