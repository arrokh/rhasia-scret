import { ApiClient } from "@rhasia-scret/api-client";
import type {
  AuthenticatedTransport,
  BearerTokenProvider,
  PlatformHttpRequest,
  PlatformHttpResponse,
} from "@rhasia-scret/client-vault-core";
import { BearerTokenTransport } from "@rhasia-scret/client-vault-core";
import type { MobilePasswordlessAuthClient } from "./mobile-passwordless-auth-client";

export class NativeHttpTransport implements AuthenticatedTransport {
  private readonly client: ApiClient;

  public constructor(apiUrl: string) {
    this.client = new ApiClient({ origin: apiUrl });
  }

  public async request(request: PlatformHttpRequest): Promise<PlatformHttpResponse> {
    const controller = new AbortController();
    const dispose = request.signal?.subscribe(() => controller.abort());
    if (request.signal?.aborted) controller.abort();
    try {
      const response = await this.client.request(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body as BodyInit | undefined,
        cache: request.cache,
        signal: controller.signal,
      });
      return {
        status: response.status,
        ok: response.ok,
        headers: response.headers,
        json: <Value>() => response.json() as Promise<Value>,
        bytes: async () => new Uint8Array(await response.arrayBuffer()),
        text: () => response.text(),
      };
    } finally {
      dispose?.();
    }
  }
}

export class NativeBearerTokenProvider implements BearerTokenProvider {
  public constructor(private readonly auth: MobilePasswordlessAuthClient) {}

  public getToken(): Promise<string | null> {
    return this.auth.getAccessToken();
  }
}

export function createNativeAuthenticatedTransport(
  apiUrl: string,
  auth: MobilePasswordlessAuthClient,
): AuthenticatedTransport {
  return new BearerTokenTransport(new NativeHttpTransport(apiUrl), new NativeBearerTokenProvider(auth));
}
