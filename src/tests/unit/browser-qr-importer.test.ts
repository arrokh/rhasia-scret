/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decodeFromVideoDevice: vi.fn(),
  decodeFromImageUrl: vi.fn()
}));

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    public decodeFromVideoDevice = mocks.decodeFromVideoDevice;
    public decodeFromImageUrl = mocks.decodeFromImageUrl;
  }
}));

import { scanQrCamera } from "@/modules/authenticator-account/infrastructure/browser-qr-importer";

describe("browser QR camera importer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decodeFromVideoDevice.mockResolvedValue({ stop: vi.fn() });
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
