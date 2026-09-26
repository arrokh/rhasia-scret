"use client";

import type { QrImportPort } from "@rhasia-scret/client-vault-core";
import type { PlatformFile } from "@rhasia-scret/client-vault-core";
export type QrCameraScannerControls = { stop(): void };

const CAMERA_SCAN_INTERVAL_MS = 500;

const IMAGE_MEDIA_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export class BrowserQrImportPort implements QrImportPort {
  async decodeImage(file: PlatformFile): Promise<string> {
    const mediaType = resolveImageMediaType(file);
    if (!mediaType) throw new Error("A QR image file is required.");
    const bytes = await file.readBytes();
    const blob = new Blob([bytes.slice()], { type: mediaType });
    return decodeQrImageBlob(blob);
  }
}

export const browserQrImportPort = new BrowserQrImportPort();

export function decodeQrImage(file: File): Promise<string> {
  return browserQrImportPort.decodeImage({
    name: file.name,
    mediaType: file.type,
    size: file.size,
    readBytes: async () => new Uint8Array(await file.arrayBuffer()),
  });
}

async function decodeQrImageBlob(file: Blob): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("A QR image file is required.");
  const { default: decodeQr } = await import("jsqr");
  const image = await loadQrImage(file);
  try {
    const result = decodeQrImageSource(decodeQr, image);
    if (!result) throw new Error("The QR code could not be read from that image.");
    return result.data;
  } finally {
    image.release();
  }
}

type LoadedQrImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

type QrDecoder = typeof import("jsqr").default;

function decodeQrImageSource(decodeQr: QrDecoder, image: LoadedQrImage): ReturnType<QrDecoder> {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("QR image decoding is unavailable.");
  return decodeQrCanvasSource(decodeQr, image.source, image.width, image.height, canvas, context);
}

function decodeQrCanvasSource(
  decodeQr: QrDecoder,
  source: CanvasImageSource,
  width: number,
  height: number,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
): ReturnType<QrDecoder> {
  canvas.width = width;
  canvas.height = height;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0);
  const imageData = context.getImageData(0, 0, width, height);
  const result = decodeQr(imageData.data, width, height, { inversionAttempts: "attemptBoth" });
  if (result) return result;

  const cropped = cropToDarkContent(imageData);
  return cropped ? decodeQr(cropped.data, cropped.width, cropped.height, { inversionAttempts: "attemptBoth" }) : null;
}

type RgbaPixels = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

function cropToDarkContent(imageData: RgbaPixels): RgbaPixels | null {
  const bounds = findDarkContentBounds(imageData);
  if (!bounds) return null;
  const padding = Math.max(4, Math.ceil(Math.max(bounds.width, bounds.height) * 0.1));
  const left = Math.max(0, bounds.left - padding);
  const top = Math.max(0, bounds.top - padding);
  const right = Math.min(imageData.width - 1, bounds.right + padding);
  const bottom = Math.min(imageData.height - 1, bounds.bottom + padding);
  const width = right - left + 1;
  const height = bottom - top + 1;
  if (width === imageData.width && height === imageData.height) return null;

  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((top + row) * imageData.width + left) * 4;
    const targetStart = row * width * 4;
    data.set(imageData.data.subarray(sourceStart, sourceStart + width * 4), targetStart);
  }
  return { data, width, height };
}

type DarkContentBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

function findDarkContentBounds(imageData: RgbaPixels): DarkContentBounds | null {
  let left = imageData.width;
  let top = imageData.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < imageData.height; y += 1) {
    for (let x = 0; x < imageData.width; x += 1) {
      const index = (y * imageData.width + x) * 4;
      if (imageData.data[index] >= 200 && imageData.data[index + 1] >= 200 && imageData.data[index + 2] >= 200)
        continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < 0) return null;
  const width = right - left + 1;
  const height = bottom - top + 1;
  const aspectRatio = Math.min(width, height) / Math.max(width, height);
  if (aspectRatio < 0.7) return null;
  return { left, top, right, bottom, width, height };
}

async function loadQrImage(file: Blob): Promise<LoadedQrImage> {
  if (typeof globalThis.createImageBitmap === "function") {
    try {
      const bitmap = await globalThis.createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Fall back to the object URL path for browsers with partial bitmap support.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await loadQrImageElement(url);
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function loadQrImageElement(url: string): Promise<HTMLImageElement> {
  const image = document.createElement("img");
  return new Promise((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The QR image could not be loaded."));
    image.src = url;
  });
}

function resolveImageMediaType(file: PlatformFile): string {
  const mediaType = file.mediaType.trim().toLowerCase().split(";", 1)[0] ?? "";
  if (mediaType.startsWith("image/")) return mediaType === "image/jpg" ? "image/jpeg" : mediaType;
  const extension = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  return extension ? (IMAGE_MEDIA_TYPES_BY_EXTENSION[extension] ?? "") : "";
}

export async function scanQrCamera(
  video: HTMLVideoElement,
  onValue: (value: string) => void,
): Promise<QrCameraScannerControls> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" } },
  });
  video.srcObject = stream;

  const stopStream = () => {
    stream.getTracks().forEach((track) => track.stop());
    if (video.srcObject === stream) video.srcObject = null;
  };

  try {
    await video.play();
    const { default: decodeQr } = await import("jsqr");
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("QR camera scanning is unavailable.");

    let stopped = false;
    let frameId: number | null = null;
    let lastScanAt = -CAMERA_SCAN_INTERVAL_MS;
    const controls: QrCameraScannerControls = {
      stop: () => {
        if (stopped) return;
        stopped = true;
        if (frameId !== null) cancelAnimationFrame(frameId);
        stopStream();
      },
    };
    const scan = (timestamp: number) => {
      if (stopped) return;
      if (
        timestamp - lastScanAt >= CAMERA_SCAN_INTERVAL_MS &&
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        lastScanAt = timestamp;
        const result = decodeQrCanvasSource(decodeQr, video, video.videoWidth, video.videoHeight, canvas, context);
        if (result) {
          controls.stop();
          onValue(result.data);
          return;
        }
      }
      frameId = requestAnimationFrame(scan);
    };
    frameId = requestAnimationFrame(scan);
    return controls;
  } catch (error) {
    stopStream();
    throw error;
  }
}
