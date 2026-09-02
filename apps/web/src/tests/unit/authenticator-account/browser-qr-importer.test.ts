/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decodeFromVideoDevice: vi.fn(),
  decodeQr: vi.fn(),
  canvasWidth: 640,
  canvasHeight: 480,
  canvasData: new Uint8ClampedArray([0, 0, 0, 255])
}));

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    public decodeFromVideoDevice = mocks.decodeFromVideoDevice;
  }
}));

vi.mock("jsqr", () => ({ default: mocks.decodeQr }));

import { decodeQrImage, scanQrCamera } from "@/modules/authenticator-account/infrastructure/browser-qr-importer";

describe("browser QR importer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canvasWidth = 640;
    mocks.canvasHeight = 480;
    mocks.canvasData = new Uint8ClampedArray([0, 0, 0, 255]);
    mocks.decodeFromVideoDevice.mockResolvedValue({ stop: vi.fn() });
    mocks.decodeQr.mockReturnValue({ data: "otpauth://totp/Example" });
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:qr"), revokeObjectURL: vi.fn() });

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillStyle: "",
      getImageData: vi.fn(() => ({ data: mocks.canvasData, width: mocks.canvasWidth, height: mocks.canvasHeight }))
    } as unknown as CanvasRenderingContext2D);
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === "img") {
        Object.defineProperties(element, {
          naturalWidth: { configurable: true, value: 640 },
          naturalHeight: { configurable: true, value: 480 },
          src: {
            configurable: true,
            get: () => element.getAttribute("src") ?? "",
            set: (value: string) => {
              element.setAttribute("src", value);
              queueMicrotask(() => element.dispatchEvent(new Event("load")));
            }
          }
        });
      }
      return element;
    }) as typeof document.createElement);
  });

  it("decodes uploaded image pixels with the client QR decoder", async () => {
    const file = new File(["qr"], "account.png");
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(0) });

    await expect(decodeQrImage(file)).resolves.toBe("otpauth://totp/Example");
    expect(mocks.decodeQr).toHaveBeenCalledWith(expect.any(Uint8ClampedArray), 640, 480, { inversionAttempts: "attemptBoth" });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:qr");
  });

  it("uses direct browser bitmap decoding when available", async () => {
    const close = vi.fn();
    const createImageBitmap = vi.fn(async () => ({ width: 800, height: 600, close }));
    vi.stubGlobal("createImageBitmap", createImageBitmap);
    mocks.canvasWidth = 800;
    mocks.canvasHeight = 600;
    const file = new File(["qr"], "account.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(0) });

    await expect(decodeQrImage(file)).resolves.toBe("otpauth://totp/Example");
    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob));
    expect(mocks.decodeQr).toHaveBeenCalledWith(expect.any(Uint8ClampedArray), 800, 600, { inversionAttempts: "attemptBoth" });
    expect(close).toHaveBeenCalledOnce();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("retries with a padded dark-content crop when the full image is not decodable", async () => {
    const width = 100;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);
    data.fill(255);
    for (let y = 35; y < 65; y += 1) {
      for (let x = 35; x < 65; x += 1) {
        const index = (y * width + x) * 4;
        data[index] = 0;
        data[index + 1] = 0;
        data[index + 2] = 0;
      }
    }
    mocks.canvasWidth = width;
    mocks.canvasHeight = height;
    mocks.canvasData = data;
    mocks.decodeQr.mockReset();
    mocks.decodeQr.mockReturnValueOnce(null).mockReturnValueOnce({ data: "otpauth://totp/Cropped" });
    const file = new File(["qr"], "account.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(0) });

    await expect(decodeQrImage(file)).resolves.toBe("otpauth://totp/Cropped");
    expect(mocks.decodeQr).toHaveBeenNthCalledWith(2, expect.any(Uint8ClampedArray), 38, 38, { inversionAttempts: "attemptBoth" });
  });

  it("keeps scanning after transient undecodable camera frames", async () => {
    const onValue = vi.fn();
    const video = document.createElement("video");

    await scanQrCamera(video, onValue);
    const callback = mocks.decodeFromVideoDevice.mock.calls[0]?.[2] as (
      result: { getText(): string } | undefined,
      error: Error | undefined
    ) => void;

    for (const name of ["NotFoundException", "ChecksumException", "FormatException"]) {
      const error = new Error("Frame does not contain a decodable QR code.");
      error.name = name;
      callback(undefined, error);
    }
    callback({ getText: () => "otpauth://totp/Example" }, undefined);

    expect(onValue).toHaveBeenCalledOnce();
    expect(onValue).toHaveBeenCalledWith("otpauth://totp/Example");
  });
});
