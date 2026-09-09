const SENSITIVE_KEY = /(secret|private.?key|vault.?key|root.?key|otp|ciphertext|encrypted)/i;

export function redactSensitiveData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveData);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactSensitiveData(nested),
    ]),
  );
}
