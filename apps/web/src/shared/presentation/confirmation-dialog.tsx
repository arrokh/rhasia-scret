"use client";

import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  pending = false,
  danger = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("Common");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <DialogContent className="max-w-sm rounded-lg border-border bg-card p-5 shadow-sheet" showCloseButton={!pending}>
        <DialogHeader className="items-center text-center sm:items-center sm:text-center">
          <span
            className={`grid size-12 place-items-center rounded-full ${danger ? "bg-danger-surface text-destructive" : "bg-warning-surface text-warning"}`}
            aria-hidden="true"
          >
            <TriangleAlert className="size-6" />
          </span>
          <DialogTitle className="text-xl leading-7 font-bold text-ink-strong">{title}</DialogTitle>
          <DialogDescription className="text-center leading-5 text-muted-foreground">{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="-mx-5 -mb-5 mt-1 grid grid-cols-2 gap-2 bg-muted/60 p-4 sm:grid-cols-2">
          <Button variant="outline" type="button" onClick={onCancel} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button
            variant={danger ? "destructive" : "default"}
            type="button"
            onClick={onConfirm}
            disabled={pending}
            aria-busy={pending}
          >
            {pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {pending ? t("processing") : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
