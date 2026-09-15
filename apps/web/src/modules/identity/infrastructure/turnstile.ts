export type TurnstileValidationResult = "valid" | "invalid" | "unavailable";

type TurnstileResponse = Readonly<{ success: boolean }>;

type TurnstileFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2_048;

export class CloudflareTurnstileValidator {
  public constructor(
    private readonly secretKey: string,
    private readonly fetcher: TurnstileFetch = (input, init) => globalThis["fetch"](input, init),
  ) {}

  public async validate(token: string): Promise<TurnstileValidationResult> {
    try {
      const response = await this.fetcher(TURNSTILE_VERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret: this.secretKey, response: token }).toString(),
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) return "unavailable";
      const payload: unknown = await response.json();
      return isTurnstileResponse(payload) && payload.success ? "valid" : "invalid";
    } catch {
      return "unavailable";
    }
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
