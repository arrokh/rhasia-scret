export type CookieOptions = Readonly<{
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
  maxAge?: number;
  path?: string;
  expires?: Date;
}>;

export type CookieValue = Readonly<{ value: string }>;

export class RequestCookieStore {
  private readonly values: Map<string, string>;

  public constructor(request: Request) {
    this.values = parseCookieHeader(request.headers.get("cookie"));
  }

  public get(name: string): CookieValue | undefined {
    const value = this.values.get(name);
    return value === undefined ? undefined : { value };
  }
}

export class ResponseCookieStore {
  private readonly headers: string[] = [];
  private readonly values = new Map<string, string>();

  public get(name: string): CookieValue | undefined {
    const value = this.values.get(name);
    return value === undefined ? undefined : { value };
  }

  public getAll(): readonly string[] {
    return this.headers;
  }

  public set(name: string, value: string, options: CookieOptions = {}): void {
    this.values.set(name, value);
    const attributes = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
    if (options.maxAge !== undefined) attributes.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
    if (options.expires) attributes.push(`Expires=${options.expires.toUTCString()}`);
    if (options.path) attributes.push(`Path=${options.path}`);
    if (options.httpOnly) attributes.push("HttpOnly");
    if (options.secure) attributes.push("Secure");
    if (options.sameSite) attributes.push(`SameSite=${capitalize(options.sameSite)}`);
    this.headers.push(attributes.join("; "));
  }
}

export function appendSetCookies(response: Response, cookies: ResponseCookieStore): Response {
  const headers = new Headers(response.headers);
  for (const cookie of cookies.getAll()) headers.append("set-cookie", cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function parseCookieHeader(value: string | null): Map<string, string> {
  const result = new Map<string, string>();
  if (!value) return result;
  for (const pair of value.split(";")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const raw = pair.slice(separator + 1).trim();
    try {
      result.set(name, decodeURIComponent(raw));
    } catch {
      result.set(name, raw);
    }
  }
  return result;
}

function capitalize(value: string): string {
  return value[0].toUpperCase() + value.slice(1);
}
