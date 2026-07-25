export function hasClockDrift(localTime: Date, serverTime: Date, thresholdSeconds = 30): boolean {
  if (!Number.isFinite(localTime.getTime()) || !Number.isFinite(serverTime.getTime())) {
    throw new Error("Valid local and server times are required.");
  }
  return Math.abs(localTime.getTime() - serverTime.getTime()) > thresholdSeconds * 1_000;
}
