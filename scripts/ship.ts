import "dotenv/config";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ship } from "../src/deploy/ship.js";
import { spawnExec } from "../src/deploy/spawn-exec.js";
import { loadLocalEnv, MissingEnvError } from "../src/shared/env.js";

async function main(): Promise<void> {
  const siteOnly = process.argv.includes("--site-only");
  const env = loadLocalEnv(process.env, siteOnly ? [] : ["workerBaseUrl", "publishNowSecret"]);
  const code = await ship(
    {
      fetch,
      exec: spawnExec,
      log: console.log,
      workerBaseUrl: env.workerBaseUrl,
      publishNowSecret: env.publishNowSecret,
    },
    { siteOnly },
  );
  process.exit(code);
}

try {
  if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
} catch (e) {
  console.error(e instanceof MissingEnvError ? e.message : e instanceof Error ? e.message : String(e));
  process.exit(1);
}
