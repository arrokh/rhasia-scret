/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryProvider } from "@/shared/presentation/query-provider";

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
    await act(async () => root?.unmount());
    mocks.mutateAsync.mockReset();
    mocks.mutateAsync.mockImplementation(() => new Promise<string>(() => undefined));
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

  it("reports logout failure after a session change remounts the form", async () => {
    let rejectMutation: (() => void) | undefined;
    mocks.mutateAsync.mockImplementation(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectMutation = () => reject(new Error("synthetic logout failure"));
        }),
    );
    window.history.replaceState(null, "", "/vaults");
    const container = document.createElement("div");
    document.body.append(container);
    const navigate = vi.fn();
    root = createRoot(container);

    await act(async () => root?.render(createElement(QueryProvider, null, createElement(LogoutForm, { navigate }))));
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Pengaturan akun"]');
    await act(async () => trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
    await act(async () => document.body.querySelector<HTMLFormElement>("form")?.requestSubmit());
    const dialog = document.body.querySelector('[role="dialog"]');
    const confirm = [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (button) => button.textContent === "Keluar",
    );
    await act(async () => confirm?.click());
    expect(mocks.mutateAsync).toHaveBeenCalledOnce();

    await act(async () => window.dispatchEvent(new Event("rhasia-scret:session-change")));
    if (!rejectMutation) throw new Error("The logout mutation did not expose its rejection.");
    await act(async () => rejectMutation?.());

    expect(navigate).toHaveBeenCalledWith("/sign-in?auth=logout_failed");
  });
});
