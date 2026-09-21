import type { RequestListener } from "node:http";

type VercelBundle = { default: RequestListener };

export function createBundleHandler(bundleSpecifier: string): RequestListener {
  let handlerPromise: Promise<RequestListener> | undefined;

  async function loadHandler(): Promise<RequestListener> {
    const bundle = (await import(bundleSpecifier)) as VercelBundle;
    return bundle.default;
  }

  return async function handler(...args: Parameters<RequestListener>): Promise<void> {
    const resolvedHandler = await (handlerPromise ??= loadHandler());
    resolvedHandler(...args);
  };
}
