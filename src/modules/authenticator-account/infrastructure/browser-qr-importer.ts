"use client";

import type { IScannerControls } from "@zxing/browser";

export async function decodeQrImage(file: File): Promise<string> {
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
