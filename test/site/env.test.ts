import { describe, expect, it } from "vitest";
import { readSiteEnv } from "../../site/lib/env.js";

describe("readSiteEnv", () => {
  it("requires SITE_URL and TELEGRAM_CHANNEL_URL", () => {
    expect(() => readSiteEnv({})).toThrow(/SITE_URL.*TELEGRAM_CHANNEL_URL/);
  });

  it("strips a trailing slash", () => {
    expect(readSiteEnv({ SITE_URL: "https://imperdibles.com.ar/", TELEGRAM_CHANNEL_URL: "https://t.me/x" })).toEqual({
      siteUrl: "https://imperdibles.com.ar",
      channelUrl: "https://t.me/x",
    });
  });

  it("rejects a SITE_URL that is not http(s)", () => {
    expect(() => readSiteEnv({ SITE_URL: "imperdibles.com.ar", TELEGRAM_CHANNEL_URL: "https://t.me/x" })).toThrow(
      /SITE_URL/,
    );
  });
});
