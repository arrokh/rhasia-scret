/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mocks = vi.hoisted(() => ({
  generateTotp: vi.fn().mockResolvedValue({ value: "123456", validUntil: new Date(Date.now() + 30_000) }),
  writeText: vi.fn().mockResolvedValue(undefined)
}));
vi.mock("@/modules/otp-runtime/application/generate-totp", () => ({ generateTotp: mocks.generateTotp }));
vi.mock("@/modules/otp-runtime/infrastructure/browser-hmac-generator", () => ({ BrowserHmacGenerator: class BrowserHmacGenerator {} }));

import { TotpAccountButton } from "@/modules/otp-runtime/presentation/totp-account-button";

describe("TotpAccountButton", () => {
  let root: Root | undefined;
  afterEach(async () => {
    await act(async () => root?.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("generates an OTP locally and copies it from the clickable account row", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: mocks.writeText } });
    const container = document.createElement("div");
    root = createRoot(container);

    await act(async () => root?.render(createElement(TotpAccountButton, {
      configuration: { issuer: "OTPAuth", accountName: "Alice", secret: Uint8Array.of(1), algorithm: "SHA-1", digits: 6, period: 30 },
      vaultName: "Brankas Pribadi"
    })));

    expect(container.textContent).toContain("123 456");
    expect(container.querySelector(".otp-timer svg")).not.toBeNull();
    expect(container.querySelector(".account-copy .vault-badge")?.textContent).toBe("Brankas Pribadi");
    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.getAttribute("aria-label")).toContain("Salin OTP");
    await act(async () => button?.click());
    expect(mocks.writeText).toHaveBeenCalledWith("123456");
    expect(container.textContent).toContain("Disalin");
  });
});
