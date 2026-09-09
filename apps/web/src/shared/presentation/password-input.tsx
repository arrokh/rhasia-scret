"use client";

import { Eye, EyeOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function PasswordInput({
  label,
  visible,
  onToggleVisibility,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "type"> & {
  label: string;
  visible: boolean;
  onToggleVisibility: () => void;
}) {
  const t = useTranslations("Common");
  const visibilityLabel = t(visible ? "hideField" : "showField", { label });
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className={cn("pr-12", className)} />
      <Button
        variant="ghost"
        size="icon"
        type="button"
        className="absolute inset-y-0 right-1 my-auto text-muted-foreground transition-none active:!translate-y-0"
        onClick={onToggleVisibility}
        disabled={props.disabled}
        aria-label={visibilityLabel}
        title={visibilityLabel}
      >
        {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  );
}
