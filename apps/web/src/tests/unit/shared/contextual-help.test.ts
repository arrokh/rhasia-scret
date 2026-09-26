/** @vitest-environment jsdom */

import { act, createElement, useState, type ChangeEvent, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../../messages/en.json";
import idMessages from "../../../../messages/id.json";
import contextualHelpJson from "@/shared/presentation/contextual-help-content.json";
import { ContextualHelpButton } from "@/shared/presentation/contextual-help";
import { CONTEXTUAL_HELP_TOPIC_IDS, getContextualHelpContent } from "@/shared/presentation/contextual-help-content";

vi.unmock("next-intl");
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const TestIntlProvider = NextIntlClientProvider as ComponentType<{
  locale: "id" | "en";
  messages: typeof idMessages;
  children?: ReactNode;
}>;
const localizedHelpTopicSchema = z
  .object({
    title: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    purpose: z.string().trim().min(1),
    nextStep: z.string().trim().min(1),
    consequences: z.string().trim().min(1),
    cancelOrRecover: z.string().trim().min(1),
  })
  .strict();
const contextualHelpSchema = z
  .object({
    personalVaultSetup: z.object({ id: localizedHelpTopicSchema, en: localizedHelpTopicSchema }).strict(),
    personalVaultUnlock: z.object({ id: localizedHelpTopicSchema, en: localizedHelpTopicSchema }).strict(),
    authenticatorAccountImport: z.object({ id: localizedHelpTopicSchema, en: localizedHelpTopicSchema }).strict(),
    sharedVaultInvitations: z.object({ id: localizedHelpTopicSchema, en: localizedHelpTopicSchema }).strict(),
    sharedVaultPermissions: z.object({ id: localizedHelpTopicSchema, en: localizedHelpTopicSchema }).strict(),
  })
  .strict();

let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("contextual help", () => {
  it("validates every required help topic in both locales with complete static guidance", () => {
    const content = contextualHelpSchema.parse(contextualHelpJson);
    expect(contextualHelpSchema.safeParse({ ...contextualHelpJson, unsupportedTopic: "not permitted" }).success).toBe(
      false,
    );
    expect(CONTEXTUAL_HELP_TOPIC_IDS).toEqual([
      "personalVaultSetup",
      "personalVaultUnlock",
      "authenticatorAccountImport",
      "sharedVaultInvitations",
      "sharedVaultPermissions",
    ]);

    const localeMessages = { id: idMessages, en: enMessages };
    for (const locale of ["id", "en"] as const) {
      for (const topic of CONTEXTUAL_HELP_TOPIC_IDS) {
        const topicContent = getContextualHelpContent(topic, locale);
        expect(content[topic][locale]).toEqual(topicContent);
        expect(localeMessages[locale].Common.contextualHelp.topics[topic]).toBe(topicContent.title);
        for (const field of ["title", "summary", "purpose", "nextStep", "consequences", "cancelOrRecover"] as const) {
          expect(topicContent[field].trim(), `${locale}.${topic}.${field}`).not.toBe("");
          expect(topicContent[field], `${locale}.${topic}.${field}`).not.toMatch(/[{}]/);
        }
      }
    }
  });

  it.each([
    { locale: "id", messages: idMessages, expectedTitle: "Menyiapkan Brankas Pribadi", openLabel: "Buka panduan" },
    { locale: "en", messages: enMessages, expectedTitle: "Set up your Personal Vault", openLabel: "Open guide" },
  ] as const)(
    "opens and dismisses accessible $locale help without losing workflow state",
    async ({ locale, messages, expectedTitle, openLabel }) => {
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);

      function Workflow() {
        const [draft, setDraft] = useState("synthetic draft");
        return createElement(
          TestIntlProvider,
          { locale, messages },
          createElement(
            "div",
            null,
            createElement("input", {
              "aria-label": "Workflow draft",
              value: draft,
              onChange: (event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
            }),
            createElement(ContextualHelpButton, { topic: "personalVaultSetup" }),
          ),
        );
      }

      await act(async () => root?.render(createElement(Workflow)));
      await import("@/shared/presentation/contextual-help-dialog");
      const trigger = container.querySelector<HTMLButtonElement>("button[aria-label]");
      expect(trigger?.getAttribute("aria-label")).toBe(`${openLabel}: ${expectedTitle}`);
      expect(trigger?.getAttribute("title")).toBe(`${openLabel}: ${expectedTitle}`);
      expect(trigger?.getAttribute("aria-haspopup")).toBe("dialog");
      expect(trigger?.getAttribute("aria-expanded")).toBe("false");
      expect(trigger?.className).toContain("size-12");
      expect(trigger?.tabIndex).toBe(0);

      await act(async () => {
        trigger?.focus();
        trigger?.click();
        await Promise.resolve();
      });
      const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]');
      expect(dialog).not.toBeNull();
      expect(trigger?.getAttribute("aria-expanded")).toBe("true");
      expect(dialog?.contains(document.activeElement)).toBe(true);
      expect(dialog?.getAttribute("aria-labelledby")).toBeTruthy();
      expect(dialog?.getAttribute("aria-describedby")).toBeTruthy();
      expect(document.getElementById(dialog?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe(expectedTitle);
      expect(document.getElementById(dialog?.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
        getContextualHelpContent("personalVaultSetup", locale).summary,
      );
      expect(
        [...(dialog?.querySelectorAll<HTMLButtonElement>("button[aria-label]") ?? [])].some(
          (button) =>
            button.getAttribute("aria-label") === messages.Common.contextualHelp.close &&
            button.title === messages.Common.contextualHelp.close,
        ),
      ).toBe(true);
      expect(
        [...document.body.querySelectorAll("button")].some(
          (button) => button.textContent === messages.Common.contextualHelp.close,
        ),
      ).toBe(true);

      const closeButton = dialog?.querySelector<HTMLButtonElement>(
        `button[aria-label="${messages.Common.contextualHelp.close}"]`,
      );
      expect(closeButton).not.toBeNull();
      await act(async () => {
        closeButton?.click();
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      });
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      expect(trigger?.getAttribute("aria-expanded")).toBe("false");

      await act(async () => {
        trigger?.click();
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      });
      expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
      await act(async () => {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      });
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      expect(trigger?.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector<HTMLInputElement>('input[aria-label="Workflow draft"]')?.value).toBe(
        "synthetic draft",
      );
    },
  );
});
