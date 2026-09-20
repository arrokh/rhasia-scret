import { createFactory } from "hono/factory";
import type { ApiEnvironment } from "@api/types";

export const apiFactory = createFactory<ApiEnvironment>();
