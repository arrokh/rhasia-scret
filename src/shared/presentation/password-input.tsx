"use client";

import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function PasswordInput({ label, visible, onToggleVisibility, className, ...props }: Omit<React.ComponentProps<typeof Input>, "type"> & { label: string; visible: boolean; onToggleVisibility: () => void }) {
  return <div className="relative">
    <Input {...props} type={visible ? "text" : "password"} className={cn("pr-12", className)} />
    <Button variant="ghost" size="icon" type="button" className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground" onClick={onToggleVisibility} disabled={props.disabled} aria-label={`${visible ? "Sembunyikan" : "Tampilkan"} ${label}`} title={`${visible ? "Sembunyikan" : "Tampilkan"} ${label}`}>
      {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
    </Button>
  </div>;
}
