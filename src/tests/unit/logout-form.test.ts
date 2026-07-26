/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn(() => new Promise<string>(() => undefined)) }));
vi.mock("@/modules/identity/presentation/hooks/use-session-mutations", () => ({
  useTerminateSessionMutation: () => ({ mutateAsync: mocks.mutateAsync, isPending: false })
}));

import { LogoutForm } from "@/modules/identity/presentation/logout-form";

describe("LogoutForm", () => {
  let root: Root | undefined;
  afterEach(async () => {
    mocks.mutateAsync.mockClear();
    await act(async () => root?.unmount());
  });

  it("requires confirmation before terminating the authenticated and unlocked sessions", async () => {
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(LogoutForm, { email: "person@example.test" })));

    expect(container.querySelector(".account-menu-trigger")?.getAttribute("aria-label")).toBe("Pengaturan akun");
    expect(container.textContent).toContain("person@example.test");
    await act(async () => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Keluar dari aplikasi?");

    const confirm = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Keluar" && button.closest("dialog"));
    await act(async () => confirm?.click());
    expect(mocks.mutateAsync).toHaveBeenCalledOnce();
  });
});
