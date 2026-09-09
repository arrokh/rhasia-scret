"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FaGithub } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "@/i18n/locale-switcher";
import { cn } from "@/lib/utils";
import { Brand } from "@/shared/presentation/app-ui";

type LandingHeaderProps = {
  localVaultLabel: string;
  hostedVaultLabel: string;
  githubLabel: string;
};

export function LandingHeader({ localVaultLabel, hostedVaultLabel, githubLabel }: LandingHeaderProps) {
  const [hasPassedHero, setHasPassedHero] = useState(false);

  useEffect(() => {
    const heroEnd = document.getElementById("landing-hero-end");
    if (!heroEnd) return;
    let animationFrame: number | undefined;

    const updateHeader = () => {
      const heroEndPosition = heroEnd.getBoundingClientRect().top + window.scrollY;
      setHasPassedHero(window.scrollY >= heroEndPosition);
    };

    const scheduleHeaderUpdate = () => {
      if (animationFrame !== undefined) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = undefined;
        updateHeader();
      });
    };

    updateHeader();
    window.addEventListener("scroll", scheduleHeaderUpdate, { passive: true });
    window.addEventListener("resize", scheduleHeaderUpdate);

    return () => {
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("scroll", scheduleHeaderUpdate);
      window.removeEventListener("resize", scheduleHeaderUpdate);
    };
  }, []);

  return (
    <>
      <header className="landing-shell flex items-center justify-between gap-3 py-5 sm:py-7">
        <BrandLink />
        <div className="flex items-center gap-1 sm:gap-2">
          <GitHubButton label={githubLabel} />
          <LocaleSwitcher />
        </div>
      </header>

      <header
        data-testid="landing-sticky-header"
        aria-hidden={!hasPassedHero}
        inert={hasPassedHero ? undefined : true}
        className={cn(
          "fixed inset-x-0 top-0 z-50 hidden border-b border-border/80 bg-background/95 px-4 shadow-sm transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:block",
          hasPassedHero
            ? "translate-y-0 opacity-100"
            : "pointer-events-none -translate-y-[calc(100%+0.5rem)] opacity-0",
        )}
      >
        <div className="landing-shell flex min-h-16 items-center justify-between gap-3">
          <BrandLink />
          <div className="flex items-center gap-1 sm:gap-2">
            <Button asChild size="sm" className="px-2.5">
              <Link href="/local?from=landing">{localVaultLabel}</Link>
            </Button>
            <Button asChild size="sm" className="bg-[#1b252c] px-2.5 text-card hover:bg-[#2b3a44] active:bg-[#11181d]">
              <Link href="/sign-in">{hostedVaultLabel}</Link>
            </Button>
            <GitHubButton label={githubLabel} />
            <LocaleSwitcher />
          </div>
        </div>
      </header>
    </>
  );
}

function BrandLink() {
  return (
    <Link
      href="/"
      className="shrink-0 whitespace-nowrap rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Brand compact />
    </Link>
  );
}

function GitHubButton({ label }: { label: string }) {
  return (
    <Button asChild variant="ghost" size="icon-sm">
      <a
        href="https://github.com/arrokh/rhasia-scret"
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        title={label}
      >
        <FaGithub className="size-5" aria-hidden="true" />
      </a>
    </Button>
  );
}
