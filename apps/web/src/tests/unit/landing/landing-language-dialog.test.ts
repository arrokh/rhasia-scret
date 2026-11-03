/** @vitest-environment jsdom */

import { act, createElement, type ComponentType, type ReactNode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../../messages/en.json";
import idMessages from "../../../../messages/id.json";
import { localeCookieName } from "@/i18n/config";
import {
  LandingLanguageDialog,
  requiresLandingLanguageChoice,
} from "@/modules/landing/presentation/landing-language-dialog";

vi.unmock("next-intl");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const refresh = vi.fn();
const onlineStatus = vi.hoisted(() => ({ online: true }));
const TestIntlProvider = NextIntlClientProvider as ComponentType<{
  locale: "id" | "en";
  messages: typeof idMessages;
  children?: ReactNode;
}>;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/shared/presentation/use-online-status", () => ({ useOnlineStatus: () => onlineStatus.online }));

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  refresh.mockClear();
  onlineStatus.online = true;
  document.cookie = `${localeCookieName}=; Path=/; Max-Age=0`;
  document.documentElement.lang = "id";
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/landing");
});

describe("landing first-open language choice", () => {
  it("requires a choice when the locale cookie is missing or invalid", () => {
    expect(requiresLandingLanguageChoice("")).toBe(true);
    expect(requiresLandingLanguageChoice(`${localeCookieName}=fr`)).toBe(true);
    expect(requiresLandingLanguageChoice(`${localeCookieName}=en-US`)).toBe(true);
    expect(requiresLandingLanguageChoice("OTHER_COOKIE=en")).toBe(true);
    expect(requiresLandingLanguageChoice(`${localeCookieName}=id; session=synthetic`)).toBe(false);
    expect(requiresLandingLanguageChoice(`${localeCookieName}=en`)).toBe(false);
  });

  it("hydrates the same server shell before opening the first-visit chooser", async () => {
    const container = document.createElement("div");
    const onOpenChange = vi.fn();
    const tree = createElement(
      TestIntlProvider,
      { locale: "id", messages: idMessages },
      createElement(LandingLanguageDialog, { onOpenChange }),
    );
    container.innerHTML = renderToString(tree);
    document.body.append(container);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await act(async () => {
        root = hydrateRoot(container, tree);
      });

      expect(document.body.querySelector('[role="dialog"][data-landing-language-choice="true"]')).not.toBeNull();
      expect(onOpenChange).toHaveBeenCalledOnce();
      expect(onOpenChange).toHaveBeenCalledWith(true);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("shows bilingual choices on first open, persists an explicit choice, and reports open state", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const openChanges: boolean[] = [];

    await act(async () =>
      root?.render(
        createElement(
          TestIntlProvider,
          { locale: "id", messages: idMessages },
          createElement(LandingLanguageDialog, { onOpenChange: (open) => openChanges.push(open) }),
        ),
      ),
    );

    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"][data-landing-language-choice="true"]');
    expect(dialog?.textContent).toContain("Choose your language");
    expect(dialog?.textContent).toContain("Pilih bahasa");
    const languageButtons = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    expect(languageButtons.map((button) => button.textContent?.trim())).toEqual(["Bahasa Indonesia", "English"]);
    const englishButton = languageButtons.find((button) => button.textContent?.includes("English"));
    expect(englishButton).toBeDefined();

    await act(async () => englishButton?.click());

    expect(document.cookie).toContain(`${localeCookieName}=en`);
    expect(document.documentElement.lang).toBe("en");
    expect(refresh).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[role="dialog"][data-landing-language-choice="true"]')).toBeNull();
    expect(openChanges).toEqual([true, false]);
  });

  it("defers the chooser while offline and opens it on reconnect without a remembered choice", async () => {
    onlineStatus.online = false;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onOpenChange = vi.fn();
    const renderDialog = () =>
      root?.render(
        createElement(
          TestIntlProvider,
          { locale: "id", messages: idMessages },
          createElement(LandingLanguageDialog, { onOpenChange }),
        ),
      );
    await act(async () => renderDialog());
    expect(document.body.querySelector("[data-landing-language-choice]")).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    onlineStatus.online = true;
    await act(async () => renderDialog());
    expect(document.body.querySelector("[data-landing-language-choice]")).not.toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it.each(["id", "en"] as const)("does not open when a valid %s locale cookie exists", async (locale) => {
    document.cookie = `${localeCookieName}=${locale}; Path=/`;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () =>
      root?.render(
        createElement(
          TestIntlProvider,
          { locale, messages: locale === "id" ? idMessages : enMessages },
          createElement(LandingLanguageDialog),
        ),
      ),
    );

    expect(document.body.querySelector('[role="dialog"][data-landing-language-choice="true"]')).toBeNull();
  });
});
