"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Cloud, Laptop } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type LandingMobileCtaProps = {
  localVaultLabel: string;
  hostedVaultLabel: string;
};

export function LandingMobileCta({ localVaultLabel, hostedVaultLabel }: LandingMobileCtaProps) {
  const [isHeroVisible, setIsHeroVisible] = useState(true);
  const showActions = !isHeroVisible;

  useEffect(() => {
    const heroActions = document.getElementById("landing-hero-actions");
    if (!heroActions) return;

    const heroObserver = new IntersectionObserver(([entry]) => {
      setIsHeroVisible(entry.isIntersecting);
    }, { threshold: 0.1 });
    heroObserver.observe(heroActions);
    return () => heroObserver.disconnect();
  }, []);

  return (
    <div
      aria-hidden={!showActions}
      inert={showActions ? undefined : true}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform motion-reduce:transition-none backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:hidden",
        showActions ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0"
      )}
    >
      <div className="mx-auto grid max-w-md grid-cols-2 gap-2">
        <Button asChild className="min-h-12 min-w-0 px-3 text-sm"><Link href="/local?from=landing"><Laptop aria-hidden="true" />{localVaultLabel}</Link></Button>
        <Button asChild className="min-h-12 min-w-0 bg-[#1b252c] px-3 text-sm text-card hover:bg-[#2b3a44] active:bg-[#11181d]"><Link href="/sign-in"><Cloud aria-hidden="true" />{hostedVaultLabel}</Link></Button>
      </div>
    </div>
  );
}
