import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { MlAuthError, authorizationUrl, createTokenProvider, exchangeCode } from "../../../src/data/ml/auth.js";
import type { LocalEnv } from "../../../src/shared/env.js";
import { createSqliteClient } from "../../support/sqlite-client.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "fixtures", "ml");
const okBody = readFileSync(join(FIXTURES, "oauth-token-ok.json"), "utf8");
const invalidGrantBody = readFileSync(join(FIXTURES, "oauth-token-invalid-grant.json"), "utf8");
const ok = JSON.parse(okBody) as { access_token: string; refresh_token: string };

const env: LocalEnv = {
  mlAppId: "123",
  mlClientSecret: "fake-client-secret",
  mlRedirectUri: "https://imperdibles.com.ar",
  cfAccountId: "",
  cfApiToken: "",
  d1DatabaseId: "",
  telegramBotToken: "",
  telegramOwnerChatId: "",
  telegramChannelId: "",
  publishNowSecret: "",
  workerBaseUrl: "",
};
const NOW = new Date("2026-11-10T12:00:00Z");
const now = () => NOW;
const plus = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

async function seed(db: ReturnType<typeof createSqliteClient>, expiresAt: string) {
  await db.run("INSERT INTO ml_tokens (id, access_token, refresh_token, expires_at) VALUES (1, ?, ?, ?)", [
    "old-access",
    "old-refresh",
    expiresAt,
  ]);
}
const row = (db: ReturnType<typeof createSqliteClient>) =>
  db.all<{ access_token: string; refresh_token: string; expires_at: string }>("SELECT * FROM ml_tokens");
const respond = (body: string, status = 200) =>
  vi.fn(async () => new Response(body, { status, headers: { "Content-Type": "application/json" } }));

describe("authorizationUrl", () => {
  it("builds the authorization URL", () => {
    expect(authorizationUrl({ mlAppId: "123", mlRedirectUri: "https://imperdibles.com.ar" })).toBe(
      "https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=123&redirect_uri=https%3A%2F%2Fimperdibles.com.ar",
    );
  });
});

describe("createTokenProvider", () => {
  it("returns the stored token when more than 30 minutes remain", async () => {
    const db = createSqliteClient();
    await seed(db, plus(2 * 3600_000));
    const fetch = respond(okBody);
    expect(await createTokenProvider({ db, fetch, env, now }).get()).toBe("old-access");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refreshes when less than 30 minutes remain and stores the new pair first", async () => {
    const db = createSqliteClient();
    await seed(db, plus(20 * 60_000));
    const fetch = respond(okBody);
    const token = await createTokenProvider({ db, fetch, env, now }).get();
    expect(token).toBe(ok.access_token);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.mercadolibre.com/oauth/token");
    expect(init.method).toBe("POST");
    const form = new URLSearchParams(init.body as string);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("old-refresh");
    expect(form.get("client_id")).toBe("123");
    expect(form.get("client_secret")).toBe("fake-client-secret");
    expect(await row(db)).toEqual([
      { id: 1, access_token: ok.access_token, refresh_token: ok.refresh_token, expires_at: plus(21600_000) },
    ]);
  });

  it("keeps the old refresh token when the response omits one", async () => {
    const db = createSqliteClient();
    await seed(db, plus(20 * 60_000));
    const parsed = JSON.parse(okBody) as Record<string, unknown>;
    delete parsed.refresh_token;
    const body = JSON.stringify(parsed);
    await createTokenProvider({ db, fetch: respond(body), env, now }).get();
    const [stored] = await row(db);
    expect(stored?.refresh_token).toBe("old-refresh");
    expect(stored?.access_token).toBe(ok.access_token);
  });

  it("throws MlAuthError(refresh_failed) on invalid_grant and leaves ml_tokens unchanged", async () => {
    const db = createSqliteClient();
    await seed(db, plus(20 * 60_000));
    const before = await row(db);
    const err = await createTokenProvider({ db, fetch: respond(invalidGrantBody, 400), env, now })
      .get()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MlAuthError);
    expect((err as MlAuthError).reason).toBe("refresh_failed");
    expect(await row(db)).toEqual(before);
  });

  it("throws MlAuthError(not_authorized) when ml_tokens is empty", async () => {
    const db = createSqliteClient();
    const fetch = respond(okBody);
    const err = await createTokenProvider({ db, fetch, env, now })
      .get()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MlAuthError);
    expect((err as MlAuthError).reason).toBe("not_authorized");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forceRefresh refreshes even when the token is fresh", async () => {
    const db = createSqliteClient();
    await seed(db, plus(2 * 3600_000));
    const fetch = respond(okBody);
    expect(await createTokenProvider({ db, fetch, env, now }).forceRefresh()).toBe(ok.access_token);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("exchangeCode", () => {
  it("posts the authorization code and stores the pair", async () => {
    const db = createSqliteClient();
    const fetch = respond(okBody);
    await exchangeCode({ db, fetch, env, now }, "TG-fake-code");
    const form = new URLSearchParams((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("TG-fake-code");
    expect(form.get("redirect_uri")).toBe("https://imperdibles.com.ar");
    expect(await row(db)).toEqual([
      { id: 1, access_token: ok.access_token, refresh_token: ok.refresh_token, expires_at: plus(21600_000) },
    ]);
  });

  it("throws MlAuthError(refresh_failed) when the code is rejected and stores nothing", async () => {
    const db = createSqliteClient();
    const err = await exchangeCode({ db, fetch: respond(invalidGrantBody, 400), env, now }, "bad")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MlAuthError);
    expect(await row(db)).toEqual([]);
  });

  it("reports the HTTP status and Mercado Libre error code, never secrets", async () => {
    const db = createSqliteClient();
    const err = (await exchangeCode({ db, fetch: respond(invalidGrantBody, 400), env, now }, "bad").catch(
      (e: unknown) => e,
    )) as MlAuthError;
    const parsed = JSON.parse(invalidGrantBody) as { error: string };
    expect(err.detail).toContain("HTTP 400");
    expect(err.detail).toContain(parsed.error);
    expect(err.detail).not.toContain("fake-client-secret");
    expect(err.detail).not.toContain("bad");
  });

  it("reports a missing refresh token on the first authorization", async () => {
    const db = createSqliteClient();
    const parsed = JSON.parse(okBody) as Record<string, unknown>;
    delete parsed.refresh_token;
    const err = (await exchangeCode({ db, fetch: respond(JSON.stringify(parsed)), env, now }, "TG-x").catch(
      (e: unknown) => e,
    )) as MlAuthError;
    expect(err).toBeInstanceOf(MlAuthError);
    expect(err.detail).toContain("refresh_token");
    expect(err.detail).toContain("offline_access");
    expect(await row(db)).toEqual([]);
  });
});
