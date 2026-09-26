/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserMedia: vi.fn(),
  stopTrack: vi.fn(),
  decodeQr: vi.fn(),
  canvasWidth: 640,
  canvasHeight: 480,
  canvasData: new Uint8ClampedArray([0, 0, 0, 255]),
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
    mocks.getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: mocks.stopTrack }] } as unknown as MediaStream);
    mocks.decodeQr.mockReturnValue({ data: "otpauth://totp/Example" });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: mocks.getUserMedia },
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:qr"), revokeObjectURL: vi.fn() });

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillStyle: "",
      getImageData: vi.fn(() => ({ data: mocks.canvasData, width: mocks.canvasWidth, height: mocks.canvasHeight })),
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
            },
          },
        });
      }
      return element;
    }) as typeof document.createElement);
  });

  it("decodes uploaded image pixels with the client QR decoder", async () => {
    const file = new File(["qr"], "account.png");
    Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(0) });

    await expect(decodeQrImage(file)).resolves.toBe("otpauth://totp/Example");
    expect(mocks.decodeQr).toHaveBeenCalledWith(expect.any(Uint8ClampedArray), 640, 480, {
      inversionAttempts: "attemptBoth",
    });
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
    expect(mocks.decodeQr).toHaveBeenCalledWith(expect.any(Uint8ClampedArray), 800, 600, {
      inversionAttempts: "attemptBoth",
    });
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
    expect(mocks.decodeQr).toHaveBeenNthCalledWith(2, expect.any(Uint8ClampedArray), 38, 38, {
      inversionAttempts: "attemptBoth",
    });
  });

  it("keeps scanning transiently undecodable camera frames and stops tracks after a match", async () => {
    const onValue = vi.fn();
    const video = document.createElement("video");
    Object.defineProperties(video, {
      readyState: { configurable: true, value: HTMLMediaElement.HAVE_CURRENT_DATA },
      videoWidth: { configurable: true, value: 640 },
      videoHeight: { configurable: true, value: 480 },
      srcObject: { configurable: true, writable: true, value: null },
    });
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancelFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    mocks.decodeQr
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValue({ data: "otpauth://totp/Example" });

    const controls = await scanQrCamera(video, onValue);

    expect(mocks.getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
    expect(video.play).toHaveBeenCalledOnce();
    frames[0]?.(0);
    frames[1]?.(500);
    expect(onValue).not.toHaveBeenCalled();
    frames[2]?.(1000);

    expect(onValue).toHaveBeenCalledOnce();
    expect(onValue).toHaveBeenCalledWith("otpauth://totp/Example");
    expect(mocks.decodeQr).toHaveBeenCalledTimes(3);
    expect(mocks.stopTrack).toHaveBeenCalledOnce();
    expect(cancelFrame).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();

    controls.stop();
    expect(mocks.stopTrack).toHaveBeenCalledOnce();
  });
});
