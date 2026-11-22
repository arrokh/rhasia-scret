import { requestVaultSessionChange } from "@/modules/sync";

const AUTH_COMPLETION_CHANNEL_NAME = "rhasia-scret:authentication-complete";
const AUTH_COMPLETION_MESSAGE = "authenticated";
const AUTH_COMPLETION_EVENT = "rhasia-scret:authentication-complete";
const AUTH_COMPLETION_STORAGE_KEY = "rhasia-scret:authentication-complete";
const AUTH_COMPLETION_STORAGE_VALUE = "authenticated";

type AuthCompletionMessage = { type: typeof AUTH_COMPLETION_MESSAGE };

export function announceAuthenticationCompletion(): void {
  try {
    requestVaultSessionChange();
  } catch {
    // Notify the source tab even if local session cleanup signaling fails.
  }
  const channel = createAuthenticationChannel();
  let announcedWithChannel = false;
  if (channel) {
    try {
      channel.postMessage({ type: AUTH_COMPLETION_MESSAGE } satisfies AuthCompletionMessage);
      announcedWithChannel = true;
    } catch {
      // Use local and storage events when the channel cannot post.
    }
    closeAuthenticationChannel(channel);
  }
  if (!announcedWithChannel) announceLocalAuthenticationCompletion();
  announceAuthenticationCompletionWithStorageEvent();
}

export function subscribeToAuthenticationCompletion(onComplete: () => void): () => void {
  const onMessage = (event: MessageEvent<unknown>) => {
    if (isAuthCompletionMessage(event.data)) onComplete();
  };
  const onLocalCompletion = () => onComplete();
  const onStorage = (event: StorageEvent) => {
    if (event.key === AUTH_COMPLETION_STORAGE_KEY && event.newValue === AUTH_COMPLETION_STORAGE_VALUE) onComplete();
  };
  const channel = createAuthenticationChannel();
  window.addEventListener(AUTH_COMPLETION_EVENT, onLocalCompletion);
  window.addEventListener("storage", onStorage);
  if (!channel)
    return () => {
      window.removeEventListener(AUTH_COMPLETION_EVENT, onLocalCompletion);
      window.removeEventListener("storage", onStorage);
    };
  try {
    channel.addEventListener("message", onMessage);
  } catch {
    closeAuthenticationChannel(channel);
    return () => {
      window.removeEventListener(AUTH_COMPLETION_EVENT, onLocalCompletion);
      window.removeEventListener("storage", onStorage);
    };
  }
  return () => {
    window.removeEventListener(AUTH_COMPLETION_EVENT, onLocalCompletion);
    window.removeEventListener("storage", onStorage);
    try {
      channel.removeEventListener("message", onMessage);
    } catch {
      // Closing the channel still releases its listener.
    }
    closeAuthenticationChannel(channel);
  };
}

function createAuthenticationChannel(): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === "undefined") return undefined;
  try {
    return new BroadcastChannel(AUTH_COMPLETION_CHANNEL_NAME);
  } catch {
    return undefined;
  }
}

function closeAuthenticationChannel(channel: BroadcastChannel): void {
  try {
    channel.close();
  } catch {
    // A failed transport must not turn a completed sign-in into a page error.
  }
}

function announceLocalAuthenticationCompletion(): void {
  try {
    window.dispatchEvent(new Event(AUTH_COMPLETION_EVENT));
  } catch {
    // The storage fallback can still notify another tab.
  }
}

function announceAuthenticationCompletionWithStorageEvent(): void {
  try {
    window.localStorage.setItem(AUTH_COMPLETION_STORAGE_KEY, AUTH_COMPLETION_STORAGE_VALUE);
    window.localStorage.removeItem(AUTH_COMPLETION_STORAGE_KEY);
  } catch {
    // Session change and local completion were already attempted; no cross-tab transport is available.
  }
}

function isAuthCompletionMessage(value: unknown): value is AuthCompletionMessage {
  return !!value && typeof value === "object" && (value as { type?: unknown }).type === AUTH_COMPLETION_MESSAGE;
}
