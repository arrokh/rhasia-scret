import path from "node:path";
import { pathToFileURL } from "node:url";
import { LoadTestError } from "./load-test/errors.mjs";
import { main } from "./load-test/cli.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    if (error instanceof LoadTestError) {
      console.error(`loadtest: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    console.error("loadtest: unexpected failure; details suppressed to protect run credentials and tokens.");
    process.exitCode = 1;
  });
}
