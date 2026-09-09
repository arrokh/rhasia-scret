/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(() => new Promise<string>(() => undefined)) }));
vi.mock("@/modules/identity/presentation/hooks/use-session-mutations", () => ({
  useTerminateSessionMutation: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
}));
vi.mock("@/i18n/locale-switcher", () => ({ LocaleSwitcher: () => createElement("span", null, "Bahasa Indonesia") }));
import { LogoutForm } from "@/modules/identity/presentation/logout-form";

describe("LogoutForm", () => {
  let root: Root | undefined;
  afterEach(async () => {
    mocks.mutateAsync.mockClear();
    await act(async () => root?.unmount());
    document.body.innerHTML = "";
  });

  it("uses a shadcn menu and requires confirmation before terminating sessions", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(LogoutForm, { email: "person@example.test" })));
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Pengaturan akun"]');
    expect(trigger?.getAttribute("data-slot")).toBe("dropdown-menu-trigger");
    await act(async () => trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
    expect(document.body.textContent).toContain("person@example.test");
    expect(document.body.textContent).toContain("Bahasa Indonesia");
    await act(async () => document.body.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Keluar dari aplikasi?");
    const dialog = document.body.querySelector('[role="dialog"]');
    const confirm = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.textContent === "Keluar",
    );
    await act(async () => confirm?.click());
    expect(mocks.mutateAsync).toHaveBeenCalledOnce();
  });
});
