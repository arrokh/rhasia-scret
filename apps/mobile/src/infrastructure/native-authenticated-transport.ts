import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AuthenticatedTransport,
  BearerTokenProvider,
  PlatformHttpRequest,
  PlatformHttpResponse,
} from "../../../../src/shared/application/platform-ports";
import { BearerTokenTransport } from "../../../../src/shared/infrastructure/bearer-token-transport";

export class NativeHttpTransport implements AuthenticatedTransport {
  public constructor(private readonly apiUrl: string) {}

  public async request(request: PlatformHttpRequest): Promise<PlatformHttpResponse> {
    const controller = new AbortController();
    const dispose = request.signal?.subscribe(() => controller.abort());
    if (request.signal?.aborted) controller.abort();
    try {
      const response = await fetch(new URL(request.url, this.apiUrl), {
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

export class SupabaseBearerTokenProvider implements BearerTokenProvider {
  public constructor(private readonly supabase: SupabaseClient) {}

  public async getToken(): Promise<string | null> {
    const { data, error } = await this.supabase.auth.getSession();
    if (error) return null;
    return data.session?.access_token ?? null;
  }
}

export function createNativeAuthenticatedTransport(apiUrl: string, supabase: SupabaseClient): AuthenticatedTransport {
  return new BearerTokenTransport(new NativeHttpTransport(apiUrl), new SupabaseBearerTokenProvider(supabase));
}
