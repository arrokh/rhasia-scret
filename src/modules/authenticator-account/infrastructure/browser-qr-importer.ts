"use client";

import type { QrImportPort } from "../application/qr-import-ports";
import type { PlatformFile } from "@/shared/application/platform-ports";
import type { IScannerControls } from "@zxing/browser";

export class BrowserQrImportPort implements QrImportPort {
  async decodeImage(file: PlatformFile): Promise<string> {
    if (!file.mediaType.startsWith("image/")) throw new Error("A QR image file is required.");
    const bytes = await file.readBytes();
    const blob = new Blob([bytes.slice()], { type: file.mediaType });
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
    const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
    return result.getText();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function scanQrCamera(video: HTMLVideoElement, onValue: (value: string) => void): Promise<IScannerControls> {
  const { BrowserQRCodeReader } = await import("@zxing/browser");
  const reader = new BrowserQRCodeReader();
  return reader.decodeFromVideoDevice(undefined, video, (result) => {
    if (result) onValue(result.getText());
  });
}
