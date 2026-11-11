import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTelegramClient, isInvalidFileId, TelegramError } from "../../../src/output/telegram/client.js";

const TOKEN = "123456:FAKE-TOKEN-abc";
const fx = (n: string) => readFileSync(path.join(process.cwd(), "fixtures", "telegram", `${n}.json`), "utf8");

function fake(body: string, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("telegram client", () => {
  it("calls fetch without a foreign this (Workers throws Illegal invocation otherwise)", async () => {
    const strictFetch = function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response(fx("send-photo-ok")));
    } as unknown as typeof fetch;
    const c = createTelegramClient({ token: TOKEN, fetch: strictFetch });
    const r = await c.sendPhoto({ chat_id: "-100", photo: { fileId: "abc" }, caption: "hola" });
    expect(r.message_id).toBe(101);
  });

  it("sends a photo by file id as JSON and returns the largest size file_id", async () => {
    const { f, calls } = fake(fx("send-photo-ok"));
    const c = createTelegramClient({ token: TOKEN, fetch: f });
    const r = await c.sendPhoto({ chat_id: "-100", photo: { fileId: "abc" }, caption: "hola", reply_to_message_id: 5 });
    expect(r).toEqual({ message_id: 101, file_id: "FAKE_FILE_ID_LARGE" });
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendPhoto`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({
      chat_id: "-100",
      photo: "abc",
      caption: "hola",
      reply_to_message_id: 5,
    });
  });

  it("uploads a PNG as multipart with a tarjeta.png part", async () => {
    const { f, calls } = fake(fx("send-photo-ok"));
    const c = createTelegramClient({ token: TOKEN, fetch: f });
    await c.sendPhoto({ chat_id: "-100", photo: { png: new Uint8Array([137, 80, 78, 71]) }, caption: "hola" });
    const body = calls[0]!.init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get("chat_id")).toBe("-100");
    expect(body.get("caption")).toBe("hola");
    expect(body.has("reply_to_message_id")).toBe(false);
    const part = body.get("photo") as File;
    expect(part.name).toBe("tarjeta.png");
    expect(part.type).toBe("image/png");
    expect(part.size).toBe(4);
  });

  it("sends a message", async () => {
    const { f, calls } = fake(fx("send-message-ok"));
    const c = createTelegramClient({ token: TOKEN, fetch: f });
    expect(await c.sendMessage({ chat_id: "1", text: "Hola" })).toEqual({ message_id: 202 });
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ chat_id: "1", text: "Hola" });
  });

  it("maps a bad file id to TelegramError recognised by isInvalidFileId", async () => {
    const { f } = fake(fx("send-photo-bad-file-id"), 400);
    const c = createTelegramClient({ token: TOKEN, fetch: f });
    const e = await c.sendPhoto({ chat_id: "1", photo: { fileId: "x" }, caption: "" }).catch((x) => x);
    expect(e).toBeInstanceOf(TelegramError);
    expect(e.status).toBe(400);
    expect(isInvalidFileId(e)).toBe(true);
    expect(e.message).toContain("sendPhoto");
    expect(e.message).toContain("400");
    expect(e.message).toContain("file identifier");
    expect(e.message).not.toContain(TOKEN);
  });

  it("recognises the 'Wrong file_id' wording too", () => {
    expect(isInvalidFileId(new TelegramError(400, "sendPhoto: Bad Request: wrong file_id or the file is temporarily unavailable"))).toBe(true);
  });

  it("maps 429 to TelegramError and isInvalidFileId is false", async () => {
    const { f } = fake(fx("too-many-requests"), 429);
    const c = createTelegramClient({ token: TOKEN, fetch: f });
    const e = await c.sendMessage({ chat_id: "1", text: "x" }).catch((x) => x);
    expect(e).toBeInstanceOf(TelegramError);
    expect(e.status).toBe(429);
    expect(e.message).not.toContain(TOKEN);
    expect(isInvalidFileId(e)).toBe(false);
    expect(isInvalidFileId(new Error("file identifier"))).toBe(false);
  });

  it("turns non-JSON responses into TelegramError without leaking the token", async () => {
    const { f } = fake("<html>bad gateway</html>", 502);
    const c = createTelegramClient({ token: TOKEN, fetch: f });
    const e = await c.sendMessage({ chat_id: "1", text: "x" }).catch((x) => x);
    expect(e).toBeInstanceOf(TelegramError);
    expect(e.status).toBe(502);
    expect(e.message).not.toContain(TOKEN);
  });

  it("turns ok:false with HTTP 200 into TelegramError", async () => {
    const { f } = fake('{"ok":false,"description":"nope"}', 200);
    const c = createTelegramClient({ token: TOKEN, fetch: f });
    await expect(c.sendMessage({ chat_id: "1", text: "x" })).rejects.toBeInstanceOf(TelegramError);
  });

  it("does not leak the token when fetch itself throws", async () => {
    const f = (async (url: string) => {
      throw new Error(`connect failed ${url}`);
    }) as unknown as typeof fetch;
    const c = createTelegramClient({ token: TOKEN, fetch: f });
    const e = await c.sendMessage({ chat_id: "1", text: "x" }).catch((x) => x);
    expect(e).toBeInstanceOf(TelegramError);
    expect(e.message).not.toContain(TOKEN);
  });
});
