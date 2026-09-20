import { getApiRequestContext } from "@api/http/api-context";
import { Buffer } from "@api/shared/infrastructure/base64";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { z } from "zod";
import { readBoundedRequestBody } from "@api/http/validation";
import { authenticateApplicationMutation } from "@api/shared/infrastructure/authenticated-application-request";
import {
  importEncryptedVaultArchive,
  MAX_IMPORTED_CIPHERTEXT_BYTES,
  MAX_VAULT_ARCHIVE_IMPORT_ACCOUNTS,
  MAX_VAULT_ARCHIVE_IMPORT_REQUEST_BYTES,
  type EncryptedVaultImportRepository,
} from "@api/modules/vault-archive/server";

const encryptedBlob = (maximumBytes: number) =>
  z.base64().refine((value) => {
    const bytes = Buffer.from(value, "base64");
    return bytes.length >= 29 && bytes.length <= maximumBytes && (bytes[0] === 1 || bytes[0] === 2);
  });
const accountSchema = z
  .object({
    id: z.uuid(),
    encryptedPayload: encryptedBlob(MAX_IMPORTED_CIPHERTEXT_BYTES),
    encryptionVersion: z.literal(1),
  })
  .strict();
const existingDestination = z
  .object({
    kind: z.literal("EXISTING"),
    vaultId: z.string().min(1).max(128),
    vaultType: z.enum(["PERSONAL", "SHARED"]),
  })
  .strict();
const newSharedDestination = z
  .object({
    kind: z.literal("NEW_SHARED"),
    vaultId: z.uuid(),
    encryptedName: encryptedBlob(1024),
    encryptedOwnerVaultKey: encryptedBlob(1024),
    encryptionVersion: z.literal(1),
  })
  .strict();
const importSchema = z
  .object({
    destination: z.discriminatedUnion("kind", [existingDestination, newSharedDestination]),
    accounts: z.array(accountSchema).max(MAX_VAULT_ARCHIVE_IMPORT_ACCOUNTS),
  })
  .strict()
  .superRefine(({ accounts }, context) => {
    if (new Set(accounts.map(({ id }) => id)).size !== accounts.length)
      context.addIssue({ code: "custom", message: "Account identifiers must be unique.", path: ["accounts"] });
  });
const contentLengthSchema = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .refine((value) => Number.isSafeInteger(value));

type Dependencies = {
  authenticate: typeof authenticateApplicationMutation;
  imports: EncryptedVaultImportRepository;
};

export function createEncryptedVaultImportHandler({ authenticate, imports }: Dependencies) {
  return async function POST(request: ApiRequest) {
    const user = await authenticate(request, "archive_import", "fresh-provider-user");
    if (user instanceof ApiResponse) return user;
    const parsedContentLength = contentLengthSchema.safeParse(request.headers.get("content-length") ?? "0");
    if (!parsedContentLength.success) return json({ error: "invalid_archive_import" }, 400);
    if (parsedContentLength.data > MAX_VAULT_ARCHIVE_IMPORT_REQUEST_BYTES)
      return json({ error: "archive_import_too_large" }, 413);
    let boundedBody: string | null;
    try {
      boundedBody = await readBoundedRequestBody(request, MAX_VAULT_ARCHIVE_IMPORT_REQUEST_BYTES);
    } catch {
      return json({ error: "invalid_archive_import" }, 400);
    }
    if (boundedBody === null) return json({ error: "archive_import_too_large" }, 413);
    let decoded: unknown;
    try {
      decoded = JSON.parse(boundedBody);
    } catch {
      return json({ error: "invalid_archive_import" }, 400);
    }
    const parsed = importSchema.safeParse(decoded);
    if (!parsed.success) return json({ error: "invalid_archive_import" }, 400);
    const result = await importEncryptedVaultArchive(
      user.id,
      {
        destination:
          parsed.data.destination.kind === "EXISTING"
            ? parsed.data.destination
            : {
                ...parsed.data.destination,
                encryptedName: Buffer.from(parsed.data.destination.encryptedName, "base64"),
                encryptedOwnerVaultKey: Buffer.from(parsed.data.destination.encryptedOwnerVaultKey, "base64"),
              },
        accounts: parsed.data.accounts.map((account) => ({
          ...account,
          encryptedPayload: Buffer.from(account.encryptedPayload, "base64"),
        })),
      },
      imports,
    );
    if (result.status === "DESTINATION_UNAVAILABLE") return json({ error: "destination_unavailable" }, 404);
    if (result.status === "CONFLICT") return json({ error: "archive_import_conflict" }, 409);
    return json(
      {
        vaultId: result.vaultId,
        accountIds: result.accountIds,
        vaultCreated: result.vaultCreated,
        replayed: result.status === "REPLAYED",
      },
      result.status === "IMPORTED" ? 201 : 200,
    );
  };
}

function json(body: Record<string, unknown>, status: number): ApiResponse {
  return ApiResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: ApiRequest) {
  return createEncryptedVaultImportHandler({
    authenticate: authenticateApplicationMutation,
    imports: getApiRequestContext(request).applicationRuntime.encryptedVaultImports(),
  })(request);
}
