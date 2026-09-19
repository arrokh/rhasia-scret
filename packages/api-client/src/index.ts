import { apiErrorSchema, apiPath } from "@rhasia-scret/api-contract";

export type ApiClientOptions = Readonly<{
  origin: string;
  fetch?: typeof fetch;
  headers?: HeadersInit;
  timeoutMs?: number;
}>;

export class ApiClientError extends Error {
  public constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** A direct HTTP adapter. It does not retain credentials, response data, or decrypted content. */
export class ApiClient {
  private readonly send: typeof fetch;
  private readonly origin: URL;
  private readonly baseHeaders: Headers;
  private readonly timeoutMs: number;

  public constructor(options: ApiClientOptions) {
    this.origin = requireHttpsOrigin(options.origin);
    this.send = options.fetch ?? fetch;
    this.baseHeaders = new Headers(options.headers);
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  public request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(apiPath(path), this.origin);
    const headers = new Headers(this.baseHeaders);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const signal = combineSignals(init.signal, controller.signal);
    return this.send(url, { ...init, headers, signal }).finally(() => clearTimeout(timeout));
  }

  public async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, init);
    if (!response.ok) throw await toApiClientError(response);
    return (await response.json()) as T;
  }
}

function requireHttpsOrigin(value: string): URL {
  const origin = new URL(value);
  const localHttp = origin.protocol === "http:" && (origin.hostname === "localhost" || origin.hostname === "127.0.0.1");
  if (
    (!localHttp && origin.protocol !== "https:") ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    throw new Error("API origin must be an absolute HTTPS origin.");
  return origin;
}

function combineSignals(first: AbortSignal | null | undefined, second: AbortSignal): AbortSignal {
  if (!first) return second;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([first, second]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (first.aborted || second.aborted) abort();
  first.addEventListener("abort", abort, { once: true });
  second.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

async function toApiClientError(response: Response): Promise<ApiClientError> {
  let code: string | undefined;
  try {
    const parsed = apiErrorSchema.safeParse(await response.clone().json());
    if (parsed.success) code = parsed.data.error;
  } catch {
    // Empty/non-JSON failures keep the status without exposing upstream details.
  }
  return new ApiClientError("API request failed.", response.status, code);
}
