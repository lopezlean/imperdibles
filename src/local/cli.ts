import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { USAGE, main } from "../data/run-daily.js";
import { createD1HttpClient } from "../shared/db/d1-http-client.js";
import { DATA_ENV_KEYS, MissingEnvError, loadLocalEnv } from "../shared/env.js";
import { createOutputHooks } from "./output-hooks.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);

async function run(): Promise<number> {
  // Help and unknown commands never touch the environment or the network.
  if (argv[0] !== "correr") {
    const help = argv[0] === "--help" || argv[0] === "-h";
    (help ? process.stdout : process.stderr).write(USAGE);
    return help ? 0 : 2;
  }
  let env;
  try {
    env = loadLocalEnv(process.env, DATA_ENV_KEYS);
  } catch (error) {
    if (!(error instanceof MissingEnvError)) throw error;
    process.stderr.write(`Faltan variables en .env: ${error.names.join(", ")}\n`);
    return 1;
  }
  const db = createD1HttpClient({ accountId: env.cfAccountId, databaseId: env.d1DatabaseId, apiToken: env.cfApiToken });
  const now = () => new Date();
  return main(argv, {
    db,
    fetch,
    env,
    now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    hooks: createOutputHooks({ db, env, now, fetch }),
    logPath: path.join(ROOT, "var", "run-log.jsonl"),
    stdout: (s) => void process.stdout.write(s),
    stderr: (s) => void process.stderr.write(s),
  });
}

process.exitCode = await run();
