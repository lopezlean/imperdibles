export type LocalEnv = {
  mlAppId: string;
  mlClientSecret: string;
  mlRedirectUri: string;
  cfAccountId: string;
  cfApiToken: string;
  d1DatabaseId: string;
  telegramBotToken: string;
  telegramOwnerChatId: string;
  telegramChannelId: string;
  publishNowSecret: string;
  workerBaseUrl: string;
  tgApiId: string;
  tgApiHash: string;
  tgSession: string;
  tgSourceChannelId: string;
  anthropicApiKey: string;
  anthropicModel: string;
};

/** Keys every local command has always required; the default `required` list. */
export const BASE_ENV_KEYS: readonly (keyof LocalEnv)[] = [
  "mlAppId",
  "mlClientSecret",
  "mlRedirectUri",
  "cfAccountId",
  "cfApiToken",
  "d1DatabaseId",
  "telegramBotToken",
  "telegramOwnerChatId",
  "telegramChannelId",
  "publishNowSecret",
  "workerBaseUrl",
];

/** Opt-in: required only by the coupon pipeline (ANTHROPIC_MODEL is optional, it has a default). */
export const COUPON_ENV_KEYS: readonly (keyof LocalEnv)[] = [
  "telegramBotToken",
  "telegramOwnerChatId",
  "telegramChannelId",
  "tgApiId",
  "tgApiHash",
  "tgSession",
  "tgSourceChannelId",
  "anthropicApiKey",
];

export const DATA_ENV_KEYS: readonly (keyof LocalEnv)[] = [
  "mlAppId",
  "mlClientSecret",
  "mlRedirectUri",
  "cfAccountId",
  "cfApiToken",
  "d1DatabaseId",
];

const VAR_NAMES: Record<keyof LocalEnv, string> = {
  mlAppId: "ML_APP_ID",
  mlClientSecret: "ML_CLIENT_SECRET",
  mlRedirectUri: "ML_REDIRECT_URI",
  cfAccountId: "D1_ACCOUNT_ID",
  cfApiToken: "D1_API_TOKEN",
  d1DatabaseId: "D1_DATABASE_ID",
  telegramBotToken: "TELEGRAM_BOT_TOKEN",
  telegramOwnerChatId: "TELEGRAM_OWNER_CHAT_ID",
  telegramChannelId: "TELEGRAM_CHANNEL_ID",
  publishNowSecret: "PUBLISH_NOW_SECRET",
  workerBaseUrl: "WORKER_BASE_URL",
  tgApiId: "TELEGRAM_API_ID",
  tgApiHash: "TELEGRAM_API_HASH",
  tgSession: "TELEGRAM_SESSION",
  tgSourceChannelId: "TELEGRAM_SOURCE_CHANNEL_ID",
  anthropicApiKey: "ANTHROPIC_API_KEY",
  anthropicModel: "ANTHROPIC_MODEL",
};

const ALL_KEYS = Object.keys(VAR_NAMES) as (keyof LocalEnv)[];

/** Thrown with variable names only, never values. */
export class MissingEnvError extends Error {
  constructor(readonly names: string[]) {
    super(`Missing environment variables: ${names.join(", ")}`);
  }
}

export function loadLocalEnv(
  source: Record<string, string | undefined>,
  required: readonly (keyof LocalEnv)[] = BASE_ENV_KEYS,
): LocalEnv {
  const missing: string[] = [];
  const out = {} as LocalEnv;
  for (const key of ALL_KEYS) {
    const value = source[VAR_NAMES[key]];
    if (value === undefined || value === "") {
      if (required.includes(key)) missing.push(VAR_NAMES[key]);
      out[key] = "";
    } else {
      out[key] = value;
    }
  }
  if (missing.length > 0) throw new MissingEnvError(missing);
  return out;
}
