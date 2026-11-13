import { describe, expect, it } from "vitest";
import { createTelegramWebClient } from "../../../src/local/coupons/telegram-web-client.js";

describe("createTelegramWebClient", () => {
  it("starts a fresh session on the web endpoint of DC 2 over 443", () => {
    const client = createTelegramWebClient("", 1, "hash");
    expect(client.session.serverAddress).toBe("venus.web.telegram.org");
    expect(client.session.port).toBe(443);
    expect(client.session.dcId).toBe(2);
  });

  it("resolves every data center to its web host, never a raw IP", async () => {
    const client = createTelegramWebClient("", 1, "hash");
    await expect(client.getDC(1)).resolves.toEqual({ id: 1, ipAddress: "pluto.web.telegram.org", port: 443 });
    await expect(client.getDC(4)).resolves.toEqual({ id: 4, ipAddress: "vesta.web.telegram.org", port: 443 });
  });
});
