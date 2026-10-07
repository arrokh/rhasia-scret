export type TurnstileValidationResult = "valid" | "invalid" | "unavailable";
export type TurnstileUnavailableReason = "transport" | "http_error" | "malformed_response";
export type TurnstileValidationDiagnostics = Readonly<{
  result: TurnstileValidationResult;
  unavailableReason?: TurnstileUnavailableReason;
  responseStatus?: number;
}>;

type TurnstileResponse = Readonly<{
  success: boolean;
  action?: string;
  hostname?: string;
}>;

type TurnstileFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2_048;

export class CloudflareTurnstileValidator {
  private readonly secretKey: string | undefined;

  public constructor(
    secretKey: string | undefined,
    private readonly expectedAction: string,
    private readonly expectedHostname: string | undefined,
    private readonly fetcher: TurnstileFetch = (input, init) => globalThis["fetch"](input, init),
  ) {
    this.secretKey = secretKey?.trim() || undefined;
  }

  public async validate(token?: string): Promise<TurnstileValidationResult> {
    return (await this.validateWithDiagnostics(token)).result;
  }

  public async validateWithDiagnostics(token?: string): Promise<TurnstileValidationDiagnostics> {
    if (!this.secretKey) return { result: "valid" };
    if (!this.expectedHostname || !token || !isSafeTurnstileToken(token)) return { result: "invalid" };

    let response: Response;
    try {
      response = await this.fetcher(TURNSTILE_VERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret: this.secretKey, response: token }).toString(),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      return { result: "unavailable", unavailableReason: "transport" };
    }
    if (!response.ok)
      return { result: "unavailable", unavailableReason: "http_error", responseStatus: response.status };

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { result: "unavailable", unavailableReason: "malformed_response", responseStatus: response.status };
    }
    if (!isTurnstileResponse(payload))
      return { result: "unavailable", unavailableReason: "malformed_response", responseStatus: response.status };
    const valid =
      payload.success && payload.action === this.expectedAction && payload.hostname === this.expectedHostname;
    return { result: valid ? "valid" : "invalid", responseStatus: response.status };
  }
}

export function isSafeTurnstileToken(value: string): boolean {
  return value.length > 0 && value.length <= MAX_TOKEN_LENGTH && !/[\u0000-\u0020\u007f]/.test(value);
}

function isTurnstileResponse(value: unknown): value is TurnstileResponse {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as { success?: unknown }).success === "boolean"
  );
}
