import type { MobileClientConfiguration } from "../config";
import { SecureMobileSessionStorage } from "./secure-session-storage";

/** Public session metadata; credential values never leave this infrastructure adapter. */
export type NativeMobileSession = Readonly<{
  accessExpiresAt: number;
  refreshExpiresAt: number;
  user: Readonly<{ email: string }>;
}>;

type StoredSession = NativeMobileSession & { accessToken: string; refreshToken: string };

type MagicLinkResponse = Readonly<{
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  email: string;
}>;

const STORAGE_KEY = "auth-session";
const REQUEST_TIMEOUT_MS = 15_000;

export function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Mobile authentication request timed out.")), milliseconds);
    void promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export class MobilePasswordlessAuthClient {
  private refreshPromise: Promise<StoredSession | null> | null = null;

  public constructor(
    private readonly configuration: MobileClientConfiguration,
    private readonly storage = new SecureMobileSessionStorage(),
  ) {}

  public async getSession(): Promise<NativeMobileSession | null> {
    const stored = await this.readStoredSession();
    return stored ? publicSession(stored) : null;
  }

  public async requestMagicLink(email: string): Promise<boolean> {
    const response = await this.request("/api/auth/magic-link/request", {
      email: email.trim().toLowerCase(),
      client: "mobile",
      returnPath: "/vaults",
    });
    return response.ok;
  }

  public async redeemMagicLink(token: string): Promise<NativeMobileSession> {
    const response = await this.request("/api/auth/magic-link/redeem", { token, client: "mobile" });
    if (!response.ok) throw new Error("Magic-link redemption failed.");
    try {
      return publicSession(await this.saveResponse(await readJson<MagicLinkResponse>(response)));
    } catch (error: unknown) {
      await this.storage.removeItem(STORAGE_KEY);
      throw error;
    }
  }

  public async getAccessToken(): Promise<string | null> {
    const stored = await this.readStoredSession();
    if (!stored) return null;
    if (stored.accessExpiresAt - Date.now() > 60_000) return stored.accessToken;
    const refreshed = await this.refreshStoredSession(stored);
    return refreshed?.accessToken ?? null;
  }

  public async refreshIfNeeded(): Promise<NativeMobileSession | null> {
    const stored = await this.readStoredSession();
    if (!stored) return null;
    if (stored.accessExpiresAt - Date.now() > 60_000) return publicSession(stored);
    const refreshed = await this.refreshStoredSession(stored);
    return refreshed ? publicSession(refreshed) : null;
  }

  public async signOut(): Promise<void> {
    try {
      const accessToken = await this.getAccessToken();
      if (accessToken) {
        await this.request("/api/auth/session/revoke", undefined, {
          Authorization: `Bearer ${accessToken}`,
        });
      }
    } finally {
      await this.storage.removeItem(STORAGE_KEY);
    }
  }

  private async refreshStoredSession(stored: StoredSession): Promise<StoredSession | null> {
    if (this.refreshPromise) return this.refreshPromise;
    const refreshPromise = this.rotateStoredSession(stored);
    this.refreshPromise = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (this.refreshPromise === refreshPromise) this.refreshPromise = null;
    }
  }

  private async rotateStoredSession(stored: StoredSession): Promise<StoredSession | null> {
    const response = await this.request("/api/auth/session/refresh", {
      client: "mobile",
      refreshToken: stored.refreshToken,
    });
    if (!response.ok) {
      await this.storage.removeItem(STORAGE_KEY);
      return null;
    }
    try {
      return await this.saveResponse(await readJson<MagicLinkResponse>(response));
    } catch (error: unknown) {
      await this.storage.removeItem(STORAGE_KEY);
      throw error;
    }
  }

  private async saveResponse(response: MagicLinkResponse): Promise<StoredSession> {
    if (
      !isToken(response.accessToken) ||
      !isToken(response.refreshToken) ||
      !isEmail(response.email) ||
      !isDate(response.accessExpiresAt) ||
      !isDate(response.refreshExpiresAt)
    )
      throw new Error("Authentication response is invalid.");
    const session: StoredSession = {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      accessExpiresAt: Date.parse(response.accessExpiresAt),
      refreshExpiresAt: Date.parse(response.refreshExpiresAt),
      user: { email: response.email },
    };
    if (session.accessExpiresAt <= Date.now() || session.refreshExpiresAt <= session.accessExpiresAt)
      throw new Error("Authentication response expiry is invalid.");
    await this.storage.setItem(STORAGE_KEY, JSON.stringify(session));
    return session;
  }

  private async readStoredSession(): Promise<StoredSession | null> {
    const storedValue = await this.storage.getItem(STORAGE_KEY);
    if (!storedValue) return null;
    const session = parseStoredSession(storedValue);
    if (!session) await this.storage.removeItem(STORAGE_KEY);
    return session;
  }

  private async request(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const controller = new AbortController();
    try {
      return await withTimeout(
        fetch(new URL(path, this.configuration.apiUrl), {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: body === undefined ? undefined : JSON.stringify(body),
          cache: "no-store",
          signal: controller.signal,
        }),
        REQUEST_TIMEOUT_MS,
      );
    } catch (error: unknown) {
      controller.abort();
      throw error;
    }
  }
}

function publicSession(stored: StoredSession): NativeMobileSession {
  return {
    accessExpiresAt: stored.accessExpiresAt,
    refreshExpiresAt: stored.refreshExpiresAt,
    user: stored.user,
  };
}

function parseStoredSession(value: string | null): StoredSession | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredSession>;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.refreshToken !== "string" ||
      !isToken(parsed.accessToken) ||
      !isToken(parsed.refreshToken) ||
      typeof parsed.accessExpiresAt !== "number" ||
      !Number.isFinite(parsed.accessExpiresAt) ||
      typeof parsed.refreshExpiresAt !== "number" ||
      !Number.isFinite(parsed.refreshExpiresAt) ||
      !parsed.user ||
      typeof parsed.user.email !== "string" ||
      !isEmail(parsed.user.email) ||
      parsed.accessExpiresAt <= Date.now() - 86_400_000 ||
      parsed.refreshExpiresAt <= Date.now() ||
      parsed.refreshExpiresAt <= parsed.accessExpiresAt
    )
      return null;
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function isToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}\.[A-Za-z0-9_-]{43,128}$/.test(value);
}

function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}
