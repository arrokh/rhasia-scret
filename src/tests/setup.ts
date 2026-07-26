class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in globalThis)) Object.assign(globalThis, { ResizeObserver: TestResizeObserver });

if (typeof HTMLElement !== "undefined") {
  HTMLElement.prototype.scrollIntoView ??= () => undefined;
  HTMLElement.prototype.hasPointerCapture ??= () => false;
  HTMLElement.prototype.setPointerCapture ??= () => undefined;
  HTMLElement.prototype.releasePointerCapture ??= () => undefined;
}

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = () => ({ matches: false, media: "", onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false });
}
