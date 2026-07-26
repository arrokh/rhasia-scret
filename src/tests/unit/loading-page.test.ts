import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Loading from "@/app/loading";

describe("Loading", () => {
  it("announces page navigation progress", () => {
    const markup = renderToStaticMarkup(createElement(Loading));

    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-label="Membuka halaman"');
    expect(markup).toContain('aria-valuetext="Sedang memuat"');
  });
});
