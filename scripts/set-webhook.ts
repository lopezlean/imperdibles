import "dotenv/config";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadLocalEnv, MissingEnvError } from "../src/shared/env.js";
import { buildSetWebhookParams } from "../src/output/telegram/webhook-params.js";

type SetWebhookResponse = { ok?: boolean; description?: string };

async function main(): Promise<void> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (secret === "") {
    console.log("Missing environment variables: TELEGRAM_WEBHOOK_SECRET");
    process.exitCode = 1;
    return;
  }
  const env = loadLocalEnv(process.env, ["telegramBotToken", "workerBaseUrl"]);
  const params = buildSetWebhookParams(env.workerBaseUrl, secret);
  // Never print the URL: it contains the bot token.
  const res = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const data = (await res.json()) as SetWebhookResponse;
  console.log(data.description ?? "unknown error");
  if (data.ok !== true) process.exitCode = 1;
}

try {
  if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
} catch (e) {
  if (e instanceof MissingEnvError) console.log(e.message);
  else console.log("Could not set the webhook. Check the local configuration.");
  process.exitCode = 1;
}
