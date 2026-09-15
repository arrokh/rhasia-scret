import { describe, expect, it } from "vitest";
import { renderMagicLinkEmail } from "@/shared/infrastructure/email-templates";

describe("magic-link email template", () => {
  it("renders the English version and escapes the action URL", () => {
    const content = renderMagicLinkEmail(
      new URL("https://vault.example.test/auth/confirm?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&x=1"),
    );

    expect(content.subject).toBe("rhasia-scret sign-in link");
    expect(content.text).toContain("Sign in to rhasia-scret");
    expect(content.text).not.toContain("Bahasa Indonesia");
    expect(content.html).toContain('lang="en"');
    expect(content.html).not.toContain('lang="id"');
    expect(content.html).not.toContain("Tautan masuk rhasia-scret");
    expect(content.html).toContain("&amp;x=1");
    expect(content.html).not.toContain(
      'href="https://vault.example.test/auth/confirm?token=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJK&x=1"',
    );
  });

  it("uses the shared warm-neutral design tokens for the email surface", () => {
    const content = renderMagicLinkEmail(new URL("https://vault.example.test/auth/confirm#token=token"));

    expect(content.html).toContain("background-color:#f8f4ed");
    expect(content.html).toContain("background-color:#fffdf9");
    expect(content.html).toContain("#e5a72e");
    expect(content.html).toContain("#171d22");
    expect(content.html).toContain("#ded8d0");
    expect(content.html).toContain("Manrope, Arial, Helvetica, sans-serif");
    expect(content.html).toContain("border-radius:16px");
    expect(content.html).toContain("border-radius:12px");
    expect(content.html).toContain('align="center" style="padding:20px 32px 18px');
    expect(content.html).toContain("font-size:18px;line-height:22px;font-weight:700");
    expect(content.html).toContain('</span> <span>by</span> <a href="https://nooroctavian.id/"');
    expect(content.html).toContain('href="https://nooroctavian.id/"');
    expect(content.html).toContain("nooroctavian.id");
    expect(content.html).toContain("font-size:12px;line-height:16px");
    expect(content.html).not.toContain("#272b68");
    expect(content.html).not.toContain("gradient");
  });
});
