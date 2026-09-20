const AUTH_COMPLETION_CHANNEL_NAME = "rhasia-scret:authentication-complete";
const AUTHENTICATED_MESSAGE = "authenticated";
const INVITATION_SECRET_REQUEST_MESSAGE = "invitation-secret-request";
const INVITATION_SECRET_RESPONSE_MESSAGE = "invitation-secret-response";
// Backgrounded browsers can delay BroadcastChannel delivery while the email callback is foregrounded.
const INVITATION_SECRET_REQUEST_TIMEOUT_MS = 15_000;

type AuthCompletionMessage = { type: typeof AUTHENTICATED_MESSAGE };
type InvitationSecretRequestMessage = { type: typeof INVITATION_SECRET_REQUEST_MESSAGE; requestId: string };
type InvitationSecretResponseMessage = {
  type: typeof INVITATION_SECRET_RESPONSE_MESSAGE;
  requestId: string;
  secret: string;
};

export function announceAuthenticationCompletion(): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(AUTH_COMPLETION_CHANNEL_NAME);
  channel.postMessage({ type: AUTHENTICATED_MESSAGE } satisfies AuthCompletionMessage);
  channel.close();
}

export function subscribeToAuthenticationCompletion(
  onComplete: () => void,
  getInvitationSecret?: () => string,
): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(AUTH_COMPLETION_CHANNEL_NAME);
  const onMessage = (event: MessageEvent<unknown>) => {
    if (isAuthCompletionMessage(event.data)) onComplete();
    if (getInvitationSecret && isInvitationSecretRequestMessage(event.data)) {
      const secret = getInvitationSecret();
      if (isSafeInvitationSecret(secret)) {
        channel.postMessage({
          type: INVITATION_SECRET_RESPONSE_MESSAGE,
          requestId: event.data.requestId,
          secret,
        } satisfies InvitationSecretResponseMessage);
      }
    }
  };
  channel.addEventListener("message", onMessage);
  return () => {
    channel.removeEventListener("message", onMessage);
    channel.close();
  };
}

export function requestInvitationSecret(timeoutMs = INVITATION_SECRET_REQUEST_TIMEOUT_MS): Promise<string | null> {
  if (typeof BroadcastChannel === "undefined") return Promise.resolve(null);
  const requestId = crypto.randomUUID();
  const channel = new BroadcastChannel(AUTH_COMPLETION_CHANNEL_NAME);
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => finish(null), timeoutMs);
    const onMessage = (event: MessageEvent<unknown>) => {
      if (isInvitationSecretResponseMessage(event.data) && event.data.requestId === requestId)
        finish(isSafeInvitationSecret(event.data.secret) ? event.data.secret : null);
    };
    function finish(secret: string | null): void {
      window.clearTimeout(timeout);
      channel.removeEventListener("message", onMessage);
      channel.close();
      resolve(secret);
    }
    channel.addEventListener("message", onMessage);
    channel.postMessage({
      type: INVITATION_SECRET_REQUEST_MESSAGE,
      requestId,
    } satisfies InvitationSecretRequestMessage);
  });
}

function isAuthCompletionMessage(value: unknown): value is AuthCompletionMessage {
  return !!value && typeof value === "object" && (value as { type?: unknown }).type === AUTHENTICATED_MESSAGE;
}

function isInvitationSecretRequestMessage(value: unknown): value is InvitationSecretRequestMessage {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === INVITATION_SECRET_REQUEST_MESSAGE &&
    typeof (value as { requestId?: unknown }).requestId === "string"
  );
}

function isSafeInvitationSecret(value: string): boolean {
  return /^[A-Za-z0-9_-]{16,4096}$/.test(value);
}

function isInvitationSecretResponseMessage(value: unknown): value is InvitationSecretResponseMessage {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === INVITATION_SECRET_RESPONSE_MESSAGE &&
    typeof (value as { requestId?: unknown }).requestId === "string" &&
    typeof (value as { secret?: unknown }).secret === "string"
  );
}
