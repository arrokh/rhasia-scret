import { Buffer } from "node:buffer";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { loadApplicationUser } from "@/modules/identity/application/load-application-user";
import { createApplicationUserRepository, createSessionVerifier } from "@/modules/identity/server";
import { rateLimitApplicationUser } from "@/modules/rate-limiting";
import { PrismaVaultKeyRotationRepository } from "@/modules/vault-management/infrastructure/prisma-vault-key-rotation-repository";

const ciphertext = z.base64().refine((value) => Buffer.byteLength(value, "base64") >= 13);
const rotationSchema = z.object({ encryptedName: ciphertext, encryptionVersion: z.literal(1), keyVersion: z.number().int().positive(), accounts: z.array(z.object({ id: z.string().min(1), encryptedPayload: ciphertext })), memberPackages: z.array(z.object({ userId: z.string().min(1), encryptedVaultKey: ciphertext })) });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ vaultId: string }> }) {
  const user = await loadApplicationUser(createSessionVerifier(), createApplicationUserRepository());
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!user.canAccessApplication()) return NextResponse.json({ error: "inactive_user" }, { status: 403 });
  const rateLimited = await rateLimitApplicationUser("key_material_mutation", user.id);
  if (rateLimited) return rateLimited;
  const parsed = rotationSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_rotation" }, { status: 400 });
  const { vaultId } = await params;
  const data = parsed.data;
  const rotated = await new PrismaVaultKeyRotationRepository().rotate(user.id, vaultId, { encryptedName: Buffer.from(data.encryptedName, "base64"), encryptionVersion: data.encryptionVersion, keyVersion: data.keyVersion, accounts: data.accounts.map((account) => ({ id: account.id, encryptedPayload: Buffer.from(account.encryptedPayload, "base64") })), memberPackages: data.memberPackages.map((member) => ({ userId: member.userId, encryptedVaultKey: Buffer.from(member.encryptedVaultKey, "base64") })) });
  return rotated ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "rotation_rejected" }, { status: 409 });
}
