"use client";

import type { QrImportPort } from "@rhasia-scret/client-vault-core";
import type { PlatformFile } from "@rhasia-scret/client-vault-core";
import type { IScannerControls } from "@zxing/browser";

const IMAGE_MEDIA_TYPES_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
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
    readBytes: async () => new Uint8Array(await file.arrayBuffer())
  });
}

async function decodeQrImageBlob(file: Blob): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("A QR image file is required.");
  const url = URL.createObjectURL(file);
  try {
    const { BrowserQRCodeReader } = await import("@zxing/browser");
    const image = document.createElement("img");
    const decodeTask = new BrowserQRCodeReader().decodeFromImageElement(image);
    image.src = url;
    const result = await decodeTask;
    return result.getText();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function resolveImageMediaType(file: PlatformFile): string {
  const mediaType = file.mediaType.trim().toLowerCase().split(";", 1)[0] ?? "";
  if (mediaType.startsWith("image/")) return mediaType === "image/jpg" ? "image/jpeg" : mediaType;
  const extension = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  return extension ? IMAGE_MEDIA_TYPES_BY_EXTENSION[extension] ?? "" : "";
}

export async function scanQrCamera(video: HTMLVideoElement, onValue: (value: string) => void): Promise<IScannerControls> {
  const { BrowserQRCodeReader } = await import("@zxing/browser");
  const reader = new BrowserQRCodeReader();
  return reader.decodeFromVideoDevice(undefined, video, (result) => {
    if (result) onValue(result.getText());
  });
}
