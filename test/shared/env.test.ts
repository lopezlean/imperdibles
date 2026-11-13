import { describe, expect, it } from "vitest";
import { BASE_ENV_KEYS, COUPON_ENV_KEYS, DATA_ENV_KEYS, MissingEnvError, loadLocalEnv } from "../../src/shared/env.js";

const full = {
  ML_APP_ID: "app-id-value",
  ML_CLIENT_SECRET: "secret-value",
  ML_REDIRECT_URI: "https://imperdibles.com.ar",
  D1_ACCOUNT_ID: "acc-value",
  D1_API_TOKEN: "token-value",
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

  it("never reads Wrangler's own CLOUDFLARE_* variables (they would override wrangler login on deploy)", () => {
    const { D1_ACCOUNT_ID: _a, D1_API_TOKEN: _b, ...rest } = full;
    const err = (() => {
      try {
        loadLocalEnv({ ...rest, CLOUDFLARE_ACCOUNT_ID: "x", CLOUDFLARE_API_TOKEN: "y" });
      } catch (e) {
        return e;
      }
    })() as MissingEnvError;
    expect(err).toBeInstanceOf(MissingEnvError);
    expect(err.names).toEqual(["D1_ACCOUNT_ID", "D1_API_TOKEN"]);
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
        D1_ACCOUNT_ID: "d",
        D1_API_TOKEN: "e",
        D1_DATABASE_ID: "f",
      },
      DATA_ENV_KEYS,
    );
    expect(env.cfApiToken).toBe("e");
    expect(env.telegramBotToken).toBe("");
    expect(env.workerBaseUrl).toBe("");
    expect(env.publishNowSecret).toBe("");
  });

  it("exposes the Anthropic keys as empty strings when unset, without throwing", () => {
    const env = loadLocalEnv(full);
    expect(env.anthropicApiKey).toBe("");
    expect(env.anthropicModel).toBe("");
  });

  it("reads the Anthropic keys when set and requires them only on opt-in", () => {
    const env = loadLocalEnv({ ...full, ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "m" });
    expect(env.anthropicApiKey).toBe("k");
    expect(env.anthropicModel).toBe("m");
    expect(() => loadLocalEnv(full, [...BASE_ENV_KEYS, ...COUPON_ENV_KEYS, "anthropicApiKey"])).toThrow(/ANTHROPIC_API_KEY/);
    expect(COUPON_ENV_KEYS).not.toContain("anthropicApiKey");
  });

  it("COUPON_ENV_KEYS lists only the absent coupon names, never values", () => {
    let err: unknown;
    try {
      loadLocalEnv({ ...full, TELEGRAM_API_ID: "123456", TELEGRAM_SESSION: "session-value" }, COUPON_ENV_KEYS);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MissingEnvError);
    expect((err as MissingEnvError).names).toEqual([
      "TELEGRAM_API_HASH",
      "TELEGRAM_SOURCE_CHANNEL_ID",
    ]);
    expect((err as Error).message).not.toContain("session-value");
  });

  it("reads the Codex extractor keys, all optional", () => {
    const env = loadLocalEnv({ ...full, COUPON_EXTRACTOR: "anthropic", COUPON_CODEX_MODEL: "m", CODEX_AUTH_FILE: "/x/auth.json" });
    expect([env.couponExtractor, env.couponCodexModel, env.codexAuthFile]).toEqual(["anthropic", "m", "/x/auth.json"]);
    expect(loadLocalEnv(full).couponExtractor).toBe("");
  });

  it("reads the Telegram user-session keys and keeps them out of the default required list", () => {
    const env = loadLocalEnv({
      ...full,
      TELEGRAM_API_ID: "1",
      TELEGRAM_API_HASH: "h",
      TELEGRAM_SESSION: "s",
      TELEGRAM_SOURCE_CHANNEL_ID: "c",
    });
    expect([env.tgApiId, env.tgApiHash, env.tgSession, env.tgSourceChannelId]).toEqual(["1", "h", "s", "c"]);
    expect(BASE_ENV_KEYS).not.toContain("tgSession");
  });
});
