import { describe, expect, it } from "vitest";
import { DATA_ENV_KEYS, MissingEnvError, loadLocalEnv } from "../../src/shared/env.js";

const full = {
  ML_APP_ID: "app-id-value",
  ML_CLIENT_SECRET: "secret-value",
  ML_REDIRECT_URI: "https://imperdibles.ar",
  CLOUDFLARE_ACCOUNT_ID: "acc-value",
  CLOUDFLARE_API_TOKEN: "token-value",
  D1_DATABASE_ID: "db-value",
  TELEGRAM_BOT_TOKEN: "tg-value",
  TELEGRAM_OWNER_CHAT_ID: "owner-value",
  TELEGRAM_CHANNEL_ID: "chan-value",
  PUBLISH_NOW_SECRET: "pub-value",
  WORKER_BASE_URL: "https://w.example",
};

describe("loadLocalEnv", () => {
  it("loads every key", () => {
    const env = loadLocalEnv(full);
    expect(env.mlAppId).toBe("app-id-value");
    expect(env.d1DatabaseId).toBe("db-value");
    expect(env.workerBaseUrl).toBe("https://w.example");
  });

  it("lists missing names only, never values", () => {
    const { TELEGRAM_BOT_TOKEN: _a, ML_APP_ID: _b, ...rest } = full;
    let err: unknown;
    try {
      loadLocalEnv(rest);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MissingEnvError);
    const msg = (err as Error).message;
    expect(msg).toContain("TELEGRAM_BOT_TOKEN");
    expect(msg).toContain("ML_APP_ID");
    for (const v of Object.values(rest)) expect(msg).not.toContain(v);
  });

  it("treats empty strings as missing", () => {
    expect(() => loadLocalEnv({ ...full, ML_APP_ID: "" })).toThrow(/ML_APP_ID/);
  });

  it("loads only the data subset when required is narrowed", () => {
    const env = loadLocalEnv(
      {
        ML_APP_ID: "a",
        ML_CLIENT_SECRET: "b",
        ML_REDIRECT_URI: "c",
        CLOUDFLARE_ACCOUNT_ID: "d",
        CLOUDFLARE_API_TOKEN: "e",
        D1_DATABASE_ID: "f",
      },
      DATA_ENV_KEYS,
    );
    expect(env.cfApiToken).toBe("e");
    expect(env.telegramBotToken).toBe("");
    expect(env.workerBaseUrl).toBe("");
    expect(env.publishNowSecret).toBe("");
  });
});
