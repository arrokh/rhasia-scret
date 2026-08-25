/** @vitest-environment jsdom */

import { act, createElement, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createTranslator, NextIntlClientProvider, type IntlError } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../../messages/en.json";
import idMessages from "../../../../messages/id.json";
import { defaultLocale, deterministicTimeZone, formattingLocales, isAppLocale, localeCookieName, resolveLocale } from "@/i18n/config";
import { formatJakartaAuditDateTime, formatLocalDateTime, formatRelativeDateTime } from "@/i18n/format";
import { LocaleSwitcher } from "@/i18n/locale-switcher";

vi.unmock("next-intl");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const refresh = vi.fn();
const TestIntlProvider = NextIntlClientProvider as ComponentType<{ locale: "id" | "en"; messages: typeof idMessages; children?: ReactNode }>;
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  refresh.mockClear();
  document.cookie = `${localeCookieName}=; Path=/; Max-Age=0`;
  document.documentElement.lang = "id";
  window.history.replaceState(null, "", "/");
  document.body.innerHTML = "";
});

describe("i18n foundation", () => {
  it("accepts only supported locales and falls back deterministically to Indonesian", () => {
    expect(defaultLocale).toBe("id");
    expect(isAppLocale("id")).toBe(true);
    expect(isAppLocale("en")).toBe(true);
    expect(isAppLocale("en-US")).toBe(false);
    expect(resolveLocale(undefined)).toBe("id");
    expect(resolveLocale("malformed")).toBe("id");
    expect(resolveLocale("en")).toBe("en");
  });

  it("keeps English and Indonesian catalogs at exact, non-empty key parity with valid ICU messages", () => {
    expect(catalogEntries(enMessages).map(({ key }) => key)).toEqual(catalogEntries(idMessages).map(({ key }) => key));
    expect([...catalogEntries(idMessages), ...catalogEntries(enMessages)].every((entry) => entry.value.trim().length > 0)).toBe(true);
    expect(validateCatalog("id", idMessages)).toEqual([]);
    expect(validateCatalog("en", enMessages)).toEqual([]);
    expect(idMessages).not.toHaveProperty("Access");
    expect(Object.keys(idMessages)).toEqual(expect.arrayContaining(["Identity", "Crypto", "AuthenticatorAccount", "OtpRuntime", "VaultManagement", "VaultMembership", "Sync", "VaultArchive"]));
  });

  it("formats fixed dates and plurals according to each locale", () => {
    const date = new Date("2026-07-26T13:28:00.000Z");
    const options: Intl.DateTimeFormatOptions = { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false };
    const indonesianDate = new Intl.DateTimeFormat(formattingLocales.id, options).format(date);
    const englishDate = new Intl.DateTimeFormat(formattingLocales.en, options).format(date);
    expect(indonesianDate).not.toBe(englishDate);
    expect(indonesianDate).toContain("26 Jul 2026");
    expect(englishDate).toContain("Jul 26, 2026");
    expect(deterministicTimeZone).toBe("UTC");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(formatLocalDateTime(date, "id")).not.toBe(formatLocalDateTime(date, "en"));
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    expect(formatJakartaAuditDateTime(date.toISOString(), "id")).toContain("26 Jul 2026");
    expect(formatJakartaAuditDateTime(date.toISOString(), "en")).toContain("Jul 26, 2026");
    expect(formatRelativeDateTime("2026-07-24T13:28:00.000Z", "id", date.getTime())).toBe("2 hari yang lalu");
    expect(formatRelativeDateTime("2026-07-24T13:28:00.000Z", "en", date.getTime())).toBe("2 days ago");

    const id = createTranslator({ locale: "id", messages: idMessages });
    const en = createTranslator({ locale: "en", messages: enMessages });
    expect(id("OtpRuntime.local.remaining", { seconds: 2 })).toBe("2 detik tersisa");
    expect(en("OtpRuntime.local.remaining", { seconds: 1 })).toBe("1 second remaining");
  });

  it("renders a representative client surface from the English catalog", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(TestIntlProvider, { locale: "en", messages: enMessages }, createElement(LocaleSwitcher))));

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Choose language"]');
    expect(trigger?.textContent).toContain("English");
    expect(trigger?.title).toBe("Current language: English");
    await act(async () => trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
    const options = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(options.map((option) => option.textContent)).toEqual(["Bahasa Indonesia", "English"]);
    expect(options[1]?.getAttribute("aria-checked")).toBe("true");
  });

  it("writes the locale cookie, updates document language, and refreshes without changing routes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(TestIntlProvider, { locale: "id", messages: idMessages }, createElement(LocaleSwitcher))));

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Pilih bahasa"]');
    expect(trigger?.textContent).toContain("Bahasa Indonesia");
    window.history.replaceState(null, "", "/vaults/invitations/redeem#secure-share-secret");
    await act(async () => trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
    const englishOption = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((option) => option.textContent === "English");
    await act(async () => englishOption?.click());
    expect(document.body.textContent).toContain("Ganti bahasa aplikasi?");
    const confirm = [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Ganti bahasa");
    await act(async () => confirm?.click());

    expect(window.location.pathname).toBe("/vaults/invitations/redeem");
    expect(window.location.hash).toBe("#secure-share-secret");
    expect(document.cookie).toContain(`${localeCookieName}=en`);
    expect(document.documentElement.lang).toBe("en");
    expect(refresh).toHaveBeenCalledOnce();
  });
});

function validateCatalog(locale: "id" | "en", messages: typeof idMessages): string[] {
  const errors: string[] = [];
  const translator = createTranslator({ locale, messages, onError: (error: IntlError) => errors.push(`${error.code}: ${error.message}`) });
  const values = {
    account: "account", count: 2, date: "date", email: "user@example.test", id: "opaque-id", issuer: "issuer", label: "label",
    language: "language", name: "name", newVault: "no", number: 2, role: "role", seconds: 2, state: "state", vault: "vault",
    source: "source", value: "value", token: (chunks: ReactNode) => chunks
  };
  for (const { key } of catalogEntries(messages)) translator.rich(key as never, values as never);
  return errors;
}

function catalogEntries(value: unknown, prefix = ""): Array<{ key: string; value: string }> {
  if (typeof value === "string") return [{ key: prefix, value }];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid catalog node at ${prefix || "root"}.`);
  return Object.entries(value).flatMap(([key, child]) => catalogEntries(child, prefix ? `${prefix}.${key}` : key));
}
