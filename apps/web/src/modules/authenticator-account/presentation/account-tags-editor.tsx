"use client";

import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormFieldError } from "@/shared/presentation/form-field-error";

export function AccountTagsEditor({
  tags,
  draft,
  errors,
  inputId,
  errorId,
  disabled,
  busy,
  onDraftChange,
  onAdd,
  onRemove,
}: {
  tags: string[];
  draft: string;
  errors: unknown[];
  inputId: string;
  errorId: string;
  disabled: boolean;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const t = useTranslations("AuthenticatorAccount.manager");
  const describedBy = errors.length > 0 ? `${inputId}-help ${errorId}` : `${inputId}-help`;

  return (
    <section className="grid gap-3" aria-labelledby={`${inputId}-title`}>
      <div>
        <h3 id={`${inputId}-title`} className="font-bold text-ink-strong">
          {t("tagsTitle")}
        </h3>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{t("tagsDescription")}</p>
      </div>
      {tags.length > 0 ? (
        <ul aria-label={t("selectedTags")} className="flex list-none flex-wrap gap-2 p-0">
          {tags.map((tag, index) => (
            <li key={`${tag}:${index}`}>
              <span className="inline-flex min-h-12 max-w-full items-center gap-1 rounded-full border border-border bg-muted/50 pl-3 pr-0.5">
                <span className="min-w-0 max-w-48 truncate text-sm font-medium text-foreground" title={tag}>
                  {tag}
                </span>
                {!disabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                    aria-label={t("removeTag", { tag })}
                    title={t("removeTag", { tag })}
                    disabled={busy}
                    onClick={() => onRemove(index)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{t("tagsEmpty")}</p>
      )}
      {!disabled && (
        <div className="grid gap-2">
          <Label htmlFor={inputId}>{t("tagInputLabel")}</Label>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <Input
              id={inputId}
              value={draft}
              maxLength={64}
              placeholder={t("tagPlaceholder")}
              aria-invalid={errors.length > 0}
              aria-describedby={describedBy}
              disabled={busy}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                onAdd();
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={busy || !draft.trim() || errors.length > 0}
              onClick={onAdd}
            >
              {t("addTag")}
            </Button>
          </div>
          <p id={`${inputId}-help`} className="text-xs leading-5 text-muted-foreground">
            {t("tagInputHelp")}
          </p>
          <FormFieldError id={errorId} errors={errors} />
        </div>
      )}
    </section>
  );
}
