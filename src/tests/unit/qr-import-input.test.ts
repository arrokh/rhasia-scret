/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const mocks = vi.hoisted(() => ({
  scanQrCamera: vi.fn(),
  decodeQrImage: vi.fn()
}));

vi.mock("@/modules/authenticator-account/infrastructure/browser-qr-importer", () => ({
  scanQrCamera: mocks.scanQrCamera,
  decodeQrImage: mocks.decodeQrImage
}));

import { QrImportInput } from "@/modules/authenticator-account/presentation/qr-import-input";

describe("QrImportInput camera scanning", () => {
  let root: Root | undefined;

  afterEach(async () => {
    await act(async () => root?.unmount());
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("mounts the camera video only after the modal has been ready for 500 ms", async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    let decode: ((uri: string) => void) | undefined;
    mocks.scanQrCamera.mockImplementation(async (_video: HTMLVideoElement, onValue: (uri: string) => void) => {
      decode = onValue;
      return { stop };
    });
    const onUri = vi.fn();
    const container = mount();
    root = createRoot(container);

    await act(async () => root?.render(createElement(QrImportInput, { onUri })));
    expect(container.querySelector('[data-slot="collapsible"]')?.getAttribute("data-state")).toBe("closed");
    expect(container.querySelector('#manual-authenticator-uri')).toBeNull();
    await act(async () => findButton(container, "Pindai dengan kamera").click());

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    const stopButton = findButton(document.body, "Hentikan kamera");
    expect(stopButton.querySelector(".lucide-camera-off")).not.toBeNull();
    expect(stopButton.parentElement?.className).toContain("justify-center");
    expect(document.body.querySelector("video")).toBeNull();
    expect(mocks.scanQrCamera).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(499));
    expect(document.body.querySelector("video")).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(document.body.querySelector("video")?.parentElement?.className).toContain("relative");
    expect(mocks.scanQrCamera).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();

    await act(async () => decode?.("otpauth://totp/Example"));

    expect(stop).toHaveBeenCalledOnce();
    expect(onUri).toHaveBeenCalledWith("otpauth://totp/Example");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(findButton(container, "Pindai dengan kamera")).toBeDefined();
  });

  it("decodes an uploaded QR image and forwards its URI", async () => {
    const uri = "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example";
    mocks.decodeQrImage.mockResolvedValue(uri);
    const onUri = vi.fn();
    const container = mount();
    root = createRoot(container);

    await act(async () => root?.render(createElement(QrImportInput, { onUri })));
    await openAdvancedOptions(container);
    const input = container.querySelector<HTMLInputElement>('#qr-image');
    const file = new File(["qr"], "account.png", { type: "image/png" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input?.dispatchEvent(new Event("change", { bubbles: true })));

    expect(mocks.decodeQrImage).toHaveBeenCalledWith(file);
    expect(onUri).toHaveBeenCalledWith(uri);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("forwards a manually entered URI", async () => {
    const uri = "otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example";
    const onUri = vi.fn();
    const container = mount();
    root = createRoot(container);

    await act(async () => root?.render(createElement(QrImportInput, { onUri })));
    await openAdvancedOptions(container);
    const input = container.querySelector<HTMLInputElement>('#manual-authenticator-uri');
    await act(async () => {
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, uri);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => findButton(container, "Gunakan URI manual").click());

    expect(onUri).toHaveBeenCalledWith(uri);
  });

  it("does not show camera loading state on the QR image upload action", async () => {
    mocks.scanQrCamera.mockReturnValue(new Promise(() => undefined));
    const container = mount();
    root = createRoot(container);

    await act(async () => root?.render(createElement(QrImportInput, { onUri: vi.fn() })));
    await act(async () => findButton(container, "Pindai dengan kamera").click());
    await openAdvancedOptions(container);

    expect(container.querySelector('label[for="qr-image"]')?.textContent).toContain("Unggah gambar QR");
    expect(container.querySelector('label[for="qr-image"]')?.textContent).not.toContain("Menyiapkan pemindai");
  });

  it("keeps the modal open for Escape and backdrop interactions", async () => {
    const container = mount();
    root = createRoot(container);

    await act(async () => root?.render(createElement(QrImportInput, { onUri: vi.fn() })));
    await act(async () => findButton(container, "Pindai dengan kamera").click());
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("stops the camera when the modal is closed with its button", async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    mocks.scanQrCamera.mockResolvedValue({ stop });
    const container = mount();
    root = createRoot(container);

    await act(async () => root?.render(createElement(QrImportInput, { onUri: vi.fn() })));
    await act(async () => findButton(container, "Pindai dengan kamera").click());
    await act(async () => vi.advanceTimersByTimeAsync(500));
    await act(async () => findButton(document.body, "Hentikan kamera").click());

    expect(stop).toHaveBeenCalledOnce();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("reports a generic camera startup failure", async () => {
    vi.useFakeTimers();
    mocks.scanQrCamera.mockRejectedValue(new Error("Camera unavailable"));
    const container = mount();
    root = createRoot(container);

    await act(async () => root?.render(createElement(QrImportInput, { onUri: vi.fn() })));
    await act(async () => findButton(container, "Pindai dengan kamera").click());
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Kamera tidak dapat dimulai");
  });

  it("explains how to recover when browser camera permission is blocked", async () => {
    vi.useFakeTimers();
    mocks.scanQrCamera.mockRejectedValue(new DOMException("Permission denied", "NotAllowedError"));
    const container = mount();
    root = createRoot(container);

    await act(async () => root?.render(createElement(QrImportInput, { onUri: vi.fn() })));
    await act(async () => findButton(container, "Pindai dengan kamera").click());
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Izin kamera diblokir");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("pengaturan browser");
  });
});

function mount(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  return container;
}

function findButton(container: ParentNode, name: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.includes(name));
  if (!button) throw new Error(`Expected button: ${name}`);
  return button;
}

async function openAdvancedOptions(container: ParentNode): Promise<void> {
  await act(async () => findButton(container, "Opsi lanjutan").click());
}
