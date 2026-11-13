import "dotenv/config";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ship } from "../src/deploy/ship.js";
import { siteShipDeps } from "../src/deploy/site-deps.js";
import { spawnExec } from "../src/deploy/spawn-exec.js";
import { SiteEnvError, readSiteEnv } from "../site/lib/env.js";
import { loadLocalEnv, MissingEnvError } from "../src/shared/env.js";

async function main(): Promise<void> {
  const siteOnly = process.argv.includes("--site-only");
  const env = loadLocalEnv(process.env, siteOnly ? [] : ["workerBaseUrl", "publishNowSecret"]);
  readSiteEnv(process.env); // fail early, before publishing, when the build could not run
  const code = await ship(
    {
      fetch,
      exec: spawnExec,
      log: console.log,
      workerBaseUrl: env.workerBaseUrl,
      publishNowSecret: env.publishNowSecret,
      ...siteShipDeps(),
    },
    { siteOnly },
  );
  process.exit(code);
}

try {
  if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
} catch (e) {
  console.error(e instanceof MissingEnvError || e instanceof SiteEnvError ? e.message : e instanceof Error ? e.message : String(e));
  process.exit(1);
}
