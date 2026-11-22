export function consumeBrowserLocationFragment(): string | null {
  if (typeof window === "undefined") return null;
  return consumeBrowserFragment(window.location.hash, removeCurrentFragment);
}

export function clearBrowserLocationFragment(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.location.hash) return true;
  return removeCurrentFragment();
}

export function consumeBrowserFragment(hash: string, removeFromLocation: () => boolean): string | null {
  if (!hash) return "";
  if (!removeFromLocation()) return null;
  return hash.startsWith("#") ? hash.slice(1) : hash;
}

export function tryReplaceBrowserUrlWithoutFragment(
  cleanUrl: string,
  replaceHistory: () => void,
  replaceLocation: (url: string) => void,
): boolean {
  try {
    replaceHistory();
    return true;
  } catch {
    try {
      replaceLocation(cleanUrl);
    } catch {
      // No safe fragment-clearing navigation is available.
    }
    return false;
  }
}

function removeCurrentFragment(): boolean {
  const cleanUrl = `${window.location.pathname}${window.location.search}`;
  return tryReplaceBrowserUrlWithoutFragment(
    cleanUrl,
    () => window.history.replaceState(window.history.state, "", cleanUrl),
    (url) => window.location.replace(url),
  );
}
