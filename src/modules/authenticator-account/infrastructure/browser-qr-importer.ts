"use client";

import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";

export async function decodeQrImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("A QR image file is required.");
  const url = URL.createObjectURL(file);
  try {
    const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
    return result.getText();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function scanQrCamera(video: HTMLVideoElement, onValue: (value: string) => void, onError: (error: Error) => void): Promise<IScannerControls> {
  const reader = new BrowserQRCodeReader();
  return reader.decodeFromVideoDevice(undefined, video, (result, error) => {
    if (result) onValue(result.getText());
    if (error && error.name !== "NotFoundException") onError(error);
  });
}
