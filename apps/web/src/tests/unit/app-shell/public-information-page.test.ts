import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/locale-switcher", () => ({ LocaleSwitcher: () => null }));

import { PublicInformationPage } from "@/modules/public-information/presentation/public-information-page";

describe("public information pages", () => {
  it("renders the privacy disclosure with the public support links", async () => {
    const page = await PublicInformationPage({ kind: "privacy" });
    const markup = renderToStaticMarkup(createElement("div", null, page));

    expect(markup).toContain("Pengungkapan privasi dan layanan hosted");
    expect(markup).toContain("Vault Name");
    expect(markup).toContain("docs/privacy.md");
  });

  it("renders the support disclosure with a private security route", async () => {
    const page = await PublicInformationPage({ kind: "support" });
    const markup = renderToStaticMarkup(createElement("div", null, page));

    expect(markup).toContain("Dukungan project");
    expect(markup).toContain("GitHub Security Advisory");
    expect(markup).toContain("sintetis");
    expect(markup).toContain("docs/support.md");
  });
});
