import { createRequire } from "node:module";
import type { RequestListener } from "node:http";

const require = createRequire(import.meta.url);
const handler = require("../dist/vercel.js") as RequestListener;

export default handler;
