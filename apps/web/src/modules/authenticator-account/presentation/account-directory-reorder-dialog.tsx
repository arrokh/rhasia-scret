"use client";

import { useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, GripVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type AccountDirectoryReorderItem = {
  key: string;
  issuer: string;
  accountName: string;
  vaultName: string;
};

export function AccountDirectoryReorderDialog({
  open,
  onOpenChange,
  accounts,
  onMove,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: AccountDirectoryReorderItem[];
  onMove: (sourceKey: string, targetKey: string, placement?: "before" | "after") => void;
  labels: {
    title: string;
    description: string;
    dragAccount: (account: string) => string;
    moveUp: (account: string) => string;
    moveDown: (account: string) => string;
    close: string;
  };
}) {
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);

  function handleDragStart(key: string, event: DragEvent<HTMLButtonElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", key);
    setDraggedKey(key);
  }

  function handleDragEnd() {
    setDraggedKey(null);
    setDropTargetKey(null);
  }

  function handleDragOver(key: string, event: DragEvent<HTMLLIElement>) {
    if (!draggedKey || draggedKey === key) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetKey(key);
  }

  function handleDrop(key: string, event: DragEvent<HTMLLIElement>) {
    event.preventDefault();
    const sourceKey = event.dataTransfer.getData("text/plain") || draggedKey;
    if (sourceKey && sourceKey !== key) {
      const sourceIndex = accounts.findIndex((account) => account.key === sourceKey);
      const targetIndex = accounts.findIndex((account) => account.key === key);
      const placement = sourceIndex < targetIndex ? "after" : "before";
      onMove(sourceKey, key, placement);
    }
    handleDragEnd();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <ul
          data-slot="account-directory-reorder-list"
          className="grid max-h-[55dvh] list-none gap-2 overflow-y-auto p-0"
        >
          {accounts.map((account, index) => (
            <li
              key={account.key}
              data-account-key={account.key}
              data-dragging={draggedKey === account.key ? "true" : undefined}
              onDragOver={(event) => handleDragOver(account.key, event)}
              onDrop={(event) => handleDrop(account.key, event)}
              className={cn(
                "min-w-0 rounded-lg border border-border bg-card transition-[background-color,box-shadow,opacity]",
                draggedKey === account.key && "opacity-55",
                dropTargetKey === account.key && "bg-gold-soft/40 shadow-[0_0_0_2px_var(--ring)]",
              )}
            >
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 p-2">
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  draggable
                  aria-label={labels.dragAccount(account.accountName)}
                  title={labels.dragAccount(account.accountName)}
                  onDragStart={(event) => handleDragStart(account.key, event)}
                  onDragEnd={handleDragEnd}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <GripVertical aria-hidden="true" />
                </Button>
                <span className="grid min-w-0 gap-0.5">
                  <strong className="truncate text-sm font-bold text-ink-strong">{account.issuer}</strong>
                  <span className="truncate text-sm text-muted-foreground">{account.accountName}</span>
                  <span className="truncate text-xs text-taupe">{account.vaultName}</span>
                </span>
                <span className="flex items-center gap-0.5">
                  {index > 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      aria-label={labels.moveUp(account.accountName)}
                      title={labels.moveUp(account.accountName)}
                      onClick={() => {
                        const target = accounts[index - 1];
                        if (target) onMove(account.key, target.key, "before");
                      }}
                    >
                      <ArrowUp aria-hidden="true" />
                    </Button>
                  )}
                  {index < accounts.length - 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      aria-label={labels.moveDown(account.accountName)}
                      title={labels.moveDown(account.accountName)}
                      onClick={() => {
                        const target = accounts[index + 1];
                        if (target) onMove(account.key, target.key, "after");
                      }}
                    >
                      <ArrowDown aria-hidden="true" />
                    </Button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" type="button">
              <X aria-hidden="true" />
              {labels.close}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
