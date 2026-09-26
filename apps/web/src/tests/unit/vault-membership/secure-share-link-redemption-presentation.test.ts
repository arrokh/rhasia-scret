/** @vitest-environment jsdom */

import { act, createElement, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import idMessages from "../../../../messages/id.json";
import { SecureShareLinkRedemption } from "@/modules/vault-membership";

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
  window.history.replaceState(null, "", "/");
});

describe("Secure Share Link redemption presentation", () => {
  it("places localized contextual help beside the recipient action", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () =>
      root?.render(
        createElement(
          TestIntlProvider,
          { locale: "id", messages: idMessages },
          createElement(SecureShareLinkRedemption, { userRootKey: new Uint8Array() }),
        ),
      ),
    );

    expect(container.querySelector('[aria-label="Buka panduan: Undangan Brankas Bersama"]')).not.toBeNull();
    expect(container.textContent).toContain("Terima undangan");
  });
});
