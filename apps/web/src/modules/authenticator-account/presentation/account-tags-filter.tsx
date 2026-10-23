"use client";

import { Tag } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AccountTagsFilter({
  availableTags,
  selectedTags,
  onSelectedTagsChange,
}: {
  availableTags: string[];
  selectedTags: string[];
  onSelectedTagsChange: (tags: string[]) => void;
}) {
  const t = useTranslations("AuthenticatorAccount.accounts");
  if (availableTags.length === 0) return null;

  const active = selectedTags.length > 0;

  function toggleTag(tag: string, checked: boolean) {
    if (checked) {
      if (selectedTags.includes(tag)) return;
      onSelectedTagsChange([...selectedTags, tag]);
      return;
    }
    onSelectedTagsChange(selectedTags.filter((selectedTag) => selectedTag !== tag));
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          type="button"
          data-slot="account-tags-filter"
          data-active={active}
          className={active ? "relative shrink-0 border-primary bg-primary/10 text-foreground" : "shrink-0"}
          aria-label={t("filterByTag")}
          aria-description={active ? t("filtersApplied") : undefined}
          title={t("filterByTag")}
        >
          <Tag aria-hidden="true" />
          {active && (
            <span
              data-slot="account-tags-filter-indicator"
              aria-hidden="true"
              className="absolute top-2 right-2 size-2.5 rounded-full bg-primary ring-2 ring-background"
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 rounded-md border-border bg-popover p-2 shadow-card">
        <DropdownMenuLabel>{t("filterByTag")}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={!active}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(checked) => {
            if (checked) onSelectedTagsChange([]);
          }}
        >
          {t("allTags")}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {availableTags.map((tag) => (
          <DropdownMenuCheckboxItem
            key={tag}
            checked={selectedTags.includes(tag)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => toggleTag(tag, checked === true)}
          >
            {tag}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
