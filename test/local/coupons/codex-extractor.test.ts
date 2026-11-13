import { describe, expect, it } from "vitest";
import { createCodexExtractor, DEFAULT_CODEX_MODEL } from "../../../src/local/coupons/codex-extractor.js";
import { CodexAuthError } from "../../../src/local/coupons/codex-auth.js";
import { ExtractionError } from "../../../src/local/coupons/extractor.js";
import { postById } from "../../support/coupon-fixtures.js";

const TOKEN = "ACCESS-TOKEN-SECRET";
const sse = (...events: [string | null, unknown][]) =>
  events.map(([ev, data]) => `${ev ? `event: ${ev}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`).join("");

function setup(body: string | (() => Response), accountId: string | null = "acc-1") {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return typeof body === "function" ? body() : new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  }) as unknown as typeof fetch;
  const extractor = createCodexExtractor({
    auth: { getCredentials: async () => ({ accessToken: TOKEN, accountId: accountId ?? undefined }) },
    model: DEFAULT_CODEX_MODEL,
    fetch: fetchFn,
  });
  return { extractor, calls };
}

const fnCallDone = (args: string) => [
  "response.output_item.done",
  { type: "response.output_item.done", item: { type: "function_call", name: "report_coupons", arguments: args } },
] as [string, unknown];

describe("createCodexExtractor", () => {
  it("sends the exact URL, headers and body", async () => {
    const post = postById(2874);
    const { extractor, calls } = setup(sse(fnCallDone(JSON.stringify({ coupons: post.coupons }))));
    await extractor.extract(post);
    const call = calls[0]!;
    expect(call.url).toBe("https://chatgpt.com/backend-api/codex/responses");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      accept: "text/event-stream",
      "content-type": "application/json",
      "OpenAI-Beta": "responses=experimental",
      originator: "pi",
      "User-Agent": "pi (macOS 15.0; Darwin 25.0.0; arm64)",
      "chatgpt-account-id": "acc-1",
    });
    const body = JSON.parse(call.init.body as string);
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      store: false,
      stream: true,
      text: { verbosity: "medium" },
      include: ["reasoning.encrypted_content"],
      tool_choice: "auto",
      parallel_tool_calls: false,
    });
    expect(body.instructions).toContain("nunca inventes un código");
    expect(body.instructions).toContain("report_coupons");
    expect(body.input).toHaveLength(1);
    expect(body.input[0].role).toBe("user");
    expect(body.input[0].content).toContain(post.text);
    expect(body.input[0].content).toContain("2026-11-04 10:15");
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]).toMatchObject({ type: "function", name: "report_coupons" });
    expect(body.tools[0].parameters.properties.coupons).toBeDefined();
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("omits chatgpt-account-id when there is none", async () => {
    const { extractor, calls } = setup(sse(fnCallDone(`{"coupons":[]}`)), null);
    await extractor.extract(postById(1801));
    expect(Object.keys(calls[0]!.init.headers as object)).not.toContain("chatgpt-account-id");
  });

  it("golden: CYBERALMAX arguments from output_item.done give the Anthropic golden result", async () => {
    const post = postById(2874);
    const { extractor } = setup(sse(["response.created", { type: "response.created" }], fnCallDone(JSON.stringify({ coupons: post.coupons })), ["response.completed", { type: "response.completed" }], [null, "[DONE]"]));
    const out = await extractor.extract(post);
    expect(out).toEqual(post.coupons);
    expect(out[0]).toMatchObject({ code: "CYBERALMAX", discount_value: 20000, min_purchase: 250000 });
  });

  it("assembles arguments from deltas when no output_item.done arrives, using data.type without event lines", async () => {
    const post = postById(2874);
    const json = JSON.stringify({ coupons: post.coupons });
    const mid = Math.floor(json.length / 2);
    const { extractor } = setup(
      sse(
        [null, { type: "response.function_call_arguments.delta", delta: json.slice(0, mid) }],
        [null, { type: "response.function_call_arguments.delta", delta: json.slice(mid) }],
      ),
    );
    expect(await extractor.extract(post)).toEqual(post.coupons);
  });

  it("falls back to text JSON, including a fenced block", async () => {
    const post = postById(2874);
    const json = JSON.stringify({ coupons: post.coupons });
    for (const text of [json, "```json\n" + json + "\n```"]) {
      const half = Math.floor(text.length / 2);
      const { extractor } = setup(
        sse(["response.output_text.delta", { delta: text.slice(0, half) }], ["response.output_text.delta", { delta: text.slice(half) }]),
      );
      expect(await extractor.extract(post)).toEqual(post.coupons);
    }
  });

  it("returns [] for an empty coupon list", async () => {
    const { extractor } = setup(sse(fnCallDone('{"coupons":[]}')));
    expect(await extractor.extract(postById(1801))).toEqual([]);
  });

  it("non-2xx throws ExtractionError with the status but not the body, token or post", async () => {
    const post = postById(1801);
    const { extractor } = setup(() => new Response(`oops ${TOKEN} ${post.text}`, { status: 429 }));
    const err = await extractor.extract(post).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    expect((err as Error).message).toContain("429");
    expect(JSON.stringify([(err as Error).message, (err as Error).stack])).not.toMatch(new RegExp(`${TOKEN}|${post.text.slice(0, 20)}`));
  });

  it("throws ExtractionError when nothing parseable arrives", async () => {
    for (const body of ["", sse(["response.output_text.delta", { delta: "sin json" }]), "data: not json\n\n"]) {
      await expect(setup(body).extractor.extract(postById(1801))).rejects.toBeInstanceOf(ExtractionError);
    }
  });

  it("throws ExtractionError on schema-invalid output", async () => {
    const good = postById(2874).coupons[0]!;
    for (const bad of [{ ...good, discount_value: -1 }, { ...good, valid_until: "mañana" }]) {
      const { extractor } = setup(sse(fnCallDone(JSON.stringify({ coupons: [bad] }))));
      await expect(extractor.extract(postById(2874))).rejects.toBeInstanceOf(ExtractionError);
    }
  });

  it("wraps network errors without leaking their message", async () => {
    const { extractor } = setup(() => {
      throw new Error(`socket hang up ${TOKEN}`);
    });
    const err = await extractor.extract(postById(1801)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    expect((err as Error).message).not.toContain(TOKEN);
  });

  it("times out an unresponsive request", async () => {
    const extractor = createCodexExtractor({
      auth: { getCredentials: async () => ({ accessToken: TOKEN, accountId: undefined }) },
      model: "m",
      timeoutMs: 10,
      fetch: ((_u: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch,
    });
    await expect(extractor.extract(postById(1801))).rejects.toThrow(/timed out/);
  });

  it("maps an auth failure to ExtractionError", async () => {
    const extractor = createCodexExtractor({
      auth: {
        getCredentials: async () => {
          throw new CodexAuthError("Codex token refresh failed (401); run `codex login` again");
        },
      },
      model: "m",
    });
    await expect(extractor.extract(postById(1801))).rejects.toBeInstanceOf(ExtractionError);
  });
});
