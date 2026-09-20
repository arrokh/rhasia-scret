import type { ApiBindings, ApiEmailSenders } from "@api/types";
import type { ApiRequest } from "@api/http/api-request";
import type { ApiApplicationRuntime } from "@api/modules/server-composition/runtime";
import type { IdentityRuntime } from "@api/modules/identity";

export type ApiRequestContext = Readonly<{
  applicationRuntime: ApiApplicationRuntime;
  identity: IdentityRuntime;
  bindings: ApiBindings;
  emailSenders: ApiEmailSenders;
}>;

const contextKey = Symbol("rhasia.api.request-context");

export function attachApiRequestContext(request: ApiRequest, context: ApiRequestContext): void {
  Object.defineProperty(request, contextKey, { value: context });
}

export function getApiRequestContext(request: Request): ApiRequestContext {
  const context = (request as ApiRequest & { [contextKey]?: ApiRequestContext })[contextKey];
  if (!context) throw new Error("API request context is unavailable.");
  return context;
}
