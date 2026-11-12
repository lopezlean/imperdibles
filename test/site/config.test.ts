import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("dotenv/config", () => ({}));

const KEYS = ["SITE_URL", "TELEGRAM_CHANNEL_URL", "SITE_OUT_DIR"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function loadConfig() {
  return (await import("../../astro.config.js")).default;
}

describe("astro.config", () => {
  it("fails without SITE_URL", async () => {
    await expect(loadConfig()).rejects.toThrow(/SITE_URL/);
  });

  it("pins the static output settings", async () => {
    process.env.SITE_URL = "https://imperdibles.com.ar";
    process.env.TELEGRAM_CHANNEL_URL = "https://t.me/x";
    const config = await loadConfig();
    expect(config).toMatchObject({
      output: "static",
      srcDir: "./site",
      outDir: "./dist/site",
      trailingSlash: "always",
      site: "https://imperdibles.com.ar",
    });

    vi.resetModules();
    process.env.SITE_OUT_DIR = "/tmp/x";
    expect((await loadConfig()).outDir).toBe("/tmp/x");
  });
});
