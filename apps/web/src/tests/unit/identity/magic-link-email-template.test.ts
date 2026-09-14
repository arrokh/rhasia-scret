import { describe, expect, it } from "vitest";
import { renderMagicLinkEmail } from "@/modules/identity/infrastructure/magic-link-email-template";

describe("magic-link email template", () => {
  it("renders both localized versions and escapes the action URL", () => {
    const content = renderMagicLinkEmail(
      new URL("https://vault.example.test/auth/confirm?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&x=1"),
    );

    expect(content.subject).toContain("rhasia-scret sign-in link");
    expect(content.subject).toContain("Tautan masuk rhasia-scret");
    expect(content.text).toContain("Bahasa Indonesia");
    expect(content.text).toContain("English");
    expect(content.html).toContain("&amp;x=1");
    expect(content.html).not.toContain(
      'href="https://vault.example.test/auth/confirm?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&x=1"',
    );
  });
});
