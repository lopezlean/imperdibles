import { describe, expect, it } from "vitest";
import { buildSetWebhookParams } from "../../src/output/telegram/webhook-params.js";

describe("buildSetWebhookParams", () => {
  it("builds the setWebhook body for the Worker route", () => {
    expect(buildSetWebhookParams("https://imperdibles.com.ar", "s")).toEqual({
      url: "https://imperdibles.com.ar/telegram/webhook",
      secret_token: "s",
      allowed_updates: ["message"],
      drop_pending_updates: true,
    });
  });

  it("removes one trailing slash from the base URL so the path is not doubled", () => {
    expect(buildSetWebhookParams("https://imperdibles.com.ar/", "s").url).toBe("https://imperdibles.com.ar/telegram/webhook");
  });
});
