/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  client: {},
  requestInvitedSignInLink: vi.fn()
}));

vi.mock("@/modules/identity/presentation/browser-supabase-client", () => ({ createBrowserSupabaseClient: () => mocks.client }));
vi.mock("@/modules/identity/presentation/request-invited-sign-in-link", () => ({ requestInvitedSignInLink: mocks.requestInvitedSignInLink }));

import { InvitedUserSignInForm } from "@/modules/identity/presentation/invited-user-sign-in-form";

describe("InvitedUserSignInForm", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    vi.clearAllMocks();
  });

  it("renders accessible TanStack validation warnings and blocks invalid submissions", async () => {
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () => root?.render(createElement(InvitedUserSignInForm)));

    const form = container.querySelector<HTMLFormElement>("form");
    await act(async () => form?.requestSubmit());

    const input = container.querySelector<HTMLInputElement>("#email");
    const alert = container.querySelector<HTMLElement>('[role="alert"]');
    expect(form?.noValidate).toBe(true);
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    expect(input?.getAttribute("aria-describedby")).toBe("email-error");
    expect(alert?.textContent).toBe("Alamat email wajib diisi.");
    expect(mocks.requestInvitedSignInLink).not.toHaveBeenCalled();

    await act(async () => setInputValue(input, "not-an-email"));
    await act(async () => form?.requestSubmit());

    expect(container.querySelector<HTMLElement>('[role="alert"]')?.textContent).toBe("Masukkan alamat email yang valid.");
    expect(mocks.requestInvitedSignInLink).not.toHaveBeenCalled();
  });
});

function setInputValue(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error("Expected email input.");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
