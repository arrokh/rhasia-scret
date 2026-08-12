import type { AuthenticatedTransport, BearerTokenProvider, PlatformHttpRequest, PlatformHttpResponse } from "../application/platform-ports";

/**
 * Authentication adapter for future native clients. It only adds an opaque
 * access token to transport headers; it never enters application state or logs.
 */
export class BearerTokenTransport implements AuthenticatedTransport {
  public constructor(
    private readonly delegate: AuthenticatedTransport,
    private readonly tokenProvider: BearerTokenProvider
  ) {}

  async request(request: PlatformHttpRequest): Promise<PlatformHttpResponse> {
    const token = await this.tokenProvider.getToken();
    const headers = Object.fromEntries(Object.entries(request.headers ?? {}).filter(([name]) => name.toLowerCase() !== "authorization"));
    if (token) headers.authorization = `Bearer ${token}`;
    return this.delegate.request({ ...request, headers });
  }
}
