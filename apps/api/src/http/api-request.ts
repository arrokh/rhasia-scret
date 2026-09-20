import { RequestCookieStore, ResponseCookieStore } from "@api/http/cookies";

export class ApiRequest extends Request {
  public readonly nextUrl: URL;
  public readonly cookies: RequestCookieStore;

  public constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init);
    this.nextUrl = new URL(this.url);
    this.cookies = new RequestCookieStore(this);
  }
}

export class ApiResponse extends Response {
  public readonly cookies = new ResponseCookieStore();

  public static json(data: unknown, init?: ResponseInit): ApiResponse {
    const headers = new Headers(init?.headers);
    headers.set("content-type", "application/json; charset=UTF-8");
    return new ApiResponse(JSON.stringify(data), { ...init, headers });
  }
}
