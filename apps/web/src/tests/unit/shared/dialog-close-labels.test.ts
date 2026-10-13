/** @vitest-environment jsdom */

import { act, createElement, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../../messages/en.json";
import idMessages from "../../../../messages/id.json";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

vi.unmock("next-intl");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const TestIntlProvider = NextIntlClientProvider as ComponentType<{
  locale: "id" | "en";
  messages: typeof idMessages;
  children?: ReactNode;
}>;

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function CloseControls() {
  const t = useTranslations("Common");
  return createElement(
    "div",
    null,
    createElement(
      Dialog,
      { open: true },
      createElement(
        DialogContent,
        { closeLabel: t("close") },
        createElement(DialogTitle, null, "Synthetic dialog"),
        createElement(DialogFooter, { showCloseButton: true, closeLabel: t("close") }),
      ),
    ),
    createElement(
      Sheet,
      { open: true },
      createElement(SheetContent, { closeLabel: t("close") }, createElement(SheetTitle, null, "Synthetic sheet")),
    ),
  );
}

describe("localized dialog and sheet close controls", () => {
  it.each([
    { locale: "id", messages: idMessages, close: "Tutup" },
    { locale: "en", messages: enMessages, close: "Close" },
  ] as const)("uses the $locale close label for icon and footer actions", async ({ locale, messages, close }) => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(createElement(TestIntlProvider, { locale, messages }, createElement(CloseControls))),
    );

    const dialogClose = document.body.querySelector<HTMLButtonElement>('[data-slot="dialog-close"]');
    const sheetClose = document.body.querySelector<HTMLButtonElement>('[data-slot="sheet-close"]');
    const footerClose = document.body.querySelector<HTMLButtonElement>('[data-slot="dialog-footer"] button');
    expect(dialogClose?.textContent).toContain(close);
    expect(sheetClose?.textContent).toContain(close);
    expect(footerClose?.textContent).toBe(close);
  });
});
