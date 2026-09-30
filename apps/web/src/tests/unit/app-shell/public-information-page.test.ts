import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const localeState = vi.hoisted(() => ({ locale: "id" as "id" | "en" }));

vi.mock("@/i18n/locale-switcher", () => ({ LocaleSwitcher: () => null }));
vi.mock("next-intl/server", async () => {
  const [indonesian, english] = await Promise.all([
    import("../../../../messages/id.json"),
    import("../../../../messages/en.json"),
  ]);
  const catalogs = { id: indonesian.default, en: english.default };

  return {
    getTranslations: async (namespace: string) => (key: string) => {
      let value: unknown = catalogs[localeState.locale];
      for (const segment of [namespace, ...key.split(".")]) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("The requested translation is unavailable.");
        }
        value = (value as Record<string, unknown>)[segment];
      }
      if (typeof value !== "string") throw new Error("The requested translation is unavailable.");
      return value;
    },
  };
});

import { PublicInformationPage } from "@/modules/public-information/presentation/public-information-page";

describe("public information pages", () => {
  for (const locale of ["id", "en"] as const) {
    it(`renders the ${locale} privacy disclosure with the public support links`, async () => {
      localeState.locale = locale;
      const page = await PublicInformationPage({ kind: "privacy" });
      const markup = renderToStaticMarkup(createElement("div", null, page));

      expect(markup).toContain(
        locale === "id" ? "Pengungkapan privasi dan layanan hosted" : "Privacy and hosted-service disclosure",
      );
      expect(markup).toContain("Vault Name");
      expect(markup).toContain("Tailscale Serve");
      expect(markup).toContain("Funnel");
      expect(markup).toContain("docs/privacy.md");
    });
  }

  it("renders the support disclosure with a private security route", async () => {
    localeState.locale = "id";
    const page = await PublicInformationPage({ kind: "support" });
    const markup = renderToStaticMarkup(createElement("div", null, page));

    expect(markup).toContain("Dukungan project");
    expect(markup).toContain("GitHub Security Advisory");
    expect(markup).toContain("sintetis");
    expect(markup).toContain("docs/support.md");
  });
});
