import Anthropic from "@anthropic-ai/sdk";
import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages";
import { randomUUID } from "node:crypto";
import { ship } from "../../deploy/ship.js";
import { spawnExec } from "../../deploy/spawn-exec.js";
import { createTelegramClient } from "../../output/telegram/client.js";
import type { SqlClient } from "../../shared/db/sql-client.js";
import { COUPON_ENV_KEYS, envVarName, type LocalEnv } from "../../shared/env.js";
import { DEFAULT_MODEL, createAnthropicExtractor, type AnthropicLike } from "./anthropic-extractor.js";
import { createCodexAuth } from "./codex-auth.js";
import { DEFAULT_CODEX_MODEL, createCodexExtractor } from "./codex-extractor.js";
import type { CouponExtractor } from "./extractor.js";
import { createGramjsReader } from "./gramjs-reader.js";
import type { CouponAiObservability } from "./posthog-ai.js";
import { ingestCoupons } from "./ingest.js";
import { runCouponRound } from "./round.js";
import { syncSiteIfChanged } from "./site-sync.js";

export type CouponRoundDeps = {
  db: SqlClient;
  env: LocalEnv;
  now: () => Date;
  fetch: typeof fetch;
  aiObservability?: CouponAiObservability | null;
  exec?: (cmd: string, args: string[]) => Promise<number>;
};

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The SDK client behind the extractor's narrow interface; the cast is confined to the request params. */
function anthropicAdapter(apiKey: string, aiObservability: CouponAiObservability | null): AnthropicLike {
  const client = new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 });
  return {
    messages: {
      create: async (params) => {
        const traceId = randomUUID();
        const startedAt = Date.now();
        try {
          const response = await client.messages.create(params as unknown as MessageCreateParamsNonStreaming);
          aiObservability?.captureAnthropicGeneration({
            traceId,
            model: String(params.model),
            input: params,
            outputChoices: response.content,
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            latencyMs: Date.now() - startedAt,
          });
          return response;
        } catch (error) {
          aiObservability?.captureAnthropicGeneration({
            traceId,
            model: String(params.model),
            input: params,
            outputChoices: [],
            inputTokens: null,
            outputTokens: null,
            latencyMs: Date.now() - startedAt,
            error: error instanceof Error ? error.name : "unknown_error",
          });
          throw error;
        }
      },
    },
  };
}

/** Replaces every secret value (4+ characters) with [redacted]. */
export function createRedactor(env: LocalEnv): (text: string) => string {
  const secrets = [env.tgSession, env.tgApiHash, env.tgApiId, env.anthropicApiKey, env.telegramBotToken, env.cfApiToken].filter((s) => s.length >= 4);
  return (text) => secrets.reduce((out, secret) => out.split(secret).join("[redacted]"), text);
}

/**
 * Wires the real adapters from the environment. Null (after logging the variable NAMES, never values) when the
 * coupon variables are missing or TELEGRAM_API_ID is not a positive integer.
 */
export function createCouponRound(deps: CouponRoundDeps, log: (line: string) => void): (() => Promise<void>) | null {
  const { db, env, now } = deps;
  const kind = env.couponExtractor === "" ? "codex" : env.couponExtractor;
  if (kind !== "codex" && kind !== "anthropic") {
    log(`coupons: round skipped, ${envVarName("couponExtractor")} must be "codex" or "anthropic"`);
    return null;
  }
  const required = kind === "anthropic" ? [...COUPON_ENV_KEYS, "anthropicApiKey" as const] : COUPON_ENV_KEYS;
  const missing = required.filter((key) => env[key] === "").map(envVarName);
  if (missing.length > 0) {
    log(`coupons: round skipped, missing environment variables: ${missing.join(", ")}`);
    return null;
  }
  const apiId = Number(env.tgApiId);
  if (!Number.isInteger(apiId) || apiId <= 0) {
    log(`coupons: round skipped, ${envVarName("tgApiId")} must be a positive integer`);
    return null;
  }

  // Last line of defence: no secret value may reach a log line or an owner message, whatever threw.
  const redact = createRedactor(env);
  const safeLog = (line: string): void => log(redact(line));

  const telegram = createTelegramClient({ token: env.telegramBotToken, fetch: deps.fetch });
  const ownerChatId = env.telegramOwnerChatId;
  const sendToOwner = async (text: string): Promise<void> => {
    await telegram.sendMessage({ chat_id: ownerChatId, text: redact(text) });
  };

  const reader = createGramjsReader({ apiId, apiHash: env.tgApiHash, session: env.tgSession, channelId: env.tgSourceChannelId });
  const aiObservability = deps.aiObservability ?? null;
  // Codex tokens live in ~/.codex/auth.json and never enter the env, a log line or an error message.
  const extractor: CouponExtractor =
    kind === "anthropic"
      ? createAnthropicExtractor({
          client: anthropicAdapter(env.anthropicApiKey, aiObservability),
          model: env.anthropicModel || DEFAULT_MODEL,
        })
      : createCodexExtractor({
          auth: createCodexAuth({ filePath: env.codexAuthFile || undefined, fetch: deps.fetch }),
          model: env.couponCodexModel || DEFAULT_CODEX_MODEL,
          fetch: deps.fetch,
          aiObservability,
        });

  return () =>
    runCouponRound({
      ingest: () =>
        ingestCoupons({
          db,
          reader,
          extractor,
          // ingestCoupons swallows failed owner notices; log them here, then let it carry on.
          telegram: {
            sendMessage: async (params) => {
              try {
                return await telegram.sendMessage({ ...params, text: redact(params.text) });
              } catch (e) {
                safeLog(`coupons: telegram send failed: ${errText(e)}`);
                throw e;
              }
            },
          },
          channelId: env.telegramChannelId,
          ownerChatId,
          now,
        }),
      sync: () =>
        syncSiteIfChanged({
          db,
          now,
          notifyOwner: sendToOwner,
          runShipSiteOnly: () =>
            ship(
              {
                fetch: deps.fetch,
                exec: deps.exec ?? spawnExec,
                log: console.log,
                workerBaseUrl: env.workerBaseUrl,
                publishNowSecret: env.publishNowSecret,
              },
              { siteOnly: true },
            ),
        }),
      notifyOwner: sendToOwner,
      log: safeLog,
    });
}
