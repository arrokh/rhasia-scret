import type { Handler, Hono } from "hono";
import type { ApiEnvironment } from "@api/types";
import { ApiResponse, type ApiRequest } from "@api/http/api-request";
import { routeParamsSchema } from "@api/http/validation";
import { appendSetCookies } from "@api/http/cookies";

export type ApiRouteHandler = (
  request: ApiRequest,
  context: { params: Promise<Record<string, string>> },
) => Response | Promise<Response>;

export type LazyApiRouteMethod = "delete" | "get" | "patch" | "post" | "put";
type ApiHandlerExport = "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
type LazyApiRouteLoader = () => Promise<unknown>;

export function registerLazyRoute(
  app: Hono<ApiEnvironment>,
  method: LazyApiRouteMethod,
  path: string,
  load: LazyApiRouteLoader,
): void {
  const handler = adaptLazy(load, handlerExport(method));
  switch (method) {
    case "delete":
      app.delete(path, handler);
      return;
    case "get":
      app.get(path, handler);
      return;
    case "patch":
      app.patch(path, handler);
      return;
    case "post":
      app.post(path, handler);
      return;
    case "put":
      app.put(path, handler);
      return;
  }
}

function adaptLazy(load: LazyApiRouteLoader, method: ApiHandlerExport): Handler<ApiEnvironment> {
  return async (context) => {
    const request = context.get("apiRequest");
    const parsedParams = routeParamsSchema.safeParse(context.req.param());
    if (!parsedParams.success) return ApiResponse.json({ error: "invalid_request" }, { status: 400 });

    const routeModule = await load();
    const handler = readHandler(routeModule, method);
    const response = await handler(request, { params: Promise.resolve(parsedParams.data) });
    return appendCookies(response);
  };
}

function readHandler(routeModule: unknown, method: ApiHandlerExport): ApiRouteHandler {
  if (!routeModule || typeof routeModule !== "object") throw new Error("API route module is unavailable.");
  const candidate = (routeModule as Record<string, unknown>)[method];
  if (typeof candidate !== "function") throw new Error(`API route handler ${method} is unavailable.`);
  return candidate as ApiRouteHandler;
}

function appendCookies(response: Response): Response {
  return response instanceof ApiResponse ? appendSetCookies(response, response.cookies) : response;
}

function handlerExport(method: LazyApiRouteMethod): ApiHandlerExport {
  switch (method) {
    case "delete":
      return "DELETE";
    case "get":
      return "GET";
    case "patch":
      return "PATCH";
    case "post":
      return "POST";
    case "put":
      return "PUT";
  }
}
