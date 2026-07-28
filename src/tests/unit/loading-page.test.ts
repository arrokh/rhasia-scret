import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Loading from "@/app/loading";
import { ActionLoadingPlaceholder, FormLoadingPlaceholder, SectionLoadingPlaceholder } from "@/shared/presentation/loading-placeholder";

describe("Loading", () => {
  it("announces a stable loading shell without a duplicate progressbar", () => {
    const markup = renderToStaticMarkup(createElement(Loading));

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Memuat halaman…"');
    expect(markup).not.toContain('role="progressbar"');
  });

  it("provides accessible placeholders scoped to an action, form, or list section", () => {
    const markup = renderToStaticMarkup(createElement("div", null,
      createElement(ActionLoadingPlaceholder),
      createElement(FormLoadingPlaceholder),
      createElement(SectionLoadingPlaceholder, { rows: 2, label: "Memuat pengguna…" })
    ));

    expect(markup.match(/role="status"/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="Memuat pengguna…"');
    expect(markup).toContain("sm:grid-cols-3");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role="progressbar"');
  });
});
