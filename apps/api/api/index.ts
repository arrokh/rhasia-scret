import "@prisma/adapter-pg";
import "@prisma/client";
import "dotenv";
import "nodemailer";
import "pg";
import { createBundleHandler } from "./load-bundle.js";

// Keep dynamically loaded runtime dependencies in Vercel's static function trace.
export default createBundleHandler("../dist/vercel.js");
