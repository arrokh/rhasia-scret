import { getRequestListener } from "@hono/node-server";
import { createVercelSystemResponse } from "@api/runtime/vercel-system";

export default getRequestListener((request) => createVercelSystemResponse(request, "time", process.env));
