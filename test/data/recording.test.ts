import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRecordingFetch, createReplayFetch, redactEmbeddedKeys, sanitizeJson } from "../../src/data/recording.js";

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rec-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const JSON_URL = "https://api.example.test/products/search?q=fake";
const HTML_URL = "https://www.example.test/l/?keyword=fake";

const upstream: typeof fetch = async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === JSON_URL) {
    return new Response(
      JSON.stringify({ results: [{ id: "MLA1", seller: { id: 9, nickname: "n" } }], access_token: "fake-secret" }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-ratelimit-remaining": "42",
          "x-ratelimit-limit": "50",
          "set-cookie": "session=abc",
        },
      },
    );
  }
  if (url === HTML_URL) {
    return new Response("<html><article>hola</article></html>", {
      status: 429,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return new Response("nope", { status: 404 });
};

describe("sanitizeJson", () => {
  it("drops sensitive keys at any depth", () => {
    expect(sanitizeJson({ a: 1, access_token: "x", seller: { nickname: "n", id: 9 } })).toEqual({
      a: 1,
      seller: { id: 9 },
    });
  });

  it("walks arrays and keeps primitives", () => {
    expect(sanitizeJson([{ email: "e", v: [{ refresh_token: "r", ok: true }] }, 3, null, "s"])).toEqual([
      { v: [{ ok: true }] },
      3,
      null,
      "s",
    ]);
  });

  it("drops every listed key family", () => {
    const input = Object.fromEntries(
      ["client_secret", "email", "phone", "nickname", "first_name", "last_name", "address", "identification", "keep"].map(
        (k) => [k, "v"],
      ),
    );
    expect(sanitizeJson(input)).toEqual({ keep: "v" });
  });
});

describe("redactEmbeddedKeys", () => {
  it("replaces apiKey values and bare AIza tokens", () => {
    const out = redactEmbeddedKeys('{"googleMaps":{"apiKey":"AIzaSyFAKEFAKEFAKE"},"x":"AIzaSyABCDEFGHIJKLMNOPQRSTUV_-1"}');
    expect(out).toBe('{"googleMaps":{"apiKey":"REDACTED"},"x":"REDACTED"}');
  });
});

describe("recording and replay", () => {
  it("stores html bodies with embedded API keys redacted", async () => {
    const dir = tmp();
    const fake: typeof fetch = async () =>
      new Response('<html><script>{"apiKey":"AIzaSyFAKEFAKEFAKE"}</script></html>', {
        headers: { "content-type": "text/html" },
      });
    await createRecordingFetch(fake, dir)("https://www.example.test/k");
    const res = await createReplayFetch(dir)("https://www.example.test/k");
    const text = await res.text();
    expect(text).toContain('"apiKey":"REDACTED"');
    expect(text).not.toContain("AIza");
  });

  it("replays identical status, body and ratelimit headers", async () => {
    const dir = tmp();
    const rec = createRecordingFetch(upstream, dir);
    const live = await rec(JSON_URL, { headers: { Authorization: "Bearer fake-token" } });
    const replay = createReplayFetch(dir);
    const res = await replay(JSON_URL);
    expect(res.status).toBe(live.status);
    expect(await res.json()).toEqual({ results: [{ id: "MLA1", seller: { id: 9 } }] });
    expect(res.headers.get("x-ratelimit-remaining")).toBe("42");
    expect(res.headers.get("x-ratelimit-limit")).toBe("50");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("returns the live body unchanged to the caller", async () => {
    const rec = createRecordingFetch(upstream, tmp());
    const live = await rec(JSON_URL);
    expect(((await live.json()) as { access_token: string }).access_token).toBe("fake-secret");
  });

  it("records html verbatim with its status", async () => {
    const dir = tmp();
    await createRecordingFetch(upstream, dir)(HTML_URL);
    expect(readdirSync(dir).some((f) => f.endsWith(".html"))).toBe(true);
    const res = await createReplayFetch(dir)(HTML_URL);
    expect(res.status).toBe(429);
    expect(await res.text()).toBe("<html><article>hola</article></html>");
  });

  it("never stores Bearer, the secret or cookies", async () => {
    const dir = tmp();
    const rec = createRecordingFetch(upstream, dir);
    await rec(JSON_URL, { headers: { Authorization: "Bearer fake-token" } });
    await rec(HTML_URL);
    for (const f of readdirSync(dir)) {
      const text = readFileSync(join(dir, f), "utf8");
      expect(text).not.toContain("Bearer");
      expect(text).not.toContain("fake-token");
      expect(text).not.toContain("fake-secret");
      expect(text).not.toContain("session=abc");
    }
  });

  it("keeps earlier entries when a new recording session reuses the directory", async () => {
    const dir = tmp();
    await createRecordingFetch(upstream, dir)(JSON_URL);
    await createRecordingFetch(upstream, dir)(HTML_URL);
    const replay = createReplayFetch(dir);
    expect((await replay(JSON_URL)).status).toBe(200);
    expect((await replay(HTML_URL)).status).toBe(429);
  });

  it("rejects an unrecorded URL", async () => {
    await expect(createReplayFetch(tmp())("https://x.test/other")).rejects.toThrow(/unrecorded URL: https:\/\/x\.test\/other/);
  });
});
