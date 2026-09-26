"use client";

import { lazy, Suspense, useState } from "react";
import { useTranslations } from "next-intl";
import { CircleHelp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import type { ContextualHelpTopicId } from "./contextual-help-content";

const ContextualHelpDialog = lazy(() =>
  import("./contextual-help-dialog").then((module) => ({ default: module.ContextualHelpDialog })),
);

export function ContextualHelpButton({
  topic,
  size = "icon",
}: {
  topic: ContextualHelpTopicId;
  size?: "icon" | "icon-sm";
}) {
  const t = useTranslations("Common.contextualHelp");
  const [open, setOpen] = useState(false);
  const topicTitle = t(`topics.${topic}`);
  const openLabel = t("open", { topic: topicTitle });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size={size} aria-label={openLabel} title={openLabel}>
          <CircleHelp aria-hidden="true" />
        </Button>
      </DialogTrigger>
      {open ? (
        <Suspense fallback={null}>
          <ContextualHelpDialog topic={topic} />
        </Suspense>
      ) : null}
    </Dialog>
  );
}
