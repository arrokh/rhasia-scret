import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button";

describe("shared Button design tokens", () => {
  it("keeps standard icon actions the same 48px height as standard text actions", () => {
    const textButton = buttonVariants({ size: "default" });
    const iconButton = buttonVariants({ size: "icon" });

    expect(textButton).toContain("h-12");
    expect(iconButton).toContain("size-12");
  });

  it("preserves distinct compact action sizes", () => {
    expect(buttonVariants({ size: "sm" })).toContain("h-10");
    expect(buttonVariants({ size: "icon-sm" })).toContain("size-10");
  });
});
