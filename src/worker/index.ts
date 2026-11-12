import { createTelegramClient, type TelegramClient } from "../output/telegram/client.js";
import { createD1BindingClient } from "../shared/db/d1-binding-client.js";
import { safeEqual } from "./auth.js";
import type { WorkerDeps } from "./deps.js";
import type { Env } from "./env.js";
import { checkMissingRun } from "./missing-run.js";
import { regeneratePages, servePage } from "./page-store.js";
import { publishValidated } from "./publish.js";
import { handleTelegramUpdate } from "./webhook.js";

// Cron times mirror notify_time and publish_time in config; changing an hour means editing both and wrangler.toml.
const CRON_MISSING_RUN = "30 10 * * *";
const CRON_PUBLISH = "0 14 * * *";

// Single place that regenerates the page after a publication. A page failure is logged, never propagated:
// the posts are already out and publishValidated must still report them.
const afterPublish = async (deps: WorkerDeps): Promise<void> => {
  try {
    await regeneratePages({ db: deps.db, now: deps.now, channelUrl: deps.env.TELEGRAM_CHANNEL_URL });
  } catch (e) {
    console.error("regeneratePages failed", e);
  }
};

const telegramFor = (deps: WorkerDeps): TelegramClient =>
  deps.telegram ?? createTelegramClient({ token: deps.env.TELEGRAM_BOT_TOKEN, fetch });

const json = (body: unknown) => Response.json(body);
const empty = () => new Response(null, { status: 200 });
const status = (code: number, text: string) => new Response(text, { status: code });

function runPublish(deps: WorkerDeps) {
  return publishValidated({
    db: deps.db,
    telegram: telegramFor(deps),
    channelId: deps.env.TELEGRAM_CHANNEL_ID,
    ownerChatId: deps.env.TELEGRAM_OWNER_CHAT_ID,
    now: deps.now,
    afterPublish: () => afterPublish(deps),
  });
}

async function handleWebhook(req: Request, deps: WorkerDeps): Promise<Response> {
  const secret = deps.env.TELEGRAM_WEBHOOK_SECRET;
  const given = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (secret === "" || !safeEqual(given, secret)) return status(401, "unauthorized");
  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return empty(); // 200 so Telegram does not retry a body that can never parse
  }
  const reply = await handleTelegramUpdate(
    { db: deps.db, ownerChatId: deps.env.TELEGRAM_OWNER_CHAT_ID, now: deps.now },
    update,
  );
  return reply === null ? empty() : json(reply);
}

async function handlePublishNow(req: Request, deps: WorkerDeps): Promise<Response> {
  const secret = deps.env.PUBLISH_NOW_SECRET;
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (secret === "" || !safeEqual(token, secret)) return status(401, "unauthorized");
  const report = await runPublish(deps);
  // The manual trigger also refreshes the stored page when nothing new went out (e.g. after a deploy
  // that changed the page markup); a publication already regenerated it.
  if (report.published.length === 0) await afterPublish(deps);
  return json(report);
}

async function serveHome(req: Request, deps: WorkerDeps): Promise<Response> {
  const res = await servePage({ db: deps.db, now: deps.now, channelUrl: deps.env.TELEGRAM_CHANNEL_URL });
  return req.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
}

export async function handleFetch(req: Request, deps: WorkerDeps): Promise<Response> {
  const { pathname } = new URL(req.url);
  switch (pathname) {
    case "/":
      if (req.method !== "GET" && req.method !== "HEAD") return status(405, "method not allowed");
      return serveHome(req, deps);
    case "/healthz":
      if (req.method !== "GET") return status(405, "method not allowed");
      await deps.db.all("SELECT 1");
      return status(200, "ok");
    case "/telegram/webhook":
      return req.method === "POST" ? handleWebhook(req, deps) : status(405, "method not allowed");
    case "/internal/publish-now":
      return req.method === "POST" ? handlePublishNow(req, deps) : status(405, "method not allowed");
    default:
      return status(404, "not found");
  }
}

export async function handleScheduled(cron: string, deps: WorkerDeps): Promise<void> {
  if (cron === CRON_MISSING_RUN) {
    await checkMissingRun({
      db: deps.db,
      telegram: telegramFor(deps),
      ownerChatId: deps.env.TELEGRAM_OWNER_CHAT_ID,
      now: deps.now,
    });
  } else if (cron === CRON_PUBLISH) {
    await runPublish(deps);
  } else {
    throw new Error(`unknown cron: ${cron}`);
  }
}

const depsFor = (env: Env): WorkerDeps => ({ db: createD1BindingClient(env.DB), env, now: () => new Date() });

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleFetch(req, depsFor(env));
  },
  scheduled(controller: { cron: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): void {
    ctx.waitUntil(handleScheduled(controller.cron, depsFor(env)));
  },
};
