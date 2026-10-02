import { BROWSER_HELPER_FAILURE_PHASES } from "./settings.mjs";

export class LoadTestError extends Error {
  constructor(message, failurePhaseDetail = null) {
    super(message);
    this.name = "LoadTestError";
    this.failurePhaseDetail = BROWSER_HELPER_FAILURE_PHASES.has(failurePhaseDetail) ? failurePhaseDetail : null;
  }
}

export function createCancellation(onCancel) {
  const controller = new AbortController();
  const cancel = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    onCancel();
  };
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  return {
    signal: controller.signal,
    dispose: () => {
      process.removeListener("SIGINT", cancel);
      process.removeListener("SIGTERM", cancel);
    },
  };
}

export function assertNotAborted(signal) {
  if (signal.aborted)
    throw new LoadTestError("Load-test operation was cancelled; run-owned resources are being cleaned up.");
}
