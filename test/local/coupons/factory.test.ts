import { describe, expect, it } from "vitest";
import { createCouponRound } from "../../../src/local/coupons/factory.js";
import type { LocalEnv } from "../../../src/shared/env.js";
import { createSqliteClient } from "../../support/sqlite-client.js";

const ENV: LocalEnv = {
  mlAppId: "a",
  mlClientSecret: "b",
  mlRedirectUri: "c",
  cfAccountId: "d",
  cfApiToken: "e",
  d1DatabaseId: "f",
  telegramBotToken: "123:BOT-SECRET",
  telegramOwnerChatId: "1",
  telegramChannelId: "-100",
  publishNowSecret: "p",
  workerBaseUrl: "https://w.test",
  tgApiId: "12345",
  tgApiHash: "HASH-SECRET",
  tgSession: "SESSION-SECRET",
  tgSourceChannelId: "-100999",
  anthropicApiKey: "sk-SECRET",
  anthropicModel: "",
};

function build(env: LocalEnv) {
  const log: string[] = [];
  const round = createCouponRound(
    { db: createSqliteClient(), env, now: () => new Date(), fetch: (async () => new Response("{}")) as typeof fetch },
    (l) => void log.push(l),
  );
  return { round, log };
}

describe("createCouponRound", () => {
  it("returns null and logs only variable names when a coupon variable is missing", () => {
    const { round, log } = build({ ...ENV, tgSession: "", anthropicApiKey: "" });
    expect(round).toBeNull();
    const text = log.join("\n");
    expect(text).toContain("TELEGRAM_SESSION");
    expect(text).toContain("ANTHROPIC_API_KEY");
    expect(text).not.toContain("HASH-SECRET");
    expect(text).not.toContain("BOT-SECRET");
  });

  it.each(["abc", "0", "-5", "12.5", " "])("returns null and names TELEGRAM_API_ID when it is %j", (bad) => {
    const { round, log } = build({ ...ENV, tgApiId: bad });
    // " " is treated as set by the missing check, then rejected as not a positive integer.
    expect(round).toBeNull();
    const text = log.join("\n");
    expect(text).toContain("TELEGRAM_API_ID");
    expect(text).not.toContain("HASH-SECRET");
  });

  it("returns a round when everything is set", () => {
    expect(build(ENV).round).toBeTypeOf("function");
  });
});
