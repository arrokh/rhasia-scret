import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import enMessages from "../../../../messages/en.json";
import { ServerApiUnavailablePanel } from "@/shared/presentation/server-api-unavailable-panel";

describe("ServerApiUnavailablePanel", () => {
  it("renders localized recovery actions and a route-local retry action", async () => {
    const panel = await ServerApiUnavailablePanel({ retryHref: "/vaults/recovery" });
    const markup = renderToStaticMarkup(createElement("div", null, panel));

    expect(markup).toContain("Halaman tidak dapat dimuat");
    expect(markup).toContain('href="/vaults/recovery"');
    expect(markup).toContain('href="/local"');
    expect(markup).toContain("Buka Brankas Lokal");
    expect(markup).toContain('href="/offline"');
    expect(markup).toContain("Buka snapshot luring");
  });

  it("provides equivalent English recovery copy", () => {
    expect(enMessages.Common.globalError).toEqual({
      title: "Something went wrong",
      description: "This page could not be loaded. Try again, or continue to a Local Vault or offline snapshot.",
      retry: "Try again",
      openLocalVault: "Open Local Vault",
      openOffline: "Open offline snapshot",
    });
  });
});
