import type { RequestListener } from "node:http";

type VercelBundle = { default: RequestListener };

let handlerPromise: Promise<RequestListener> | undefined;

async function loadHandler(): Promise<RequestListener> {
  const bundleSpecifier = "../dist/vercel.js";
  const bundle = (await import(bundleSpecifier)) as VercelBundle;
  return bundle.default;
}

export default async function handler(...args: Parameters<RequestListener>): Promise<void> {
  const resolvedHandler = await (handlerPromise ??= loadHandler());
  resolvedHandler(...args);
}
