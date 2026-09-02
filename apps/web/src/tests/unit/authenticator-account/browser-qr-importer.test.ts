/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decodeFromVideoDevice: vi.fn(),
  decodeFromImageUrl: vi.fn(),
  decodeFromImageElement: vi.fn()
}));

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    public decodeFromVideoDevice = mocks.decodeFromVideoDevice;
    public decodeFromImageUrl = mocks.decodeFromImageUrl;
    public decodeFromImageElement = mocks.decodeFromImageElement;
  }
}));

import { decodeQrImage, scanQrCamera } from "@/modules/authenticator-account/infrastructure/browser-qr-importer";

describe("browser QR camera importer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decodeFromVideoDevice.mockResolvedValue({ stop: vi.fn() });
    mocks.decodeFromImageUrl.mockResolvedValue({ getText: () => "otpauth://totp/Example" });
    mocks.decodeFromImageElement.mockImplementation(async (image: HTMLImageElement) => {
      expect(image.getAttribute("src")).toBeNull();
      return { getText: () => "otpauth://totp/Example" };
    });
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:qr"), revokeObjectURL: vi.fn() });
  });

  it("decodes an image when the browser does not provide a MIME type", async () => {
    const file = new File(["qr"], "account.png");
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(0) });

    await expect(decodeQrImage(file)).resolves.toBe("otpauth://totp/Example");
    expect(mocks.decodeFromImageElement).toHaveBeenCalledOnce();
  });

  it("starts decoding before assigning the object URL to the image", async () => {
    const file = new File(["qr"], "account.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(0) });

    await expect(decodeQrImage(file)).resolves.toBe("otpauth://totp/Example");
    expect(mocks.decodeFromImageElement).toHaveBeenCalledOnce();
    expect(mocks.decodeFromImageUrl).not.toHaveBeenCalled();
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
