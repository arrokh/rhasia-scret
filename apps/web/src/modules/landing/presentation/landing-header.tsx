"use client";

import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { FaGithub } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { LocaleSwitcher } from "@/i18n/locale-switcher";
import styles from "./landing-header.module.css";

type LandingHeaderProps = {
  githubLabel: string;
};

export function LandingHeader({ githubLabel }: LandingHeaderProps) {
  const headerRef = useRef<HTMLElement>(null);
  const t = useTranslations("Home.landing");

  useLayoutEffect(() => {
    const header = headerRef.current;
    const page = header?.closest("main");
    if (!header || !page) return;
    const measureHeader = () =>
      page.style.setProperty("--landing-header-height", `${header.getBoundingClientRect().height}px`);
    measureHeader();
    const observer = new ResizeObserver(measureHeader);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return (
    <header ref={headerRef} data-landing-header data-testid="landing-sticky-header" className={styles.header}>
      <nav aria-label={t("navigation.label")} className={`landing-shell ${styles.navigation}`}>
        <Link href="/" className={styles.brand}>
          <span className="text-foreground">rhasia-</span>
          <span className="text-warning">scret</span>
        </Link>
        <div className={styles.actions}>
          <Button asChild variant="ghost" size="icon">
            <a
              href="https://github.com/arrokh/rhasia-scret"
              target="_blank"
              rel="noopener noreferrer"
              aria-label={githubLabel}
              title={githubLabel}
            >
              <FaGithub aria-hidden="true" />
            </a>
          </Button>
          <LocaleSwitcher compactAtNarrow />
          <Button asChild variant="secondary">
            <Link href="/sign-in">{t("signIn")}</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
