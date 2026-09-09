import { vi } from "vitest";
import idMessages from "../../messages/id.json";

vi.mock("next-intl", async () => {
  const actual = await vi.importActual<typeof import("next-intl")>("next-intl");
  return {
    ...actual,
    useLocale: () => "id",
    useTranslations: (namespace?: string) =>
      actual.createTranslator({ locale: "id", messages: idMessages, namespace: namespace as never }),
  };
});

vi.mock("next-intl/server", async () => {
  const actual = await vi.importActual<typeof import("next-intl/server")>("next-intl/server");
  const core = await vi.importActual<typeof import("next-intl")>("next-intl");
  return {
    ...actual,
    getLocale: async () => "id",
    getMessages: async () => idMessages,
    getTranslations: async (namespace?: string) =>
      core.createTranslator({ locale: "id", messages: idMessages, namespace: namespace as never }),
  };
});

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in globalThis)) Object.assign(globalThis, { ResizeObserver: TestResizeObserver });

if (typeof HTMLElement !== "undefined") {
  HTMLElement.prototype.scrollIntoView ??= () => undefined;
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => undefined;
  HTMLElement.prototype.releasePointerCapture ??= () => undefined;
}

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = () => ({
    matches: false,
    media: "",
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}
