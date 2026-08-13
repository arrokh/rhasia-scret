/** Platform-neutral contracts used by client application workflows. */

export type PortDisposer = () => void;

export interface CancellationPort {
  readonly aborted: boolean;
  subscribe(listener: () => void): PortDisposer;
}

export type PlatformHttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "HEAD" | "OPTIONS";

export type PlatformHttpRequest = {
  url: string;
  method: PlatformHttpMethod;
  headers?: Readonly<Record<string, string>>;
  body?: string | Uint8Array;
  cache?: "default" | "no-store";
  signal?: CancellationPort;
};

export interface PlatformHttpHeaders {
  get(name: string): string | null;
}

export interface PlatformHttpResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly headers: PlatformHttpHeaders;
  json<T>(): Promise<T>;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
}

/**
 * Authenticated transport boundary. Web uses a cookie-session adapter; a native
 * client can wrap the same contract with a bearer-token adapter.
 */
export interface AuthenticatedTransport {
  request(request: PlatformHttpRequest): Promise<PlatformHttpResponse>;
}

export interface BearerTokenProvider {
  getToken(): Promise<string | null>;
}

export interface NetworkStatusPort {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): PortDisposer;
}

export interface ApplicationLifecyclePort {
  isVisible(): boolean;
  subscribeVisibility(listener: (visible: boolean) => void): PortDisposer;
}

export interface ClipboardPort {
  writeText(value: string): Promise<void>;
}

export type DownloadRequest = {
  bytes: Uint8Array;
  filename: string;
  mediaType: string;
};

export interface DownloadPort {
  download(request: DownloadRequest): void;
}

export type PlatformFile = {
  name: string;
  mediaType: string;
  size: number;
  readBytes(): Promise<Uint8Array>;
};

export interface PlatformFilePickerPort {
  pickFile(accept: readonly string[]): Promise<PlatformFile | null>;
}
