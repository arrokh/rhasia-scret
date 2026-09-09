"use client";

import type {
  ApplicationLifecyclePort,
  ClipboardPort,
  DownloadPort,
  NetworkStatusPort,
  PlatformFile,
  PlatformFilePickerPort,
  PortDisposer,
} from "@rhasia-scret/client-vault-core";

export class BrowserNetworkStatus implements NetworkStatusPort {
  isOnline(): boolean {
    return typeof navigator === "undefined" ? true : navigator.onLine;
  }

  subscribe(listener: (online: boolean) => void): PortDisposer {
    const update = () => listener(this.isOnline());
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }
}

export class BrowserApplicationLifecycle implements ApplicationLifecyclePort {
  isVisible(): boolean {
    return document.visibilityState === "visible";
  }

  subscribeVisibility(listener: (visible: boolean) => void): PortDisposer {
    const update = () => listener(this.isVisible());
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }
}

export class BrowserClipboard implements ClipboardPort {
  writeText(value: string): Promise<void> {
    return navigator.clipboard.writeText(value);
  }
}

export class BrowserDownload implements DownloadPort {
  download(request: { bytes: Uint8Array; filename: string; mediaType: string }): void {
    const blob = new Blob([request.bytes.slice()], { type: request.mediaType });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = request.filename;
      anchor.rel = "noopener";
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export class BrowserFilePicker implements PlatformFilePickerPort {
  async pickFile(accept: readonly string[]): Promise<PlatformFile | null> {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept.join(",");
    return new Promise((resolve) => {
      let settled = false;
      const finish = (file: File | null) => {
        if (settled) return;
        settled = true;
        resolve(file ? browserFile(file) : null);
      };
      input.addEventListener("change", () => finish(input.files?.[0] ?? null), { once: true });
      input.addEventListener("cancel", () => finish(null), { once: true });
      input.click();
    });
  }
}

function browserFile(file: File): PlatformFile {
  return {
    name: file.name,
    mediaType: file.type,
    size: file.size,
    readBytes: async () => new Uint8Array(await file.arrayBuffer()),
  };
}

export const browserNetworkStatus = new BrowserNetworkStatus();
export const browserApplicationLifecycle = new BrowserApplicationLifecycle();
export const browserClipboard = new BrowserClipboard();
export const browserDownload = new BrowserDownload();
