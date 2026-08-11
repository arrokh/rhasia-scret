import type { PlatformFile } from "@/shared/application/platform-ports";

export interface QrImportPort {
  decodeImage(file: PlatformFile): Promise<string>;
}
