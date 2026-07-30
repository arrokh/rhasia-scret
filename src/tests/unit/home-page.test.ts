import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/locale-switcher", () => ({ LocaleSwitcher: () => null }));

import LandingPage from "@/app/page";

describe("LandingPage", () => {
  it("presents the public product landing page with a sign-in call to action", async () => {
    const page = await LandingPage();
    const markup = renderToStaticMarkup(createElement("div", null, page));

    expect(markup).toContain("rhasia-");
    expect(markup).toContain("scret");
    expect(markup).toContain("Autentikator Anda, sesuai ketentuan Anda");
    expect(markup).toContain("Jalur yang disengaja");
    expect(markup).toContain("Browser Anda");
    expect(markup).toContain('href="/sign-in"');
    expect(markup).toContain('href="/local"');
    expect(markup).toContain('href="https://rhasia-scret.vercel.app/sign-in"');
    expect(markup).toContain('href="https://github.com/arrokh"');
    expect(markup).toContain(">Coba Local Vault<");
    expect(markup).not.toContain("Alamat email yang diundang");
  });
});
