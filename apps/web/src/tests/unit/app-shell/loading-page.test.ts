import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Loading from "@/app/loading";
import VaultManagementLoading from "@/app/vaults/manage/loading";
import VaultsLoading from "@/app/vaults/loading";
import {
  ActionLoadingPlaceholder,
  FormLoadingPlaceholder,
  SectionLoadingPlaceholder,
} from "@/shared/presentation/loading-placeholder";

describe("Loading", () => {
  it("announces a stable loading shell without a duplicate progressbar", () => {
    const markup = renderToStaticMarkup(createElement(Loading));

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Memuat halaman…"');
    expect(markup).not.toContain('role="progressbar"');
  });

  it("keeps route loading headers aligned with their final back and action controls", () => {
    const vaultsMarkup = renderToStaticMarkup(createElement(VaultsLoading));
    const managementMarkup = renderToStaticMarkup(createElement(VaultManagementLoading));

    expect(vaultsMarkup).not.toContain('data-slot="page-loading-back-action"');
    expect(managementMarkup).toContain('data-slot="page-loading-back-action"');
    expect(vaultsMarkup).toContain('class="size-12 shrink-0 rounded-md bg-muted"');
    expect(managementMarkup).toContain('class="size-12 shrink-0 rounded-md bg-muted"');
    expect(vaultsMarkup).toContain('class="h-7 w-48 rounded-md bg-muted sm:h-8"');
    expect(vaultsMarkup).toContain('class="h-12 w-full max-w-md rounded bg-muted sm:h-6"');
    expect(vaultsMarkup).toContain("p-5 sm:p-6");
    expect(managementMarkup).toContain("p-5 sm:p-6");
    expect(vaultsMarkup).toContain('class="h-12 rounded-md bg-muted"');
    expect(managementMarkup).toContain('class="h-7 w-32 rounded bg-muted"');
    expect(managementMarkup).toContain('class="size-12 rounded-md bg-muted"');
    expect(managementMarkup).toContain('class="grid min-h-16 gap-2 rounded-md border bg-muted/30 p-3"');
    expect(managementMarkup).not.toContain('class="h-12 rounded-md bg-muted"');
  });

  it("provides accessible placeholders scoped to an action, form, or list section", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(ActionLoadingPlaceholder),
        createElement(FormLoadingPlaceholder),
        createElement(SectionLoadingPlaceholder, { rows: 2, label: "Memuat pengguna…" }),
      ),
    );

    expect(markup.match(/role="status"/g)).toHaveLength(2);
    expect(markup).toContain('aria-label="Memuat pengguna…"');
    expect(markup).toContain("sm:grid-cols-3");
    expect(markup).toContain('class="block size-12 animate-pulse rounded-md bg-muted motion-reduce:animate-none"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role="progressbar"');
  });
});
