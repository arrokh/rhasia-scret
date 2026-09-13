const AUTH_COMPLETION_CHANNEL_NAME = "rhasia-scret:authentication-complete";
const AUTHENTICATED_MESSAGE = "authenticated";

type AuthCompletionMessage = { type: typeof AUTHENTICATED_MESSAGE };

export function announceAuthenticationCompletion(): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(AUTH_COMPLETION_CHANNEL_NAME);
  channel.postMessage({ type: AUTHENTICATED_MESSAGE } satisfies AuthCompletionMessage);
  channel.close();
}

export function subscribeToAuthenticationCompletion(onComplete: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(AUTH_COMPLETION_CHANNEL_NAME);
  const onMessage = (event: MessageEvent<unknown>) => {
    if (isAuthCompletionMessage(event.data)) onComplete();
  };
  channel.addEventListener("message", onMessage);
  return () => {
    channel.removeEventListener("message", onMessage);
    channel.close();
  };
}

function isAuthCompletionMessage(value: unknown): value is AuthCompletionMessage {
  return !!value && typeof value === "object" && (value as { type?: unknown }).type === AUTHENTICATED_MESSAGE;
}
