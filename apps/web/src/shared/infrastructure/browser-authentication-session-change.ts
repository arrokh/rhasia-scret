const BROWSER_AUTHENTICATION_SESSION_CHANGE_EVENT = "rhasia-scret:session-change";
const REMOTE_AUTHENTICATION_SESSION_CHANGE_EVENT = "rhasia-scret:remote-session-change";
const SESSION_CHANGE_CHANNEL_NAME = "rhasia-scret:vault-session-change";
const SESSION_CHANGE_STORAGE_KEY = "rhasia-scret:session-change";
const SESSION_CHANGE_MESSAGE_TYPE = "session-changed";
const MAX_REMEMBERED_REMOTE_CHANGES = 64;

let sessionChangeChannel: BroadcastChannel | undefined;
let channelListenerAttached = false;
let storageListenerAttached = false;
let sessionChangeSequence = 0;
const recentRemoteChangeIds = new Set<string>();

export function announceBrowserAuthenticationSessionChange(): void {
  window.dispatchEvent(new Event(BROWSER_AUTHENTICATION_SESSION_CHANGE_EVENT));
}

export function subscribeToBrowserAuthenticationSessionChange(listener: () => void): () => void {
  window.addEventListener(BROWSER_AUTHENTICATION_SESSION_CHANGE_EVENT, listener);
  return () => window.removeEventListener(BROWSER_AUTHENTICATION_SESSION_CHANGE_EVENT, listener);
}

export function subscribeToRemoteBrowserAuthenticationSessionChange(listener: () => void): () => void {
  window.addEventListener(REMOTE_AUTHENTICATION_SESSION_CHANGE_EVENT, listener);
  return () => window.removeEventListener(REMOTE_AUTHENTICATION_SESSION_CHANGE_EVENT, listener);
}

export function initializeBrowserAuthenticationSessionChangeBridge(): void {
  if (typeof window === "undefined") return;
  if (!storageListenerAttached) {
    window.addEventListener("storage", onSessionChangeStorage);
    storageListenerAttached = true;
  }
  if (channelListenerAttached) return;
  const channel = getSessionChangeChannel();
  if (!channel) return;
  try {
    channel.addEventListener("message", onSessionChangeMessage);
    channelListenerAttached = true;
  } catch {
    // Storage events remain available when BroadcastChannel cannot be attached.
  }
}

export function publishBrowserAuthenticationSessionChange(): void {
  if (typeof window === "undefined") return;
  initializeBrowserAuthenticationSessionChangeBridge();
  const changeId = createSessionChangeId();
  const channel = getSessionChangeChannel();
  try {
    channel?.postMessage({ type: SESSION_CHANGE_MESSAGE_TYPE, changeId });
  } catch {
    // The storage event is also sent below as a cross-tab fallback.
  }
  try {
    window.localStorage.setItem(SESSION_CHANGE_STORAGE_KEY, changeId);
    window.localStorage.removeItem(SESSION_CHANGE_STORAGE_KEY);
  } catch {
    // BroadcastChannel remains available when local storage is blocked.
  }
}

function getSessionChangeChannel(): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === "undefined") return undefined;
  try {
    sessionChangeChannel ??= new BroadcastChannel(SESSION_CHANGE_CHANNEL_NAME);
    return sessionChangeChannel;
  } catch {
    return undefined;
  }
}

function onSessionChangeMessage(event: MessageEvent<unknown>): void {
  if (!isSessionChangeMessage(event.data)) return;
  announceRemoteSessionChange(event.data.changeId);
}

function onSessionChangeStorage(event: StorageEvent): void {
  if (event.key !== SESSION_CHANGE_STORAGE_KEY || !isSessionChangeId(event.newValue)) return;
  announceRemoteSessionChange(event.newValue);
}

function announceRemoteSessionChange(changeId: string): void {
  if (recentRemoteChangeIds.has(changeId)) return;
  recentRemoteChangeIds.add(changeId);
  if (recentRemoteChangeIds.size > MAX_REMEMBERED_REMOTE_CHANGES) {
    const oldest = recentRemoteChangeIds.values().next().value;
    if (oldest) recentRemoteChangeIds.delete(oldest);
  }
  window.dispatchEvent(new Event(BROWSER_AUTHENTICATION_SESSION_CHANGE_EVENT));
  window.dispatchEvent(new Event(REMOTE_AUTHENTICATION_SESSION_CHANGE_EVENT));
}

function createSessionChangeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  sessionChangeSequence += 1;
  return `${Date.now().toString(36)}-${sessionChangeSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isSessionChangeMessage(value: unknown): value is { type: string; changeId: string } {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === SESSION_CHANGE_MESSAGE_TYPE &&
    isSessionChangeId((value as { changeId?: unknown }).changeId)
  );
}

function isSessionChangeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9-]{1,128}$/.test(value);
}
