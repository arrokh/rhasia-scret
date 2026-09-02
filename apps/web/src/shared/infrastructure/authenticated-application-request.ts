import type { ApplicationUser, SessionAssurance } from "@/modules/identity";
import type { ApplicationRateLimitPolicyId } from "@/modules/rate-limiting";
import { executeAuthenticatedApplicationRequest } from "@/modules/server-composition/server";
import { authenticatedApplicationFailureResponse } from "./authenticated-application-response";
import type { NextResponse } from "next/server";

export async function authenticateApplicationReader(
  assurance: SessionAssurance
): Promise<ApplicationUser | NextResponse> {
  const result = await executeAuthenticatedApplicationRequest({ assurance, access: "reader" });
  return result.status === "allowed" ? result.user : authenticatedApplicationFailureResponse(result);
}

export async function authenticateApplicationMutation(
  operation: ApplicationRateLimitPolicyId,
  assurance: SessionAssurance
): Promise<ApplicationUser | NextResponse> {
  const result = await executeAuthenticatedApplicationRequest({ assurance, access: "mutation", operation });
  return result.status === "allowed" ? result.user : authenticatedApplicationFailureResponse(result);
}
