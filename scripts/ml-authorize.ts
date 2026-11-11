import "dotenv/config";
import { MlAuthError, authorizationUrl, exchangeCode } from "../src/data/ml/auth.js";
import { createD1HttpClient } from "../src/shared/db/d1-http-client.js";
import { DATA_ENV_KEYS, loadLocalEnv } from "../src/shared/env.js";

const [command, code] = process.argv.slice(2);

try {
  const env = loadLocalEnv(process.env, DATA_ENV_KEYS);
  if (command === "url") {
    console.log(authorizationUrl(env));
  } else if (command === "token" && code) {
    const db = createD1HttpClient({
      accountId: env.cfAccountId,
      databaseId: env.d1DatabaseId,
      apiToken: env.cfApiToken,
    });
    await exchangeCode({ db, fetch, env, now: () => new Date() }, code);
    console.log("Autorización guardada.");
  } else {
    console.error("Uso: pnpm ml:authorize url | pnpm ml:authorize token <code>");
    process.exitCode = 1;
  }
} catch (error) {
  // Only the reason or the variable names are printed, never token values.
  console.error(error instanceof MlAuthError ? [error.reason, error.detail].filter(Boolean).join(": ") : error instanceof Error ? error.constructor.name + ": " + error.message : "error");
  process.exitCode = 1;
}
