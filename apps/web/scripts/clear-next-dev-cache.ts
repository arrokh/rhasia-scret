import { rmSync } from "node:fs";
import { resolve } from "node:path";

rmSync(resolve(process.env.NEXT_DIST_DIR?.trim() || ".next/dev"), { recursive: true, force: true });
