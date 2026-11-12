import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL, createAnthropicExtractor, type AnthropicLike } from "../../../src/local/coupons/anthropic-extractor.js";
import { ExtractionError } from "../../../src/local/coupons/extractor.js";
import { postById } from "../../support/coupon-fixtures.js";

const SECRET = "sk-ant-secret-key-123";

function fake(content: { type: string; input?: unknown }[]) {
  const calls: Record<string, unknown>[] = [];
  const client: AnthropicLike = {
    messages: {
      create: async (params) => {
        calls.push(params);
        return { content };
      },
    },
  };
  return { client, calls };
}

const toolUse = (input: unknown) => [{ type: "tool_use", input }];

describe("createAnthropicExtractor", () => {
  it("sends the model, a forced report_coupons tool and the post with its ART date", async () => {
    const post = postById(2874);
    const { client, calls } = fake(toolUse({ coupons: post.coupons }));
    await createAnthropicExtractor({ client, model: DEFAULT_MODEL }).extract(post);
    const params = calls[0] as {
      model: string;
      tool_choice: unknown;
      tools: { name: string }[];
      system: string;
      messages: { role: string; content: string }[];
    };
    expect(params.model).toBe("claude-haiku-5-5");
    expect(params.tool_choice).toEqual({ type: "tool", name: "report_coupons" });
    expect(params.tools[0]?.name).toBe("report_coupons");
    expect(params.messages[0]?.content).toContain(post.text);
    expect(params.messages[0]?.content).toContain("2026-11-04 10:15");
    expect(params.system).toContain("nunca inventes un código");
    expect(params.system).toContain("hora de pared de Argentina (ART)");
  });

  it("returns the coupons of a tool_use block", async () => {
    const post = postById(2874);
    const { client } = fake([{ type: "text" }, ...toolUse({ coupons: post.coupons })]);
    expect(await createAnthropicExtractor({ client, model: "m" }).extract(post)).toEqual(post.coupons);
  });

  it("returns [] for a post without coupons", async () => {
    const post = postById(1801);
    const { client } = fake(toolUse({ coupons: post.coupons }));
    expect(await createAnthropicExtractor({ client, model: "m" }).extract(post)).toEqual([]);
  });

  it("throws ExtractionError without a tool_use block", async () => {
    const { client } = fake([{ type: "text" }]);
    await expect(createAnthropicExtractor({ client, model: "m" }).extract(postById(1801))).rejects.toBeInstanceOf(ExtractionError);
  });

  it("throws ExtractionError on schema-invalid input", async () => {
    const good = postById(2874).coupons[0]!;
    for (const bad of [{ ...good, discount_value: -1 }, { ...good, valid_until: "mañana" }]) {
      const { client } = fake(toolUse({ coupons: [bad] }));
      await expect(createAnthropicExtractor({ client, model: "m" }).extract(postById(2874))).rejects.toBeInstanceOf(ExtractionError);
    }
  });

  it("throws ExtractionError when the client throws, without leaking the API key", async () => {
    const client: AnthropicLike = {
      messages: {
        create: async () => {
          throw Object.assign(new Error(`401 invalid x-api-key ${SECRET}`), { headers: { "x-api-key": SECRET } });
        },
      },
    };
    const err = await createAnthropicExtractor({ client, model: "m" })
      .extract(postById(1801))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExtractionError);
    expect(JSON.stringify([(err as Error).message, (err as Error).stack])).not.toContain(SECRET);
  });
});
