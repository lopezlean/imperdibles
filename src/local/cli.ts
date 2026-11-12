import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { USAGE, main, parseCommand } from "../data/run-daily.js";
import { createD1HttpClient } from "../shared/db/d1-http-client.js";
import { DATA_ENV_KEYS, MissingEnvError, loadLocalEnv } from "../shared/env.js";
import { createCouponRound } from "./coupons/factory.js";
import { runCouponsLinkCommand } from "./coupons/link.js";
import { createOutputHooks } from "./output-hooks.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);

async function run(): Promise<number> {
  // Help and unknown commands never touch the environment or the network.
  const command = parseCommand(argv);
  if (command === null || command.name === "help") {
    (command === null ? process.stderr : process.stdout).write(USAGE);
    return command === null ? 2 : 0;
  }
  const requiredKeys = command.name === "cupones-link" ? (["cfAccountId", "cfApiToken", "d1DatabaseId"] as const) : DATA_ENV_KEYS;
  let env;
  try {
    env = loadLocalEnv(process.env, requiredKeys);
  } catch (error) {
    if (!(error instanceof MissingEnvError)) throw error;
    process.stderr.write(`Faltan variables en .env: ${error.names.join(", ")}\n`);
    return 1;
  }
  const db = createD1HttpClient({ accountId: env.cfAccountId, databaseId: env.d1DatabaseId, apiToken: env.cfApiToken });
  if (command.name === "cupones-link") {
    return runCouponsLinkCommand(
      { db, stdout: (s) => void process.stdout.write(s), stderr: (s) => void process.stderr.write(s) },
      command.url,
    );
  }
  const now = () => new Date();
  return main(argv, {
    db,
    fetch,
    env,
    now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    hooks: createOutputHooks({ db, env, now, fetch }),
    afterRevalidar:
      command.name === "revalidar" ? (createCouponRound({ db, env, now, fetch }, (line) => void process.stderr.write(`${line}\n`)) ?? undefined) : undefined,
    logPath: path.join(ROOT, "var", "run-log.jsonl"),
    stdout: (s) => void process.stdout.write(s),
    stderr: (s) => void process.stderr.write(s),
  });
}

process.exitCode = await run();
