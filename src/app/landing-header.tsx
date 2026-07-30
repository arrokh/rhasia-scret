"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { FaGithub } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "@/i18n/locale-switcher";
import { cn } from "@/lib/utils";
import { Brand } from "@/shared/presentation/app-ui";

type LandingHeaderProps = {
  signInLabel: string;
  githubLabel: string;
};

export function LandingHeader({ signInLabel, githubLabel }: LandingHeaderProps) {
  const [hasPassedHero, setHasPassedHero] = useState(false);

  useEffect(() => {
    const heroEnd = document.getElementById("landing-hero-end");
    if (!heroEnd) return;

    const updateHeader = () => {
      const heroEndPosition = heroEnd.getBoundingClientRect().top + window.scrollY;
      setHasPassedHero(window.scrollY >= heroEndPosition);
    };

    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    window.addEventListener("resize", updateHeader);

    return () => {
      window.removeEventListener("scroll", updateHeader);
      window.removeEventListener("resize", updateHeader);
    };
  }, []);

  return (
    <>
      <header className="landing-shell flex items-center justify-between gap-3 py-5 sm:py-7">
        <BrandLink />
        <div className="flex items-center gap-1 sm:gap-2">
          <GitHubLink label={githubLabel} />
          <LocaleSwitcher />
        </div>
      </header>

      <header
        data-testid="landing-sticky-header"
        aria-hidden={!hasPassedHero}
        inert={hasPassedHero ? undefined : true}
        className={cn(
          "fixed inset-x-0 top-0 z-50 hidden border-b border-border/80 bg-background/95 px-4 shadow-sm transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:block",
          hasPassedHero ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-[calc(100%+0.5rem)] opacity-0"
        )}
      >
        <div className="landing-shell flex min-h-16 items-center justify-between gap-3">
          <BrandLink />
          <div className="flex items-center gap-1 sm:gap-2">
            <Button asChild size="sm"><Link href="/sign-in">{signInLabel}</Link></Button>
            <GitHubLink label={githubLabel} />
            <LocaleSwitcher />
          </div>
        </div>
      </header>
    </>
  );
}

function BrandLink() {
  return (
    <Link href="/" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Brand compact />
    </Link>
  );
}

function GitHubLink({ label }: { label: string }) {
  return (
    <a href="https://github.com/arrokh" target="_blank" rel="noopener noreferrer" aria-label={label} title={label} className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <FaGithub className="size-5" aria-hidden="true" />
    </a>
  );
}
