export type BrowserPublicEncryptionKey = Readonly<{
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  ext?: boolean;
  key_ops?: string[];
}>;

export function parseBrowserPublicEncryptionKey(value: unknown): BrowserPublicEncryptionKey {
  if (!isRecord(value) || !hasExactKeys(value, ["kty", "crv", "x", "y"], ["ext", "key_ops"])) return invalidPublicKey();
  if (
    value.kty !== "EC" ||
    value.crv !== "P-256" ||
    typeof value.x !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.x) ||
    typeof value.y !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.y) ||
    (value.ext !== undefined && typeof value.ext !== "boolean") ||
    (value.key_ops !== undefined &&
      (!Array.isArray(value.key_ops) ||
        value.key_ops.length > 8 ||
        value.key_ops.some((operation) => typeof operation !== "string")))
  )
    return invalidPublicKey();

  return {
    kty: "EC",
    crv: "P-256",
    x: value.x,
    y: value.y,
    ...(value.ext === undefined ? {} : { ext: value.ext }),
    ...(value.key_ops === undefined ? {} : { key_ops: [...value.key_ops] }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key));
}

function invalidPublicKey(): never {
  throw new Error("The User Encryption public key is invalid.");
}
