import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LandingPage from "@/app/page";

describe("LandingPage", () => {
  it("presents the public product landing page with a sign-in call to action", () => {
    const markup = renderToStaticMarkup(createElement(LandingPage));

    expect(markup).toContain("rhasia-");
    expect(markup).toContain("scret");
    expect(markup).toContain("Autentikator TOTP terenkripsi");
    expect(markup).toContain('href="/sign-in"');
    expect(markup).toContain(">Masuk<");
    expect(markup).not.toContain("Alamat email yang diundang");
  });
});
