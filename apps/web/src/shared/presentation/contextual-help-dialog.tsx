"use client";

import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { resolveLocale } from "@/i18n/config";
import { getContextualHelpContent, type ContextualHelpTopicId } from "./contextual-help-content";

export function ContextualHelpDialog({ topic }: { topic: ContextualHelpTopicId }) {
  const locale = resolveLocale(useLocale());
  const t = useTranslations("Common.contextualHelp");
  const content = getContextualHelpContent(topic, locale);

  return (
    <DialogContent
      className="max-h-[85dvh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-xl"
      showCloseButton={false}
    >
      <DialogClose asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-2 right-2"
          aria-label={t("close")}
          title={t("close")}
        >
          <X aria-hidden="true" />
        </Button>
      </DialogClose>
      <DialogHeader className="pr-12">
        <DialogTitle className="text-lg leading-6 font-bold text-ink-strong">{content.title}</DialogTitle>
        <DialogDescription className="leading-5">{content.summary}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <HelpSection heading={t("purpose")} text={content.purpose} />
        <HelpSection heading={t("nextStep")} text={content.nextStep} />
        <HelpSection heading={t("consequences")} text={content.consequences} />
        <HelpSection heading={t("cancelOrRecover")} text={content.cancelOrRecover} />
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {t("close")}
          </Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  );
}

function HelpSection({ heading, text }: { heading: string; text: string }) {
  return (
    <section className="grid gap-1.5">
      <h3 className="text-sm font-bold text-foreground">{heading}</h3>
      <p className="text-sm leading-5 text-muted-foreground">{text}</p>
    </section>
  );
}
